begin;

-- ============================================================
-- Recuperação por chave única e expurgo de conta inativa
--
-- Até aqui a recuperação de senha dependia de e-mail, e e-mail é justamente o
-- que este produto não quer no caminho crítico: exige SMTP confiável, entrega
-- ao provedor de e-mail o mapa de quem usa o aplicativo e vira um caminho de
-- volta para dentro da conta que não passa pelo usuário.
--
-- No lugar entra uma chave única, entregue uma vez no cadastro. Quem a tem
-- troca a senha; quem a perde perde a conta. O servidor guarda apenas o
-- SHA-256 da chave normalizada — 160 bits de entropia tornam a busca por força
-- bruta inviável mesmo com hash rápido, e o cadastro nunca transmite a chave
-- em si, só o hash calculado no cliente.
--
-- E a conta sem login por 90 dias vira lápide: o acesso é destruído, o
-- conteúdo permanece. Apagar a linha era impossível de qualquer forma —
-- `messages.author_id`, `servers.owner_id` e `channels.created_by` são
-- NO ACTION de propósito, para que a conversa de terceiros não desapareça
-- junto com quem sumiu.
-- ============================================================

-- ------------------------------------------------------------
-- 1. A marca da lápide
-- ------------------------------------------------------------
alter table public.profiles
  add column if not exists deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Quando a conta foi transformada em lápide pelo expurgo de inatividade. '
  'O perfil continua existindo para não levar embora mensagens, canais e '
  'servidores de outras pessoas.';

-- ------------------------------------------------------------
-- 2. A chave de recuperação
--
-- Sem policy de RLS e sem grant para `authenticated`: o hash nunca volta para
-- o cliente e toda leitura passa pelas funções abaixo. É o mesmo tratamento
-- que `mls_group_members` recebe.
-- ------------------------------------------------------------
create table if not exists public.account_recovery_keys (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  key_hash text not null check (char_length(key_hash) between 32 and 200),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz
);

