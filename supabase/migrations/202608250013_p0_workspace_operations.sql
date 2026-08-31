begin;

create or replace function public.update_member_nickname(
  p_server_id uuid, p_target_id uuid, p_nickname text
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_normalized text := nullif(left(trim(coalesce(p_nickname, '')), 32), '');
  v_before text;
  v_self boolean := p_target_id = auth.uid();
begin
  select nickname into v_before
  from public.server_members
  where server_id = p_server_id and user_id = p_target_id;
  if not found then raise exception 'member not found'; end if;

  if v_self then
    if not (public.is_server_owner(p_server_id) or public.has_server_permission(p_server_id, 16777216)) then
      raise exception 'forbidden';
    end if;
  elsif not public.can_moderate_member(p_server_id, p_target_id, 33554432) then
    raise exception 'forbidden';
  end if;

  update public.server_members
  set nickname = v_normalized
  where server_id = p_server_id and user_id = p_target_id;
  perform public.write_audit(
    p_server_id, 'MEMBER_NICKNAME_UPDATE', 'MEMBER', p_target_id,
    jsonb_build_object('before', v_before, 'after', v_normalized)
  );
end $$;

create or replace function public.mark_channel_read(
  p_channel_id uuid, p_last_message_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_channel_permission(p_channel_id, 1) then raise exception 'forbidden'; end if;
  if p_last_message_id is not null and not exists(
    select 1 from public.messages where id = p_last_message_id and channel_id = p_channel_id
  ) then raise exception 'message does not belong to channel'; end if;

  insert into public.read_states(channel_id, user_id, last_message_id, last_read_at, mention_count)
  values(p_channel_id, auth.uid(), p_last_message_id, now(), 0)
  on conflict(channel_id, user_id) do update set
    last_message_id = excluded.last_message_id,
    last_read_at = excluded.last_read_at,
    mention_count = 0;
end $$;

create or replace function public.duplicate_channel(p_channel_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.channels%rowtype;
  v_id uuid := gen_random_uuid();
  v_position integer;
begin
  select * into v_source from public.channels where id = p_channel_id;
  if not found or v_source.server_id is null or not (
    public.is_server_owner(v_source.server_id) or public.has_server_permission(v_source.server_id, 32768)
  ) then raise exception 'forbidden'; end if;

  select coalesce(max(position), -1) + 1 into v_position
  from public.channels where server_id = v_source.server_id;
  insert into public.channels(
    id, server_id, parent_id, name, kind, position, topic, slowmode_seconds,
    user_limit, private, permissions_synced, created_by
  ) values(
    v_id, v_source.server_id, v_source.parent_id,
    left(v_source.name || ' cópia', 100), v_source.kind, v_position,
    v_source.topic, v_source.slowmode_seconds, v_source.user_limit,
    v_source.private, v_source.permissions_synced, auth.uid()
  );
  insert into public.channel_permission_overrides(channel_id, target_type, target_id, allow_mask, deny_mask)
  select v_id, target_type, target_id, allow_mask, deny_mask
  from public.channel_permission_overrides where channel_id = p_channel_id;
  perform public.write_audit(
    v_source.server_id, 'CHANNEL_CREATE', 'CHANNEL', v_id,
    jsonb_build_object('duplicated_from', p_channel_id, 'name', left(v_source.name || ' cópia', 100))
  );
  return v_id;
end $$;

create or replace function public.reorder_channel(p_channel_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_source public.channels%rowtype;
  v_other public.channels%rowtype;
begin
  if p_direction not in ('up', 'down') then raise exception 'invalid direction'; end if;
  select * into v_source from public.channels where id = p_channel_id;
  if not found or v_source.server_id is null or not (
    public.is_server_owner(v_source.server_id) or public.has_server_permission(v_source.server_id, 32768)
  ) then raise exception 'forbidden'; end if;

  if p_direction = 'up' then
    select * into v_other from public.channels
    where server_id = v_source.server_id
      and parent_id is not distinct from v_source.parent_id
      and position < v_source.position
    order by position desc limit 1;
  else
    select * into v_other from public.channels
    where server_id = v_source.server_id
      and parent_id is not distinct from v_source.parent_id
      and position > v_source.position
    order by position asc limit 1;
  end if;
  if not found then return; end if;
  update public.channels set position = case
    when id = v_source.id then v_other.position
    when id = v_other.id then v_source.position
    else position end
  where id in (v_source.id, v_other.id);
  perform public.write_audit(
    v_source.server_id, 'CHANNEL_REORDER', 'CHANNEL', v_source.id,
    jsonb_build_object('direction', p_direction, 'swapped_with', v_other.id,
      'before', v_source.position, 'after', v_other.position)
  );
end $$;

create or replace function public.duplicate_role(p_role_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_source public.roles%rowtype;
  v_id uuid := gen_random_uuid();
  v_position integer;
  v_actor_permissions bigint;
begin
  select * into v_source from public.roles where id = p_role_id;
  if not found or v_source.is_default or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  v_actor_permissions := public.effective_server_permissions(v_source.server_id);
  if not public.is_server_owner(v_source.server_id) and (v_source.permissions & ~v_actor_permissions) <> 0 then
    raise exception 'cannot grant unowned permissions';
  end if;
  select coalesce(max(position), 0) + 1 into v_position from public.roles where server_id = v_source.server_id;
  insert into public.roles(
    id, server_id, name, position, permissions, color, secondary_color,
    icon_path, unicode_emoji, hoist, mentionable
  ) values(
    v_id, v_source.server_id, left(v_source.name || ' cópia', 100), v_position,
    v_source.permissions, v_source.color, v_source.secondary_color,
    v_source.icon_path, v_source.unicode_emoji, v_source.hoist, v_source.mentionable
  );
  perform public.write_audit(
    v_source.server_id, 'ROLE_CREATE', 'ROLE', v_id,
    jsonb_build_object('duplicated_from', p_role_id, 'permissions', v_source.permissions::text)
  );
  return v_id;
end $$;

create or replace function public.reorder_role(p_role_id uuid, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_source public.roles%rowtype;
  v_other public.roles%rowtype;
begin
  if p_direction not in ('up', 'down') then raise exception 'invalid direction'; end if;
  select * into v_source from public.roles where id = p_role_id;
  if not found or v_source.is_default or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  if p_direction = 'up' then
    select * into v_other from public.roles
    where server_id = v_source.server_id and not is_default and position > v_source.position
    order by position asc limit 1;
  else
    select * into v_other from public.roles
    where server_id = v_source.server_id and not is_default and position < v_source.position
    order by position desc limit 1;
  end if;
  if not found then return; end if;
  if not public.can_manage_role(v_other.id) then raise exception 'forbidden'; end if;

  update public.roles set position = -1 where id = v_source.id;
  update public.roles set position = v_source.position where id = v_other.id;
  update public.roles set position = v_other.position where id = v_source.id;
  perform public.write_audit(
    v_source.server_id, 'ROLE_REORDER', 'ROLE', v_source.id,
    jsonb_build_object('direction', p_direction, 'swapped_with', v_other.id,
      'before', v_source.position, 'after', v_other.position)
  );
end $$;

create or replace function public.create_direct_channel(p_member_ids uuid[], p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_channel_id uuid := gen_random_uuid();
  v_actor uuid := auth.uid();
  v_members uuid[];
  v_target uuid;
  v_kind text;
  v_name text;
  v_existing uuid;
begin
  select array_agg(member_id order by member_id) into v_members
  from (select distinct member_id from unnest(array_append(coalesce(p_member_ids, '{}'), v_actor)) member_id) unique_members;
  if v_actor is null or coalesce(array_length(v_members, 1), 0) not between 2 and 20 then
    raise exception 'a direct channel requires 2-20 members';
  end if;
  foreach v_target in array v_members loop
    if v_target <> v_actor and not public.can_direct_message(v_target, v_actor) then
      raise exception 'direct messages are not allowed for target %', v_target;
    end if;
  end loop;
  v_kind := case when array_length(v_members, 1) = 2 then 'dm' else 'gdm' end;
  if v_kind = 'dm' then
    select c.id into v_existing
    from public.channels c
    where c.kind = 'dm'
      and (select array_agg(cm.user_id order by cm.user_id) from public.channel_members cm where cm.channel_id = c.id) = v_members
    limit 1;
    if v_existing is not null then return v_existing; end if;
  end if;
  v_name := left(coalesce(nullif(trim(p_name), ''), case when v_kind = 'dm' then 'Mensagem direta' else 'Novo grupo' end), 100);
  insert into public.channels(id, server_id, name, kind, position, private, created_by)
  values(v_channel_id, null, v_name, v_kind, 0, true, v_actor);
  insert into public.channel_members(channel_id, user_id)
  select v_channel_id, member_id from unnest(v_members) member_id;
  return v_channel_id;
end $$;

revoke all on function public.update_member_nickname(uuid,uuid,text),
  public.mark_channel_read(uuid,uuid), public.duplicate_channel(uuid),
  public.reorder_channel(uuid,text), public.duplicate_role(uuid),
  public.reorder_role(uuid,text) from public, anon, authenticated;
grant execute on function public.update_member_nickname(uuid,uuid,text),
  public.mark_channel_read(uuid,uuid), public.duplicate_channel(uuid),
  public.reorder_channel(uuid,text), public.duplicate_role(uuid),
  public.reorder_role(uuid,text) to authenticated;

commit;
