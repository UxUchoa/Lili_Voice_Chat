begin;

create or replace function public.update_server(p_server_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_server_owner(p_server_id) or public.has_server_permission(p_server_id, 65536)) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100 then raise exception 'invalid server name'; end if;
  update public.servers set name = trim(p_name) where id = p_server_id;
  perform public.write_audit(p_server_id, 'SERVER_UPDATE', 'SERVER', p_server_id, jsonb_build_object('name', trim(p_name)));
end $$;

create or replace function public.delete_server(p_server_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_server_owner(p_server_id) then raise exception 'forbidden'; end if;
  delete from public.servers where id = p_server_id;
end $$;

create or replace function public.leave_server(p_server_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_server_owner(p_server_id) then raise exception 'owner must transfer or delete the server'; end if;
  delete from public.server_members where server_id = p_server_id and user_id = auth.uid();
end $$;

create or replace function public.update_channel(
  p_channel_id uuid, p_name text, p_slowmode_seconds integer, p_private boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_server_id uuid;
begin
  select server_id into v_server_id from public.channels where id = p_channel_id;
  if v_server_id is null or not (public.is_server_owner(v_server_id) or public.has_server_permission(v_server_id, 32768)) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or p_slowmode_seconds not between 0 and 21600 then raise exception 'invalid channel settings'; end if;
  update public.channels set name = trim(p_name), slowmode_seconds = p_slowmode_seconds, private = p_private where id = p_channel_id;
  perform public.write_audit(v_server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id, jsonb_build_object('name', trim(p_name), 'slowmode_seconds', p_slowmode_seconds, 'private', p_private));
end $$;

create or replace function public.delete_channel(p_channel_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_server_id uuid;
begin
  select server_id into v_server_id from public.channels where id = p_channel_id;
  if v_server_id is null or not (public.is_server_owner(v_server_id) or public.has_server_permission(v_server_id, 32768)) then raise exception 'forbidden'; end if;
  delete from public.channels where id = p_channel_id;
  perform public.write_audit(v_server_id, 'CHANNEL_DELETE', 'CHANNEL', p_channel_id, '{}');
end $$;

create or replace function public.create_role(p_server_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := gen_random_uuid(); v_position integer;
begin
  if not public.has_server_permission(p_server_id, 16384) then raise exception 'forbidden'; end if;
  select coalesce(max(position), 0) + 1 into v_position from public.roles where server_id = p_server_id;
  insert into public.roles(id, server_id, name, position, permissions, color)
  values(v_id, p_server_id, left(trim(p_name), 100), v_position, 0, '#b8b2b5');
  perform public.write_audit(p_server_id, 'ROLE_CREATE', 'ROLE', v_id, jsonb_build_object('name', trim(p_name)));
  return v_id;
end $$;

create or replace function public.update_role(
  p_role_id uuid, p_name text, p_color text, p_permissions bigint,
  p_hoist boolean, p_mentionable boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_role public.roles%rowtype; v_actor_permissions bigint;
begin
  select * into v_role from public.roles where id = p_role_id;
  if not found or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  v_actor_permissions := public.effective_server_permissions(v_role.server_id);
  if not public.is_server_owner(v_role.server_id) and (p_permissions & ~v_actor_permissions) <> 0 then raise exception 'cannot grant unowned permissions'; end if;
  update public.roles set
    name = case when is_default then name else left(trim(p_name), 100) end,
    color = p_color, permissions = p_permissions,
    hoist = case when is_default then false else p_hoist end,
    mentionable = p_mentionable
  where id = p_role_id;
  perform public.write_audit(v_role.server_id, 'ROLE_UPDATE', 'ROLE', p_role_id, jsonb_build_object('permissions', p_permissions::text));
end $$;

create or replace function public.delete_role(p_role_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_role public.roles%rowtype;
begin
  select * into v_role from public.roles where id = p_role_id;
  if not found or v_role.is_default or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  delete from public.roles where id = p_role_id;
  perform public.write_audit(v_role.server_id, 'ROLE_DELETE', 'ROLE', p_role_id, '{}');
end $$;

create or replace function public.unban_member(p_server_id uuid, p_target_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_server_owner(p_server_id) or public.has_server_permission(p_server_id, 4096)) then raise exception 'forbidden'; end if;
  delete from public.bans where server_id = p_server_id and user_id = p_target_id;
  perform public.write_audit(p_server_id, 'MEMBER_UNBAN', 'MEMBER', p_target_id, '{}');
end $$;

revoke all on function public.update_server(uuid,text), public.delete_server(uuid), public.leave_server(uuid),
  public.update_channel(uuid,text,integer,boolean), public.delete_channel(uuid),
  public.create_role(uuid,text), public.update_role(uuid,text,text,bigint,boolean,boolean),
  public.delete_role(uuid), public.unban_member(uuid,uuid) from public, anon, authenticated;
grant execute on function public.update_server(uuid,text), public.delete_server(uuid), public.leave_server(uuid),
  public.update_channel(uuid,text,integer,boolean), public.delete_channel(uuid),
  public.create_role(uuid,text), public.update_role(uuid,text,text,bigint,boolean,boolean),
  public.delete_role(uuid), public.unban_member(uuid,uuid) to authenticated;

commit;
