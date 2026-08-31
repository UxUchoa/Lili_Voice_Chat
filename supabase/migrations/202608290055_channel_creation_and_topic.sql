begin;

-- ============================================================
-- Criação e edição completas de canal
--
-- `create_channel` só aceitava nome, tipo e categoria: o cliente criava o
-- canal com um nome automático e depois corrigia tudo com chamadas extras —
-- e não havia como nascer privado, com limite de voz ou dentro de uma
-- categoria herdando as permissões dela. `update_channel` também não
-- alcançava o `topic`, que existe na tabela desde o schema inicial.
-- ============================================================

drop function if exists public.create_channel(uuid, text, text, uuid);

create or replace function public.create_channel(
  p_server_id uuid,
  p_name text,
  p_kind text,
  p_parent_id uuid default null,
  p_private boolean default false,
  p_slowmode_seconds integer default 0,
  p_user_limit integer default 0,
  p_topic text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid := gen_random_uuid();
  v_position integer;
  v_name text := left(trim(coalesce(p_name, '')), 100);
  v_everyone_id uuid;
  v_allow bigint;
  v_deny bigint;
begin
  if p_kind not in ('category', 'text', 'voice', 'thread') then
    raise exception 'invalid channel kind';
  end if;
  if not (
    public.is_server_owner(p_server_id)
    or public.has_server_permission(p_server_id, 32768)
  ) then
    raise exception 'forbidden';
  end if;
  if char_length(v_name) < 1 then raise exception 'invalid channel name'; end if;
  if coalesce(p_slowmode_seconds, 0) not between 0 and 21600
     or coalesce(p_user_limit, 0) not between 0 and 1000 then
    raise exception 'invalid channel settings';
  end if;
  if p_topic is not null and char_length(p_topic) > 1024 then
    raise exception 'invalid channel topic';
  end if;

  if p_parent_id is not null and not exists(
    select 1 from public.channels
    where id = p_parent_id and server_id = p_server_id and kind = 'category'
  ) then
    raise exception 'invalid category';
  end if;

  select coalesce(max(position), -1) + 1 into v_position
  from public.channels where server_id = p_server_id;

  insert into public.channels(
    id, server_id, parent_id, name, kind, position, created_by,
    private, slowmode_seconds, user_limit, topic, permissions_synced
  )
  values(
    v_id, p_server_id, p_parent_id, v_name, p_kind, v_position, auth.uid(),
    coalesce(p_private, false),
    case when p_kind = 'text' then coalesce(p_slowmode_seconds, 0) else 0 end,
    case when p_kind = 'voice' then coalesce(p_user_limit, 0) else 0 end,
    nullif(trim(coalesce(p_topic, '')), ''),
    p_parent_id is not null
  );

  -- Nascer dentro de uma categoria significa herdar as permissões dela, como
  -- no Discord. Sem isto o canal novo ficava aberto dentro de uma categoria
  -- fechada.
  if p_parent_id is not null then
    insert into public.channel_permission_overrides(
      channel_id, target_type, target_id, allow_mask, deny_mask
    )
    select v_id, parent_override.target_type, parent_override.target_id,
           parent_override.allow_mask, parent_override.deny_mask
    from public.channel_permission_overrides parent_override
    where parent_override.channel_id = p_parent_id
    on conflict(channel_id, target_type, target_id) do update
    set allow_mask = excluded.allow_mask, deny_mask = excluded.deny_mask;
  end if;

  -- Canal privado nasce com VIEW_CHANNEL negado para @everyone.
  if coalesce(p_private, false) then
    select id into v_everyone_id
    from public.roles where server_id = p_server_id and is_default;
    select coalesce(allow_mask, 0), coalesce(deny_mask, 0)
      into v_allow, v_deny
    from public.channel_permission_overrides
    where channel_id = v_id and target_type = 'ROLE' and target_id = v_everyone_id;
    perform public.set_channel_override(
      v_id, 'ROLE', v_everyone_id,
      coalesce(v_allow, 0) & ~1::bigint,
      coalesce(v_deny, 0) | 1::bigint
    );
  end if;

  perform public.write_audit(
    p_server_id, 'CHANNEL_CREATE', 'CHANNEL', v_id,
    jsonb_build_object(
      'name', v_name, 'kind', p_kind, 'private', coalesce(p_private, false),
      'parent_id', p_parent_id
    )
  );
  return v_id;
end;
$fn$;

-- ------------------------------------------------------------
-- update_channel ganha o tópico.
-- ------------------------------------------------------------
drop function if exists public.update_channel(uuid, text, integer, boolean, integer);

create or replace function public.update_channel(
  p_channel_id uuid,
  p_name text,
  p_slowmode_seconds integer,
  p_private boolean,
  p_user_limit integer,
  p_topic text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_channel public.channels%rowtype;
  v_everyone_id uuid;
  v_allow bigint;
  v_deny bigint;
  v_next_user_limit integer;
  v_topic text;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null or not (
    public.is_server_owner(v_channel.server_id)
    or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100
     or p_slowmode_seconds not between 0 and 21600
     or p_user_limit not between 0 and 1000 then
    raise exception 'invalid channel settings';
  end if;
  if p_topic is not null and char_length(p_topic) > 1024 then
    raise exception 'invalid channel topic';
  end if;

  v_next_user_limit := case when v_channel.kind = 'voice' then p_user_limit else 0 end;
  -- `null` mantém o tópico atual; string vazia limpa.
  v_topic := case
    when p_topic is null then v_channel.topic
    else nullif(trim(p_topic), '')
  end;
  update public.channels
  set name = trim(p_name),
      slowmode_seconds = case when v_channel.kind = 'text' then p_slowmode_seconds else 0 end,
      private = p_private,
      user_limit = v_next_user_limit,
      topic = v_topic,
      updated_at = now()
  where id = p_channel_id;

  if p_private is distinct from v_channel.private then
    select id into v_everyone_id
    from public.roles
    where server_id = v_channel.server_id and is_default;
    select coalesce(allow_mask, 0), coalesce(deny_mask, 0)
      into v_allow, v_deny
    from public.channel_permission_overrides
    where channel_id = p_channel_id
      and target_type = 'ROLE' and target_id = v_everyone_id;
    v_allow := coalesce(v_allow, 0) & ~1::bigint;
    if p_private then
      v_deny := coalesce(v_deny, 0) | 1::bigint;
    else
      v_deny := coalesce(v_deny, 0) & ~1::bigint;
    end if;
    perform public.set_channel_override(
      p_channel_id, 'ROLE', v_everyone_id, v_allow, v_deny
    );
  end if;

  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id,
    jsonb_build_object(
      'before', jsonb_build_object(
        'name', v_channel.name,
        'slowmode_seconds', v_channel.slowmode_seconds,
        'private', v_channel.private,
        'user_limit', v_channel.user_limit,
        'topic', v_channel.topic
      ),
      'after', jsonb_build_object(
        'name', trim(p_name),
        'slowmode_seconds', p_slowmode_seconds,
        'private', p_private,
        'user_limit', v_next_user_limit,
        'topic', v_topic
      )
    )
  );
end;
$fn$;

-- ------------------------------------------------------------
-- Voltar a sincronizar um canal com a categoria dele.
-- ------------------------------------------------------------
create or replace function public.sync_channel_with_category(p_channel_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_channel public.channels%rowtype;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null or v_channel.parent_id is null then
    raise exception 'channel has no category';
  end if;
  if not (
    public.is_server_owner(v_channel.server_id)
    or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;

  delete from public.channel_permission_overrides where channel_id = p_channel_id;
  insert into public.channel_permission_overrides(
    channel_id, target_type, target_id, allow_mask, deny_mask
  )
  select p_channel_id, target_type, target_id, allow_mask, deny_mask
  from public.channel_permission_overrides
  where channel_id = v_channel.parent_id;
  update public.channels
  set permissions_synced = true,
      private = exists(
        select 1 from public.channel_permission_overrides override
        join public.roles everyone
          on everyone.id = override.target_id and everyone.is_default
        where override.channel_id = p_channel_id
          and override.target_type = 'ROLE'
          and (override.deny_mask & 1) = 1
      )
  where id = p_channel_id;
  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id,
    jsonb_build_object('permissions_synced', true)
  );
end;
$fn$;

revoke all on function public.create_channel(uuid, text, text, uuid, boolean, integer, integer, text)
  from public, anon;
grant execute on function public.create_channel(uuid, text, text, uuid, boolean, integer, integer, text)
  to authenticated;
revoke all on function public.update_channel(uuid, text, integer, boolean, integer, text)
  from public, anon;
grant execute on function public.update_channel(uuid, text, integer, boolean, integer, text)
  to authenticated;
revoke all on function public.sync_channel_with_category(uuid) from public, anon;
grant execute on function public.sync_channel_with_category(uuid) to authenticated;

commit;
