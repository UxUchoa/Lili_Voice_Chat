begin;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles','user_settings','friendships','servers','roles','channels',
    'channel_permission_overrides','push_subscriptions'
  ] loop
    execute format('create trigger %I_touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', table_name, table_name);
  end loop;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', 'user_' || substr(new.id::text, 1, 8)));
  if requested_username !~ '^[a-z0-9_.]{3,24}$' or exists(select 1 from public.profiles where username = requested_username) then
    requested_username := 'user_' || replace(substr(new.id::text, 1, 13), '-', '');
  end if;
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    requested_username,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), requested_username), 64)
  );
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_server_member(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.server_members
    where server_id = p_server_id and user_id = p_user_id
  );
$$;

create or replace function public.is_server_owner(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.servers
    where id = p_server_id and owner_id = p_user_id
  );
$$;

create or replace function public.is_channel_member(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.channel_members
    where channel_id = p_channel_id and user_id = p_user_id
  );
$$;

create or replace function public.share_server(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.server_members a
    join public.server_members b on b.server_id = a.server_id
    where a.user_id = p_left and b.user_id = p_right
  );
$$;

create or replace function public.share_channel(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1
    from public.channel_members a
    join public.channel_members b on b.channel_id = a.channel_id
    where a.user_id = p_left and b.user_id = p_right
  ) or public.share_server(p_left, p_right);
$$;

create or replace function public.are_friends(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.friendships
    where status = 'accepted'
      and requester_id in (p_left, p_right)
      and addressee_id in (p_left, p_right)
  );
$$;

create or replace function public.is_blocked_pair(p_left uuid, p_right uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.blocks
    where blocker_id in (p_left, p_right) and blocked_id in (p_left, p_right)
  );
$$;

