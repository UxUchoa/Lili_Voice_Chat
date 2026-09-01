begin;

-- ============================================================
-- A chave de recuperação volta
--
-- Ela existiu por algumas horas em 2026-08-31 e foi removida quando o e-mail
-- do Supabase pareceu suficiente. Não era: o servidor de e-mail embutido manda
-- poucas mensagens por hora, e cadastro novo passou a esbarrar em
-- "email rate limit exceeded". Com a confirmação de e-mail desligada, o e-mail
-- deixa de ser canal de recuperação — e sem nada no lugar, quem perde a senha
-- perde a conta sem apelação.
--
-- O desenho é o mesmo de antes, e continua valendo o que ele custa: quem
-- perde a chave perde a conta. É dito na tela, no momento em que ela é
-- entregue, e o botão de seguir em frente só destrava depois que a pessoa
-- confirma ter guardado.
--
-- O servidor guarda apenas o SHA-256 da chave normalizada. São 160 bits de
-- entropia: não há dicionário a atacar, e o cadastro nunca transmite a chave
-- em si — o hash é calculado no cliente.
-- ============================================================

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
-- Permissões
-- ------------------------------------------------------------
revoke all on function public.set_recovery_key(text) from public, anon;
grant execute on function public.set_recovery_key(text) to authenticated;

revoke all on function public.recovery_key_status() from public, anon;
grant execute on function public.recovery_key_status() to authenticated;

-- As duas abaixo leem `auth.users` ou destroem sessão: só a função de borda,
-- que roda com service role e não é alcançável pelo navegador sem a chave.
revoke all on function public.verify_recovery_key(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_recovery_key(text, text) to service_role;

revoke all on function public.complete_recovery(uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_recovery(uuid, text) to service_role;

grant select on public.account_recovery_keys to service_role;

commit;
