begin;

-- ============================================================
-- Quem cria o servidor ganha um cargo de Administração
--
-- Até aqui o servidor nascia com um cargo só, o @everyone, e o poder do dono
-- vinha exclusivamente de `is_server_owner`. Isso tinha dois efeitos ruins:
-- a aba "Cargos" de um servidor novo não tinha nada para mostrar, e não havia
-- como delegar administração a outra pessoa sem montar o cargo na mão.
--
-- Além disso, `ADMINISTRATOR` não valia nada no banco: `effective_server_
-- permissions` só fazia `bit_or` das máscaras, então um cargo com o bit de
-- administrador continuava sem poder gerenciar canais ou cargos — enquanto o
-- cliente (`resolvePermissions`) já tratava o bit como "tudo liberado". As
-- duas pontas discordavam, e a tela mostrava permissão que o banco negava.
-- ============================================================

-- ------------------------------------------------------------
-- 1. ADMINISTRATOR passa a expandir para todas as permissões.
-- ------------------------------------------------------------
create or replace function public.effective_server_permissions(
  p_server_id uuid,
  p_user_id uuid default auth.uid()
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_server_owner(p_server_id, p_user_id) then 2305843009213693951::bigint
    when not public.is_server_member(p_server_id, p_user_id) then 0::bigint
    else (
      select case
        -- 1 << 60 = ADMINISTRATOR; 2^61 - 1 = todas as permissões.
        when (coalesce(bit_or(r.permissions), 0::bigint) & (1::bigint << 60)) <> 0
          then 2305843009213693951::bigint
        else coalesce(bit_or(r.permissions), 0::bigint)
      end
      from public.roles r
      where r.server_id = p_server_id
        and (r.is_default or exists(
          select 1 from public.member_roles mr
          where mr.server_id = p_server_id
            and mr.user_id = p_user_id
            and mr.role_id = r.id
        ))
    )
  end;
$$;

-- ------------------------------------------------------------
-- 2. create_server cria o cargo e o entrega a quem criou.
-- ------------------------------------------------------------
create or replace function public.create_server(
  p_name text,
  p_description text default '',
  p_icon_path text default null,
  p_server_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_server_id uuid := coalesce(p_server_id, gen_random_uuid());
  v_everyone_id uuid := gen_random_uuid();
  v_admin_id uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  v_name text := trim(coalesce(p_name, ''));
  v_description text := trim(coalesce(p_description, ''));
  -- O piso de quem entra depois: ver canais, falar, entrar na voz e convidar.
  -- VIEW_CHANNEL, SEND_MESSAGES, CREATE_INVITES, ADD_REACTIONS,
  -- ATTACH_FILES, EMBED_LINKS, READ_HISTORY, CONNECT, SPEAK,
  -- STREAM and USE_VAD.
  v_base bigint := 1081868515::bigint;
  v_admin bigint := (1::bigint << 60);
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'invalid server name';
  end if;
  if char_length(v_description) > 1000 then
    raise exception 'invalid server description';
  end if;
  if p_icon_path is not null
     and p_icon_path !~ ('^' || v_server_id::text || '/') then
    raise exception 'invalid server icon path';
  end if;

  insert into public.servers(id, owner_id, name, description, icon_path)
    values(v_server_id, v_user, v_name, v_description, p_icon_path);
  insert into public.server_members(server_id, user_id, join_source)
    values(v_server_id, v_user, 'owner-created-server');

  insert into public.roles(
    id, server_id, name, position, permissions, is_default, color, hoist
  )
  values
    (v_everyone_id, v_server_id, '@everyone', 0, v_base, true, '#817b7f', false),
    (v_admin_id, v_server_id, 'Administração', 1, v_admin, false, '#f00c14', true);
  insert into public.member_roles(server_id, user_id, role_id)
    values(v_server_id, v_user, v_admin_id);

  insert into public.channels(server_id, name, kind, position, created_by)
    values (v_server_id, 'geral', 'text', 0, v_user),
           (v_server_id, 'Lounge', 'voice', 1, v_user);

  perform public.write_audit(
    v_server_id, 'SERVER_CREATE', 'SERVER', v_server_id,
    jsonb_build_object('name', v_name, 'description', v_description)
  );
  return v_server_id;
end;
$fn$;

revoke all on function public.create_server(text, text, text, uuid)
  from public, anon;
grant execute on function public.create_server(text, text, text, uuid)
  to authenticated;

-- ------------------------------------------------------------
-- 3. Servidores antigos que ainda só têm o @everyone recebem o mesmo cargo.
--    Só os intocados: quem já montou a própria hierarquia fica como está.
-- ------------------------------------------------------------
with alvo as (
  select s.id as server_id, s.owner_id
  from public.servers s
  where not exists(
    select 1 from public.roles r
    where r.server_id = s.id and not r.is_default
  )
), criado as (
  insert into public.roles(
    server_id, name, position, permissions, is_default, color, hoist
  )
  select alvo.server_id, 'Administração',
         coalesce((
           select max(position) + 1 from public.roles r
           where r.server_id = alvo.server_id
         ), 1),
         (1::bigint << 60), false, '#f00c14', true
  from alvo
  returning id, server_id
)
insert into public.member_roles(server_id, user_id, role_id)
select criado.server_id, alvo.owner_id, criado.id
from criado
join alvo on alvo.server_id = criado.server_id
where exists(
  select 1 from public.server_members sm
  where sm.server_id = alvo.server_id and sm.user_id = alvo.owner_id
)
on conflict do nothing;

commit;