create or replace function public.can_view_profile(p_profile_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id = p_actor_id or (
    not public.is_blocked_pair(p_profile_id, p_actor_id)
    and exists(
      select 1 from public.profiles p
      where p.id = p_profile_id
        and (p.profile_visible or public.are_friends(p_profile_id, p_actor_id) or public.share_server(p_profile_id, p_actor_id))
    )
  );
$$;

create or replace function public.can_request_friend(p_target_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_target_id <> p_actor_id
    and not public.is_blocked_pair(p_target_id, p_actor_id)
    and exists(
      select 1 from public.profiles p
      where p.id = p_target_id
        and (
          p.friend_request_policy = 'EVERYONE'
          or (p.friend_request_policy = 'SERVER_MEMBERS' and public.share_server(p_target_id, p_actor_id))
        )
    );
$$;

create or replace function public.can_direct_message(p_target_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_target_id <> p_actor_id
    and not public.is_blocked_pair(p_target_id, p_actor_id)
    and exists(
      select 1 from public.profiles p
      where p.id = p_target_id
        and (p.dm_policy = 'EVERYONE' or (p.dm_policy = 'FRIENDS' and public.are_friends(p_target_id, p_actor_id)))
    );
$$;

create or replace function public.effective_server_permissions(p_server_id uuid, p_user_id uuid default auth.uid())
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_server_owner(p_server_id, p_user_id) then 2305843009213693951::bigint
    when not public.is_server_member(p_server_id, p_user_id) then 0::bigint
    else coalesce((
      select bit_or(r.permissions)
      from public.roles r
      where r.server_id = p_server_id
        and (r.is_default or exists(
          select 1 from public.member_roles mr
          where mr.server_id = p_server_id and mr.user_id = p_user_id and mr.role_id = r.id
        ))
    ), 0::bigint)
  end;
$$;

create or replace function public.has_server_permission(p_server_id uuid, p_permission bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.effective_server_permissions(p_server_id, p_user_id) & p_permission) = p_permission;
$$;

create or replace function public.effective_channel_permissions(p_channel_id uuid, p_user_id uuid default auth.uid())
returns bigint
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_server_id uuid;
  v_kind text;
  v_permissions bigint;
  v_allow bigint;
  v_deny bigint;
  v_everyone_id uuid;
begin
  select server_id, kind into v_server_id, v_kind from public.channels where id = p_channel_id;
  if not found then return 0; end if;
  if v_kind in ('dm','gdm') then
    if exists(select 1 from public.channel_members where channel_id = p_channel_id and user_id = p_user_id)
      then return 2305843009213693951::bigint;
      else return 0;
    end if;
  end if;
  if not public.is_server_member(v_server_id, p_user_id) then return 0; end if;
  v_permissions := public.effective_server_permissions(v_server_id, p_user_id);
  if (v_permissions & 1152921504606846976::bigint) <> 0 then return 2305843009213693951::bigint; end if;

  select id into v_everyone_id from public.roles where server_id = v_server_id and is_default;
  select coalesce(allow_mask, 0), coalesce(deny_mask, 0) into v_allow, v_deny
  from public.channel_permission_overrides
  where channel_id = p_channel_id and target_type = 'ROLE' and target_id = v_everyone_id;
  v_permissions := (v_permissions & ~coalesce(v_deny, 0)) | coalesce(v_allow, 0);

  select coalesce(bit_or(o.allow_mask), 0), coalesce(bit_or(o.deny_mask), 0) into v_allow, v_deny
  from public.channel_permission_overrides o
  join public.member_roles mr on mr.role_id = o.target_id and mr.server_id = v_server_id and mr.user_id = p_user_id
  where o.channel_id = p_channel_id and o.target_type = 'ROLE';
  v_permissions := (v_permissions & ~coalesce(v_deny, 0)) | coalesce(v_allow, 0);

  select coalesce(allow_mask, 0), coalesce(deny_mask, 0) into v_allow, v_deny
  from public.channel_permission_overrides
  where channel_id = p_channel_id and target_type = 'MEMBER' and target_id = p_user_id;
  v_permissions := (v_permissions & ~coalesce(v_deny, 0)) | coalesce(v_allow, 0);
  return v_permissions;
end;
$$;

create or replace function public.has_channel_permission(p_channel_id uuid, p_permission bigint, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (public.effective_channel_permissions(p_channel_id, p_user_id) & p_permission) = p_permission
    and not (
      p_permission in (2::bigint, 64::bigint)
      and exists(
        select 1 from public.channels c
        join public.server_members sm on sm.server_id = c.server_id and sm.user_id = p_user_id
        where c.id = p_channel_id and sm.communication_disabled_until > now()
      )
    );
$$;

create or replace function public.highest_role_position(p_server_id uuid, p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_server_owner(p_server_id, p_user_id) then 2147483647
    else coalesce((
      select max(r.position) from public.member_roles mr
      join public.roles r on r.id = mr.role_id
      where mr.server_id = p_server_id and mr.user_id = p_user_id
    ), 0)
  end;
$$;

create or replace function public.can_manage_role(p_role_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.roles r
    where r.id = p_role_id and not r.is_default and not r.managed
      and (public.is_server_owner(r.server_id, p_actor_id) or (
        public.has_server_permission(r.server_id, 16384, p_actor_id)
        and public.highest_role_position(r.server_id, p_actor_id) > r.position
      ))
  );
$$;

create or replace function public.can_moderate_member(p_server_id uuid, p_target_id uuid, p_permission bigint, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_actor_id <> p_target_id
    and not public.is_server_owner(p_server_id, p_target_id)
    and (public.is_server_owner(p_server_id, p_actor_id) or (
      public.has_server_permission(p_server_id, p_permission, p_actor_id)
      and public.highest_role_position(p_server_id, p_actor_id) > public.highest_role_position(p_server_id, p_target_id)
    ));
$$;

create or replace function public.write_audit(
  p_server_id uuid, p_action text, p_target_type text, p_target_id uuid,
  p_changes jsonb default '{}', p_reason text default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs(server_id, actor_id, action_type, target_type, target_id, changes, reason)
  values (p_server_id, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_changes, '{}'), left(p_reason, 512));
$$;

create or replace function public.create_server(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server_id uuid := gen_random_uuid();
  v_everyone_id uuid := gen_random_uuid();
  v_user uuid := auth.uid();
  -- VIEW_CHANNEL, SEND_MESSAGES, CREATE_INVITES, ADD_REACTIONS,
  -- ATTACH_FILES, EMBED_LINKS, READ_HISTORY, CONNECT, SPEAK,
  -- STREAM and USE_VAD.
  v_base bigint := 1081868515::bigint;
begin
  if v_user is null then raise exception 'authentication required'; end if;
  if char_length(trim(p_name)) not between 1 and 100 then raise exception 'invalid server name'; end if;
  insert into public.servers(id, owner_id, name) values(v_server_id, v_user, trim(p_name));
  insert into public.server_members(server_id, user_id, join_source) values(v_server_id, v_user, 'owner-created-server');
  insert into public.roles(id, server_id, name, position, permissions, is_default)
    values(v_everyone_id, v_server_id, '@everyone', 0, v_base, true);
  insert into public.channels(server_id, name, kind, position, created_by)
    values (v_server_id, 'geral', 'text', 0, v_user), (v_server_id, 'Lounge', 'voice', 1, v_user);
  perform public.write_audit(v_server_id, 'SERVER_CREATE', 'SERVER', v_server_id, jsonb_build_object('name', trim(p_name)));
  return v_server_id;
end;
$$;

create or replace function public.create_channel(p_server_id uuid, p_name text, p_kind text, p_parent_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid := gen_random_uuid(); v_position integer;
begin
  if p_kind not in ('category','text','voice','thread') then raise exception 'invalid channel kind'; end if;
  if not (public.is_server_owner(p_server_id) or public.has_server_permission(p_server_id, 32768)) then raise exception 'forbidden'; end if;
  select coalesce(max(position), -1) + 1 into v_position from public.channels where server_id = p_server_id;
  insert into public.channels(id, server_id, parent_id, name, kind, position, created_by)
    values(v_id, p_server_id, p_parent_id, left(trim(p_name), 100), p_kind, v_position, auth.uid());
  perform public.write_audit(p_server_id, 'CHANNEL_CREATE', 'CHANNEL', v_id, jsonb_build_object('name', p_name, 'kind', p_kind));
  return v_id;
end;
$$;

create or replace function public.set_member_role(p_server_id uuid, p_target_id uuid, p_role_id uuid, p_assign boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_role public.roles%rowtype; v_actor_permissions bigint;
begin
  select * into v_role from public.roles where id = p_role_id and server_id = p_server_id;
  if not found or not public.can_manage_role(p_role_id) then raise exception 'forbidden'; end if;
  if public.highest_role_position(p_server_id, auth.uid()) <= public.highest_role_position(p_server_id, p_target_id) then raise exception 'hierarchy violation'; end if;
  v_actor_permissions := public.effective_server_permissions(p_server_id);
  if not public.is_server_owner(p_server_id) and (v_role.permissions & ~v_actor_permissions) <> 0 then raise exception 'cannot grant unowned permissions'; end if;
  if p_assign then
    insert into public.member_roles(server_id, user_id, role_id) values(p_server_id, p_target_id, p_role_id) on conflict do nothing;
  else
    delete from public.member_roles where server_id = p_server_id and user_id = p_target_id and role_id = p_role_id;
  end if;
  perform public.write_audit(p_server_id, 'MEMBER_ROLE_UPDATE', 'MEMBER', p_target_id, jsonb_build_object(case when p_assign then 'added_role_id' else 'removed_role_id' end, p_role_id));
end;
$$;

create or replace function public.set_channel_override(
  p_channel_id uuid, p_target_type text, p_target_id uuid, p_allow bigint, p_deny bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_server_id uuid;
begin
  select server_id into v_server_id from public.channels where id = p_channel_id;
  if v_server_id is null or p_target_type not in ('ROLE','MEMBER') or (p_allow & p_deny) <> 0 then raise exception 'invalid override'; end if;
  if not (public.is_server_owner(v_server_id) or public.has_server_permission(v_server_id, 32768)) then raise exception 'forbidden'; end if;
  if p_target_type = 'ROLE' and not exists(select 1 from public.roles where id = p_target_id and server_id = v_server_id) then raise exception 'invalid role'; end if;
  if p_target_type = 'MEMBER' and not public.is_server_member(v_server_id, p_target_id) then raise exception 'invalid member'; end if;
  insert into public.channel_permission_overrides(channel_id, target_type, target_id, allow_mask, deny_mask)
  values(p_channel_id, p_target_type, p_target_id, p_allow, p_deny)
  on conflict(channel_id, target_type, target_id) do update set allow_mask = excluded.allow_mask, deny_mask = excluded.deny_mask;
  perform public.write_audit(v_server_id, 'CHANNEL_OVERRIDE_UPDATE', p_target_type, p_target_id, jsonb_build_object('channel_id', p_channel_id, 'allow', p_allow, 'deny', p_deny));
end;
$$;

create or replace function public.moderate_member(
  p_server_id uuid, p_target_id uuid, p_action text, p_reason text default null, p_timeout_minutes integer default 10
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_permission bigint;
begin
  v_permission := case p_action when 'kick' then 2048 when 'ban' then 4096 when 'timeout' then 8192 else 0 end;
  if v_permission = 0 or not public.can_moderate_member(p_server_id, p_target_id, v_permission) then raise exception 'forbidden'; end if;
  if p_action = 'timeout' then
    update public.server_members set communication_disabled_until = now() + make_interval(mins => greatest(1, least(p_timeout_minutes, 40320)))
      where server_id = p_server_id and user_id = p_target_id;
  elsif p_action = 'kick' then
    delete from public.server_members where server_id = p_server_id and user_id = p_target_id;
  else
    insert into public.bans(server_id, user_id, actor_id, reason) values(p_server_id, p_target_id, auth.uid(), left(p_reason, 512))
      on conflict(server_id, user_id) do update set actor_id = excluded.actor_id, reason = excluded.reason, created_at = now();
    delete from public.server_members where server_id = p_server_id and user_id = p_target_id;
  end if;
  perform public.write_audit(p_server_id, 'MEMBER_' || upper(p_action), 'MEMBER', p_target_id, '{}', p_reason);
end;
$$;

create or replace function public.send_encrypted_message(
  p_channel_id uuid, p_device_id uuid, p_ciphertext text, p_nonce text,
  p_payload_version smallint, p_mls_epoch integer, p_reply_to_id uuid default null,
  p_mention_recipient_ids uuid[] default '{}'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_message_id uuid := gen_random_uuid(); v_user uuid := auth.uid();
begin
  if not public.has_channel_permission(p_channel_id, 2, v_user) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.devices where id = p_device_id and user_id = v_user and revoked_at is null) then raise exception 'invalid device'; end if;
  if char_length(p_ciphertext) > 131072 or p_mls_epoch < 1 then raise exception 'invalid payload'; end if;
  insert into public.messages(id, channel_id, author_id, sender_device_id, ciphertext, nonce, payload_version, mls_epoch, reply_to_id, mention_recipient_ids)
  values(v_message_id, p_channel_id, v_user, p_device_id, p_ciphertext, p_nonce, p_payload_version, p_mls_epoch, p_reply_to_id, coalesce(p_mention_recipient_ids, '{}'));
  return v_message_id;
end;
$$;

create or replace function public.create_direct_channel(p_member_ids uuid[], p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_id uuid := gen_random_uuid();
  v_actor uuid := auth.uid();
  v_members uuid[];
  v_target uuid;
  v_kind text;
  v_name text;
begin
  select array_agg(distinct member_id) into v_members
  from unnest(array_append(coalesce(p_member_ids, '{}'), v_actor)) member_id;
  if v_actor is null or coalesce(array_length(v_members, 1), 0) not between 2 and 20 then
    raise exception 'a direct channel requires 2-20 members';
  end if;
  foreach v_target in array v_members loop
    if v_target <> v_actor and not public.can_direct_message(v_target, v_actor) then
      raise exception 'direct messages are not allowed for target %', v_target;
    end if;
  end loop;
  v_kind := case when array_length(v_members, 1) = 2 then 'dm' else 'gdm' end;
  v_name := left(coalesce(nullif(trim(p_name), ''), case when v_kind = 'dm' then 'Mensagem direta' else 'Novo grupo' end), 100);
  insert into public.channels(id, server_id, name, kind, position, private, created_by)
    values(v_channel_id, null, v_name, v_kind, 0, true, v_actor);
  insert into public.channel_members(channel_id, user_id)
    select v_channel_id, member_id from unnest(v_members) member_id;
  return v_channel_id;
end;
$$;

create or replace function public.redeem_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_invite public.invites%rowtype;
begin
  select * into v_invite from public.invites where code = p_code for update;
  if not found or v_invite.revoked_at is not null or (v_invite.expires_at is not null and v_invite.expires_at <= now())
    or (v_invite.max_uses is not null and v_invite.uses >= v_invite.max_uses) then raise exception 'invalid invite'; end if;
  if exists(select 1 from public.bans where server_id = v_invite.server_id and user_id = auth.uid()) then raise exception 'banned'; end if;
  insert into public.server_members(server_id, user_id, join_source)
    values(v_invite.server_id, auth.uid(), 'invite:' || v_invite.code) on conflict do nothing;
  update public.invites set uses = uses + 1 where id = v_invite.id;
  return v_invite.server_id;
end;
$$;

create or replace function public.request_friend(p_addressee_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.can_request_friend(p_addressee_id) then raise exception 'friend request is not allowed'; end if;
  insert into public.friendships(requester_id, addressee_id, status)
  values(auth.uid(), p_addressee_id, 'pending')
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.respond_friend_request(p_friendship_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end
  where id = p_friendship_id
    and addressee_id = auth.uid()
    and status = 'pending';
  if not found then raise exception 'pending request not found'; end if;
end;
$$;

create or replace function public.transfer_server(p_server_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_server_owner(p_server_id) then raise exception 'forbidden'; end if;
  if p_new_owner_id = auth.uid() or not public.is_server_member(p_server_id, p_new_owner_id) then
    raise exception 'new owner must be another server member';
  end if;
  update public.servers set owner_id = p_new_owner_id where id = p_server_id;
  perform public.write_audit(p_server_id, 'SERVER_OWNER_TRANSFER', 'MEMBER', p_new_owner_id,
    jsonb_build_object('previous_owner_id', auth.uid()));
end;
$$;

create or replace function public.create_invite(
  p_server_id uuid, p_channel_id uuid, p_max_uses integer default null,
  p_expires_in_minutes integer default 1440
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_code text := encode(extensions.gen_random_bytes(9), 'base64');
begin
  if not public.has_server_permission(p_server_id, 262144) then raise exception 'forbidden'; end if;
  if not exists(select 1 from public.channels where id = p_channel_id and server_id = p_server_id) then
    raise exception 'invalid channel';
  end if;
  v_code := replace(replace(replace(v_code, '/', '_'), '+', '-'), '=', '');
  insert into public.invites(code, server_id, channel_id, creator_id, max_uses, expires_at)
  values(v_code, p_server_id, p_channel_id, auth.uid(), p_max_uses,
    case when p_expires_in_minutes is null then null
      else now() + make_interval(mins => greatest(1, least(p_expires_in_minutes, 10080))) end);
  return v_code;
end;
$$;

create or replace function public.enqueue_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_envelopes(recipient_user_id, message_id, channel_id, event_type)
  select distinct recipient, new.id, new.channel_id, 'MENTION'
  from unnest(new.mention_recipient_ids) recipient
  where recipient <> new.author_id and public.has_channel_permission(new.channel_id, 1, recipient)
  on conflict do nothing;
  return new;
end;
$$;
create trigger messages_enqueue_mentions after insert on public.messages
for each row execute function public.enqueue_mentions();

create or replace function public.protect_message_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.channel_id <> old.channel_id or new.author_id <> old.author_id
    or new.sender_device_id <> old.sender_device_id or new.created_at <> old.created_at then
    raise exception 'immutable message identity';
  end if;
  return new;
end;
$$;
create trigger messages_protect_identity before update on public.messages
for each row execute function public.protect_message_identity();

create or replace function public.protect_channel_identity()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id <> old.id or new.server_id is distinct from old.server_id or new.kind <> old.kind or new.created_by <> old.created_by then
    raise exception 'immutable channel identity';
  end if;
  return new;
end;
$$;
create trigger channels_protect_identity before update on public.channels
for each row execute function public.protect_channel_identity();

create or replace function public.protect_server_owner()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_id <> old.owner_id and (
    old.owner_id <> auth.uid()
    or new.owner_id = old.owner_id
    or not public.is_server_member(old.id, new.owner_id)
  ) then raise exception 'invalid server ownership transfer'; end if;
  return new;
end;
$$;
create trigger servers_protect_owner before update on public.servers
for each row execute function public.protect_server_owner();

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, update on public.user_settings to authenticated;
grant select, insert, update, delete on public.devices, public.blocks to authenticated;
grant select, delete on public.friendships to authenticated;
grant select, delete on public.servers to authenticated;
grant update(name, icon_path, banner_path, description) on public.servers to authenticated;
grant select on public.server_members, public.roles, public.member_roles, public.channel_permission_overrides, public.audit_logs, public.bans to authenticated;
grant select, insert, update, delete on public.channels to authenticated;
grant select on public.channel_members to authenticated;
grant select, update, delete on public.messages to authenticated;
grant select, insert, delete on public.message_attachments, public.message_reactions, public.message_pins to authenticated;
grant select, insert, update, delete on public.read_states, public.invites, public.notification_settings to authenticated;
grant select, insert, delete on public.e2ee_key_packages, public.channel_key_envelopes to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, update on public.notification_envelopes to authenticated;
grant select, insert, update on public.call_sessions to authenticated;

revoke all on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.is_server_member(uuid, uuid), public.is_server_owner(uuid, uuid),
  public.is_channel_member(uuid, uuid), public.share_server(uuid, uuid),
  public.share_channel(uuid, uuid), public.are_friends(uuid, uuid),
  public.is_blocked_pair(uuid, uuid), public.can_view_profile(uuid, uuid),
  public.can_request_friend(uuid, uuid), public.can_direct_message(uuid, uuid),
  public.effective_server_permissions(uuid, uuid), public.has_server_permission(uuid, bigint, uuid),
  public.effective_channel_permissions(uuid, uuid), public.has_channel_permission(uuid, bigint, uuid),
  public.highest_role_position(uuid, uuid), public.can_manage_role(uuid, uuid),
  public.can_moderate_member(uuid, uuid, bigint, uuid),
  public.create_server(text), public.create_channel(uuid, text, text, uuid),
  public.set_member_role(uuid, uuid, uuid, boolean),
  public.set_channel_override(uuid, text, uuid, bigint, bigint),
  public.moderate_member(uuid, uuid, text, text, integer),
  public.send_encrypted_message(uuid, uuid, text, text, smallint, integer, uuid, uuid[]),
  public.create_direct_channel(uuid[], text), public.redeem_invite(text),
  public.request_friend(uuid), public.respond_friend_request(uuid, boolean),
  public.transfer_server(uuid, uuid), public.create_invite(uuid, uuid, integer, integer)
to authenticated;

alter table public.profiles enable row level security;
create policy profiles_select on public.profiles for select to authenticated using (public.can_view_profile(id));
create policy profiles_update on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

alter table public.user_settings enable row level security;
create policy user_settings_own on public.user_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.devices enable row level security;
create policy devices_select on public.devices for select to authenticated using (user_id = (select auth.uid()) or public.share_channel(user_id, (select auth.uid())));
create policy devices_insert on public.devices for insert to authenticated with check (user_id = (select auth.uid()));
create policy devices_update on public.devices for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy devices_delete on public.devices for delete to authenticated using (user_id = (select auth.uid()));

alter table public.friendships enable row level security;
create policy friendships_select on public.friendships for select to authenticated using ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_insert on public.friendships for insert to authenticated with check (requester_id = (select auth.uid()) and public.can_request_friend(addressee_id));
create policy friendships_update on public.friendships for update to authenticated using ((select auth.uid()) in (requester_id, addressee_id)) with check ((select auth.uid()) in (requester_id, addressee_id));
create policy friendships_delete on public.friendships for delete to authenticated using ((select auth.uid()) in (requester_id, addressee_id));

alter table public.blocks enable row level security;
create policy blocks_select on public.blocks for select to authenticated using ((select auth.uid()) in (blocker_id, blocked_id));
create policy blocks_insert on public.blocks for insert to authenticated with check (blocker_id = (select auth.uid()));
create policy blocks_delete on public.blocks for delete to authenticated using (blocker_id = (select auth.uid()));

alter table public.servers enable row level security;
create policy servers_select on public.servers for select to authenticated using (public.is_server_member(id));
create policy servers_update on public.servers for update to authenticated using (public.is_server_owner(id) or public.has_server_permission(id, 65536)) with check (public.is_server_member(id));
create policy servers_delete on public.servers for delete to authenticated using (public.is_server_owner(id));

alter table public.server_members enable row level security;
create policy server_members_select on public.server_members for select to authenticated using (public.is_server_member(server_id));

alter table public.roles enable row level security;
create policy roles_select on public.roles for select to authenticated using (public.is_server_member(server_id));

alter table public.member_roles enable row level security;
create policy member_roles_select on public.member_roles for select to authenticated using (public.is_server_member(server_id));

alter table public.channels enable row level security;
create policy channels_select on public.channels for select to authenticated using (public.has_channel_permission(id, 1));
create policy channels_insert on public.channels for insert to authenticated with check (created_by = (select auth.uid()) and (public.is_server_owner(server_id) or public.has_server_permission(server_id, 32768)));
create policy channels_update on public.channels for update to authenticated using (public.is_server_owner(server_id) or public.has_server_permission(server_id, 32768)) with check (public.is_server_member(server_id));
create policy channels_delete on public.channels for delete to authenticated using (public.is_server_owner(server_id) or public.has_server_permission(server_id, 32768));

alter table public.channel_members enable row level security;
create policy channel_members_select on public.channel_members for select to authenticated using (public.is_channel_member(channel_id));

alter table public.channel_permission_overrides enable row level security;
create policy overrides_select on public.channel_permission_overrides for select to authenticated using (public.has_channel_permission(channel_id, 1));

alter table public.messages enable row level security;
create policy messages_select on public.messages for select to authenticated using (public.has_channel_permission(channel_id, 1));
create policy messages_update on public.messages for update to authenticated using (author_id = (select auth.uid()) or public.has_channel_permission(channel_id, 4)) with check (public.has_channel_permission(channel_id, 1));
create policy messages_delete on public.messages for delete to authenticated using (author_id = (select auth.uid()) or public.has_channel_permission(channel_id, 4));

alter table public.message_attachments enable row level security;
create policy attachments_select on public.message_attachments for select to authenticated using (public.has_channel_permission(channel_id, 1));
create policy attachments_insert on public.message_attachments for insert to authenticated with check (public.has_channel_permission(channel_id, 1048576));
create policy attachments_delete on public.message_attachments for delete to authenticated using (exists(select 1 from public.messages m where m.id = message_id and (m.author_id = (select auth.uid()) or public.has_channel_permission(m.channel_id, 4))));

alter table public.message_reactions enable row level security;
create policy reactions_select on public.message_reactions for select to authenticated using (exists(select 1 from public.messages m where m.id = message_id and public.has_channel_permission(m.channel_id, 1)));
create policy reactions_insert on public.message_reactions for insert to authenticated with check (user_id = (select auth.uid()) and exists(select 1 from public.messages m where m.id = message_id and public.has_channel_permission(m.channel_id, 524288)));
create policy reactions_delete on public.message_reactions for delete to authenticated using (user_id = (select auth.uid()));

alter table public.message_pins enable row level security;
create policy pins_select on public.message_pins for select to authenticated using (public.has_channel_permission(channel_id, 1));
create policy pins_insert on public.message_pins for insert to authenticated with check (pinned_by = (select auth.uid()) and public.has_channel_permission(channel_id, 8));
create policy pins_delete on public.message_pins for delete to authenticated using (pinned_by = (select auth.uid()) or public.has_channel_permission(channel_id, 8));

alter table public.read_states enable row level security;
create policy read_states_own on public.read_states for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()) and public.has_channel_permission(channel_id, 1));

alter table public.bans enable row level security;
create policy bans_select on public.bans for select to authenticated using (public.is_server_owner(server_id) or public.has_server_permission(server_id, 4096));

alter table public.invites enable row level security;
create policy invites_select on public.invites for select to authenticated using (public.is_server_member(server_id));
create policy invites_insert on public.invites for insert to authenticated with check (creator_id = (select auth.uid()) and public.has_server_permission(server_id, 262144));
create policy invites_update on public.invites for update to authenticated using (creator_id = (select auth.uid()) or public.has_server_permission(server_id, 262144)) with check (public.is_server_member(server_id));
create policy invites_delete on public.invites for delete to authenticated using (creator_id = (select auth.uid()) or public.has_server_permission(server_id, 262144));

alter table public.audit_logs enable row level security;
create policy audit_select on public.audit_logs for select to authenticated using (public.is_server_owner(server_id) or public.has_server_permission(server_id, 131072));

alter table public.notification_settings enable row level security;
create policy notification_settings_own on public.notification_settings for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.e2ee_key_packages enable row level security;
create policy key_packages_select on public.e2ee_key_packages for select to authenticated using (consumed_at is null and expires_at > now());
create policy key_packages_insert on public.e2ee_key_packages for insert to authenticated with check (user_id = (select auth.uid()) and exists(select 1 from public.devices d where d.id = device_id and d.user_id = (select auth.uid()) and d.revoked_at is null));
create policy key_packages_delete on public.e2ee_key_packages for delete to authenticated using (user_id = (select auth.uid()));

alter table public.channel_key_envelopes enable row level security;
create policy key_envelopes_select on public.channel_key_envelopes for select to authenticated using (recipient_user_id = (select auth.uid()));
create policy key_envelopes_insert on public.channel_key_envelopes for insert to authenticated with check (public.has_channel_permission(channel_id, 1) and exists(select 1 from public.devices d where d.id = recipient_device_id and d.user_id = recipient_user_id and d.revoked_at is null));
create policy key_envelopes_delete on public.channel_key_envelopes for delete to authenticated using (recipient_user_id = (select auth.uid()));

alter table public.push_subscriptions enable row level security;
create policy push_subscriptions_own on public.push_subscriptions for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table public.notification_envelopes enable row level security;
create policy notification_envelopes_select on public.notification_envelopes for select to authenticated using (recipient_user_id = (select auth.uid()));
create policy notification_envelopes_update on public.notification_envelopes for update to authenticated using (recipient_user_id = (select auth.uid())) with check (recipient_user_id = (select auth.uid()));

alter table public.call_sessions enable row level security;
create policy call_sessions_select on public.call_sessions for select to authenticated using (public.has_channel_permission(channel_id, 32));
create policy call_sessions_insert on public.call_sessions for insert to authenticated with check (created_by = (select auth.uid()) and public.has_channel_permission(channel_id, 32));
create policy call_sessions_update on public.call_sessions for update to authenticated using (created_by = (select auth.uid()) or public.has_channel_permission(channel_id, 1024)) with check (public.has_channel_permission(channel_id, 32));

commit;
