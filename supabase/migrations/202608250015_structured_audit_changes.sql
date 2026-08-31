begin;

create or replace function public.update_server(p_server_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_before text;
begin
  if not (public.is_server_owner(p_server_id) or public.has_server_permission(p_server_id, 65536)) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100 then raise exception 'invalid server name'; end if;
  select name into v_before from public.servers where id = p_server_id;
  update public.servers set name = trim(p_name) where id = p_server_id;
  perform public.write_audit(
    p_server_id, 'SERVER_UPDATE', 'SERVER', p_server_id,
    jsonb_build_object('before', jsonb_build_object('name', v_before),
      'after', jsonb_build_object('name', trim(p_name)))
  );
end $$;

create or replace function public.update_channel(
  p_channel_id uuid, p_name text, p_slowmode_seconds integer, p_private boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_channel public.channels%rowtype;
begin
  select * into v_channel from public.channels where id = p_channel_id;
  if not found or v_channel.server_id is null or not (
    public.is_server_owner(v_channel.server_id) or public.has_server_permission(v_channel.server_id, 32768)
  ) then raise exception 'forbidden'; end if;
  if char_length(trim(p_name)) not between 1 and 100 or p_slowmode_seconds not between 0 and 21600 then
    raise exception 'invalid channel settings';
  end if;
  update public.channels
  set name = trim(p_name), slowmode_seconds = p_slowmode_seconds, private = p_private
  where id = p_channel_id;
  perform public.write_audit(
    v_channel.server_id, 'CHANNEL_UPDATE', 'CHANNEL', p_channel_id,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_channel.name, 'slowmode_seconds', v_channel.slowmode_seconds, 'private', v_channel.private),
      'after', jsonb_build_object('name', trim(p_name), 'slowmode_seconds', p_slowmode_seconds, 'private', p_private)
    )
  );
end $$;

create or replace function public.update_role(
  p_role_id uuid, p_name text, p_color text, p_permissions bigint,
  p_hoist boolean, p_mentionable boolean
) returns void language plpgsql security definer set search_path = public as $$
declare v_role public.roles%rowtype; v_actor_permissions bigint; v_after_name text;
begin
  select * into v_role from public.roles where id = p_role_id;
  if not found or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  v_actor_permissions := public.effective_server_permissions(v_role.server_id);
  if not public.is_server_owner(v_role.server_id) and (p_permissions & ~v_actor_permissions) <> 0 then
    raise exception 'cannot grant unowned permissions';
  end if;
  v_after_name := case when v_role.is_default then v_role.name else left(trim(p_name), 100) end;
  update public.roles set
    name = v_after_name,
    color = p_color,
    permissions = p_permissions,
    hoist = case when is_default then false else p_hoist end,
    mentionable = p_mentionable
  where id = p_role_id;
  perform public.write_audit(
    v_role.server_id, 'ROLE_UPDATE', 'ROLE', p_role_id,
    jsonb_build_object(
      'before', jsonb_build_object('name', v_role.name, 'color', v_role.color,
        'permissions', v_role.permissions::text, 'hoist', v_role.hoist, 'mentionable', v_role.mentionable),
      'after', jsonb_build_object('name', v_after_name, 'color', p_color,
        'permissions', p_permissions::text, 'hoist', case when v_role.is_default then false else p_hoist end,
        'mentionable', p_mentionable)
    )
  );
end $$;

create or replace function public.create_invite(
  p_server_id uuid, p_channel_id uuid, p_max_uses integer default null,
  p_expires_in_minutes integer default 1440
) returns text language plpgsql security definer set search_path = public as $$
declare v_code text := encode(extensions.gen_random_bytes(9), 'base64'); v_invite_id uuid;
begin
  if not public.has_server_permission(p_server_id, 262144) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.channels where id = p_channel_id and server_id = p_server_id and kind <> 'category') then
    raise exception 'invalid channel';
  end if;
  if p_max_uses is not null and p_max_uses not between 1 and 100000 then raise exception 'invalid max uses'; end if;
  v_code := replace(replace(replace(v_code, '/', '_'), '+', '-'), '=', '');
  insert into public.invites(code, server_id, channel_id, creator_id, max_uses, expires_at)
  values(v_code, p_server_id, p_channel_id, auth.uid(), p_max_uses,
    case when p_expires_in_minutes is null then null
      else now() + make_interval(mins => greatest(1, least(p_expires_in_minutes, 10080))) end)
  returning id into v_invite_id;
  perform public.write_audit(
    p_server_id, 'INVITE_CREATE', 'INVITE', v_invite_id,
    jsonb_build_object('channel_id', p_channel_id, 'max_uses', p_max_uses,
      'expires_in_minutes', p_expires_in_minutes)
  );
  return v_code;
end $$;

commit;
