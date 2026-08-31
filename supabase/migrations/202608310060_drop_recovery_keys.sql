begin;

-- ============================================================
-- Remove a recuperação por chave única
--
-- A chave existiu por menos de um dia. A decisão mudou depois que o e-mail do
-- Supabase se mostrou suficiente para este produto: a recuperação volta a ser
-- por link, como a confirmação de cadastro.
--
-- O que a chave protegia continua valendo a pena registrar, porque quem voltar
-- atrás precisa saber o que está reintroduzindo: com link por e-mail, a
-- segurança da conta passa a ser a da caixa de entrada do usuário, e a
-- entrega depende de um SMTP que aguente produção — o embutido do Supabase
-- manda poucas mensagens por hora e não é feito para isso.
--
-- O expurgo de conta parada (202608310059) **fica**: `profiles.deleted_at`,
-- `list_inactive_accounts`, `tombstone_account` e a exceção de
-- `protect_server_owner` não têm relação com a forma de recuperar senha.
-- ============================================================

-- ------------------------------------------------------------
-- 1. `tombstone_account` para de tocar na tabela que vai sumir
--
-- Reescrita inteira em vez de remendo: a função é `create or replace`, e
-- deixar a versão antiga no banco enquanto a tabela some daria erro só quando
-- o expurgo rodasse, dali a semanas.
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

  return query select v_transferred, v_deleted;
end;
$fn$;

revoke all on function public.tombstone_account(uuid) from public, anon, authenticated;
grant execute on function public.tombstone_account(uuid) to service_role;

-- ------------------------------------------------------------
-- 2. As funções da chave saem antes da tabela
-- ------------------------------------------------------------
drop function if exists public.complete_recovery(uuid, text);
drop function if exists public.verify_recovery_key(text, text);
drop function if exists public.recovery_key_status();
drop function if exists public.set_recovery_key(text);

-- ------------------------------------------------------------
-- 3. E a tabela
-- ------------------------------------------------------------
drop table if exists public.account_recovery_keys;

commit;