alter table public.account_recovery_keys enable row level security;
revoke all on public.account_recovery_keys from public, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Registrar ou trocar a própria chave
--
-- Trocar invalida a anterior na mesma operação e zera o bloqueio: quem provou
-- ser o dono da sessão não deve herdar as tentativas erradas de um atacante.
-- ------------------------------------------------------------
create or replace function public.set_recovery_key(p_key_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_hash text := trim(coalesce(p_key_hash, ''));
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if char_length(v_hash) < 32 then raise exception 'invalid recovery key hash'; end if;

  insert into public.account_recovery_keys(user_id, key_hash)
  values (auth.uid(), v_hash)
  on conflict (user_id) do update
    set key_hash = excluded.key_hash,
        created_at = now(),
        last_used_at = null,
        failed_attempts = 0,
        locked_until = null;
end;
$fn$;

/** O dono vê que a chave existe e desde quando, nunca o hash. */
create or replace function public.recovery_key_status()
returns table(has_key boolean, created_at timestamptz, last_used_at timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    exists(select 1 from public.account_recovery_keys k where k.user_id = auth.uid()),
    (select k.created_at from public.account_recovery_keys k where k.user_id = auth.uid()),
    (select k.last_used_at from public.account_recovery_keys k where k.user_id = auth.uid());
$fn$;

-- ------------------------------------------------------------
-- 4. Verificar a chave — só a função de borda chama
--
-- Devolve `status` em vez de erro para que a função de borda possa responder
-- sempre a mesma coisa ao cliente: dizer "esta conta não existe" entregaria a
-- lista de quem tem conta a quem perguntar.
--
-- O bloqueio é por conta, não por IP: cinco erros travam por quinze minutos.
-- Contra 160 bits de entropia isso é folclore, mas protege a conta cuja chave
-- vazou pela metade.
-- ------------------------------------------------------------
create or replace function public.verify_recovery_key(p_email text, p_key_hash text)
returns table(status text, user_id uuid)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id uuid;
  v_row public.account_recovery_keys%rowtype;
begin
  select u.id into v_user_id
  from auth.users u
  where lower(u.email) = lower(trim(coalesce(p_email, '')))
  limit 1;

  if v_user_id is null then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  -- Uma lápide não volta: o acesso foi destruído de propósito.
  if exists(select 1 from public.profiles p where p.id = v_user_id and p.deleted_at is not null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  select * into v_row from public.account_recovery_keys k where k.user_id = v_user_id;
  if not found then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if v_row.locked_until is not null and v_row.locked_until > now() then
    return query select 'locked'::text, null::uuid;
    return;
  end if;

  if v_row.key_hash = trim(coalesce(p_key_hash, '')) then
    update public.account_recovery_keys
    set last_used_at = now(), failed_attempts = 0, locked_until = null
    where account_recovery_keys.user_id = v_user_id;
    return query select 'ok'::text, v_user_id;
    return;
  end if;

  update public.account_recovery_keys
  set failed_attempts = account_recovery_keys.failed_attempts + 1,
      locked_until = case
        when account_recovery_keys.failed_attempts + 1 >= 5 then now() + interval '15 minutes'
        else account_recovery_keys.locked_until
      end
  where account_recovery_keys.user_id = v_user_id;

  return query select 'invalid'::text, null::uuid;
end;
$fn$;

-- ------------------------------------------------------------
-- 4b. Concluir a recuperação — só a função de borda chama
--
-- Duas coisas que precisam acontecer juntas depois que a chave confere:
-- derrubar toda sessão viva (quem tinha acesso indevido perde na hora) e
-- gravar a chave nova. O hash da chave nova vem pronto do cliente: o servidor
-- continua sem nunca ver a chave em si.
-- ------------------------------------------------------------
create or replace function public.complete_recovery(
  p_user_id uuid,
  p_next_key_hash text
)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $fn$
declare v_hash text := trim(coalesce(p_next_key_hash, ''));
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if char_length(v_hash) < 32 then raise exception 'invalid recovery key hash'; end if;

  delete from auth.sessions where user_id = p_user_id;

  update public.account_recovery_keys
  set key_hash = v_hash,
      created_at = now(),
      last_used_at = now(),
      failed_attempts = 0,
      locked_until = null
  where user_id = p_user_id;
end;
$fn$;

-- ------------------------------------------------------------
-- 5. Contas paradas há mais de N dias
--
-- Quem nunca entrou conta a partir da criação: uma conta criada e abandonada
-- no mesmo dia não pode ficar viva para sempre por não ter `last_sign_in_at`.
-- ------------------------------------------------------------
create or replace function public.list_inactive_accounts(p_days integer default 90)
returns table(user_id uuid, inactive_since timestamptz)
language sql
stable
security definer
set search_path = public
as $fn$
  select u.id, coalesce(u.last_sign_in_at, u.created_at)
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.deleted_at is null
    and coalesce(u.last_sign_in_at, u.created_at) < now() - make_interval(days => greatest(p_days, 1))
  order by coalesce(u.last_sign_in_at, u.created_at)
$fn$;

-- ------------------------------------------------------------
-- 5b. Abrir uma exceção estreita na proteção de posse do servidor
--
-- `protect_server_owner` exige que quem transfere seja o dono, agindo na
-- própria sessão (`old.owner_id = auth.uid()`). É a regra certa, e o expurgo
-- esbarra nela: ninguém está logado, e o dono justamente sumiu.
--
-- A exceção não é uma chave mestra: só vale quando o dono que sai já é uma
-- lápide. Isso é um fato registrado na tabela, não uma variável de sessão que
-- qualquer código poderia ligar — e só `tombstone_account`, que exige service
-- role, consegue criar uma lápide. O herdeiro continua precisando ser membro.
-- ------------------------------------------------------------
create or replace function public.protect_server_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id = old.owner_id then return new; end if;

  if not public.is_server_member(old.id, new.owner_id) then
    raise exception 'invalid server ownership transfer';
  end if;

  if old.owner_id = auth.uid() then return new; end if;

  if exists(
    select 1 from public.profiles p
    where p.id = old.owner_id and p.deleted_at is not null
  ) then return new; end if;

  raise exception 'invalid server ownership transfer';
end;
$$;

-- ------------------------------------------------------------
-- 6. Transformar em lápide
--
-- O que é destruído: identidade, dispositivos, chaves, sessões, assinaturas de
-- push, presença em servidores e a própria chave de recuperação.
-- O que sobrevive: mensagens, canais e servidores — de qualquer participante.
--
-- Servidor cujo dono sumiu passa para o administrador mais antigo; sem
-- ninguém com ADMINISTRATOR, para o membro mais antigo; sem nenhum outro
-- membro, o servidor é apagado, porque não sobrou conversa para preservar.
-- Trocar `owner_id` basta: `effective_server_permissions` já dá tudo ao dono.
-- ------------------------------------------------------------
create or replace function public.tombstone_account(p_user_id uuid)
returns table(servers_transferred integer, servers_deleted integer)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_server record;
  v_heir uuid;
  v_transferred integer := 0;
  v_deleted integer := 0;
  v_username text;
begin
  if p_user_id is null then raise exception 'user id is required'; end if;
  if not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'profile not found';
  end if;

  -- `username` é único e cabe em 24 caracteres, então o nome da lápide não
  -- pode ser um pedaço fixo do uuid: doze hexadecimais colidem uma vez a cada
  -- muitas contas, e a colisão faria o expurgo da segunda falhar para sempre.
  -- Sorteia de novo até achar um livre.
  v_username := 'removido_' || left(replace(p_user_id::text, '-', ''), 12);
  while exists(
    select 1 from public.profiles
    where username = v_username and id <> p_user_id
  ) loop
    v_username := 'removido_' || left(replace(gen_random_uuid()::text, '-', ''), 12);
  end loop;

  -- A lápide é marcada **antes** de transferir os servidores: é ela que
  -- autoriza `protect_server_owner` a aceitar a transferência sem sessão do
  -- dono. Tudo acontece na mesma transação, então não há janela em que o
  -- perfil esteja anônimo com os servidores ainda pendurados nele.
  --
  -- `bio` é NOT NULL com default vazio, e `presence` só aceita os valores em
  -- minúscula do check. As duas políticas vão para NOBODY para que a lápide
  -- não continue recebendo conversa nem pedido de amizade.
  update public.profiles
  set username = v_username,
      display_name = 'Usuário removido',
      avatar_path = null,
      banner_path = null,
      bio = '',
      pronouns = null,
      custom_status = null,
      presence = 'offline',
      dm_policy = 'NOBODY',
      friend_request_policy = 'NOBODY',
      profile_visible = false,
      deleted_at = now(),
      updated_at = now()
  where id = p_user_id;

  for v_server in
    select id from public.servers where owner_id = p_user_id
  loop
    -- 1 << 60 = ADMINISTRATOR.
    select sm.user_id into v_heir
    from public.server_members sm
    where sm.server_id = v_server.id
      and sm.user_id <> p_user_id
      and (public.effective_server_permissions(v_server.id, sm.user_id)
           & (1::bigint << 60)) <> 0
    order by sm.joined_at
    limit 1;

    if v_heir is null then
      select sm.user_id into v_heir
      from public.server_members sm
      where sm.server_id = v_server.id and sm.user_id <> p_user_id
      order by sm.joined_at
      limit 1;
    end if;

    if v_heir is null then
      delete from public.servers where id = v_server.id;
      v_deleted := v_deleted + 1;
    else
      update public.servers set owner_id = v_heir, updated_at = now()
      where id = v_server.id;
      v_transferred := v_transferred + 1;
    end if;
  end loop;

  delete from public.devices where user_id = p_user_id;
  delete from public.e2ee_key_packages where user_id = p_user_id;
  delete from public.push_subscriptions where user_id = p_user_id;
  delete from public.server_members where user_id = p_user_id;
  delete from public.channel_members where user_id = p_user_id;
  delete from public.user_contacts where user_id = p_user_id;
  delete from public.account_recovery_keys where user_id = p_user_id;

  return query select v_transferred, v_deleted;
end;
$fn$;

-- ------------------------------------------------------------
-- 7. Permissões
-- ------------------------------------------------------------
revoke all on function public.set_recovery_key(text) from public, anon;
grant execute on function public.set_recovery_key(text) to authenticated;

revoke all on function public.recovery_key_status() from public, anon;
grant execute on function public.recovery_key_status() to authenticated;

-- As três abaixo leem `auth.users` ou destroem acesso: só a função de borda,
-- que roda com service role e nunca é alcançável pelo navegador sem segredo.
revoke all on function public.verify_recovery_key(text, text) from public, anon, authenticated;
grant execute on function public.verify_recovery_key(text, text) to service_role;

revoke all on function public.complete_recovery(uuid, text) from public, anon, authenticated;
grant execute on function public.complete_recovery(uuid, text) to service_role;

revoke all on function public.list_inactive_accounts(integer) from public, anon, authenticated;
grant execute on function public.list_inactive_accounts(integer) to service_role;

revoke all on function public.tombstone_account(uuid) from public, anon, authenticated;
grant execute on function public.tombstone_account(uuid) to service_role;

-- Esta instância não dá grant amplo ao service_role: cada tabela é liberada na
-- mão (202608240008). As funções acima são SECURITY DEFINER e não dependem
-- disto, mas o expurgo lê o perfil pela API antes de decidir.
grant select on public.account_recovery_keys to service_role;

commit;
