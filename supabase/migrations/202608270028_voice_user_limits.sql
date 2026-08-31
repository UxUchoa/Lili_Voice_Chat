begin;

drop function if exists public.update_channel(uuid, text, integer, boolean);

create function public.update_channel(
  p_channel_id uuid,
  p_name text,
  p_slowmode_seconds integer,
  p_private boolean,
  p_user_limit integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel public.channels%rowtype;
  v_everyone_id uuid;
  v_allow bigint;
  v_deny bigint;
  v_next_user_limit integer;
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

  v_next_user_limit := case when v_channel.kind = 'voice' then p_user_limit else 0 end;
  update public.channels
  set name = trim(p_name),
      slowmode_seconds = p_slowmode_seconds,
      private = p_private,
      user_limit = v_next_user_limit
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
        'user_limit', v_channel.user_limit
      ),
      'after', jsonb_build_object(
        'name', trim(p_name),
        'slowmode_seconds', p_slowmode_seconds,
        'private', p_private,
        'user_limit', v_next_user_limit
      )
    )
  );
end;
$$;

revoke all on function public.update_channel(uuid,text,integer,boolean,integer)
  from public, anon, authenticated;
grant execute on function public.update_channel(uuid,text,integer,boolean,integer)
  to authenticated;

create or replace function public.join_call_session(
  p_session_id uuid,
  p_device_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_session public.call_sessions%rowtype;
  v_participant_id uuid;
  v_user_id uuid := auth.uid();
  v_user_limit integer;
begin
  select * into v_session
  from public.call_sessions
  where id = p_session_id
  for update;

  if not found or v_session.ended_at is not null then
    raise exception 'call session is not active';
  end if;
  if not public.has_channel_permission(v_session.channel_id, 32, v_user_id) then
    raise exception 'forbidden';
  end if;
  if not exists (
    select 1 from public.devices
    where id = p_device_id and user_id = v_user_id and revoked_at is null
  ) then
    raise exception 'invalid device';
  end if;

  update public.call_session_participants
  set left_at = now()
  where device_id = p_device_id and left_at is null and session_id <> p_session_id;

  select id into v_participant_id
  from public.call_session_participants
  where session_id = p_session_id and device_id = p_device_id and left_at is null;
  if v_participant_id is not null then return v_participant_id; end if;

  -- LiveKit usa user_id como identidade. Uma nova sessão do mesmo usuário
  -- substitui o dispositivo anterior em vez de consumir outra vaga.
  update public.call_session_participants
  set left_at = now()
  where session_id = p_session_id
    and user_id = v_user_id
    and left_at is null;

  select user_limit into v_user_limit
  from public.channels
  where id = v_session.channel_id;

  if v_user_limit > 0 and (
    select count(distinct participant.user_id)
    from public.call_session_participants participant
    where participant.session_id = p_session_id
      and participant.left_at is null
  ) >= v_user_limit then
    raise exception 'voice channel is full';
  end if;

  insert into public.call_session_participants(session_id, user_id, device_id)
  values(p_session_id, v_user_id, p_device_id)
  returning id into v_participant_id;
  return v_participant_id;
end;
$$;

revoke all on function public.join_call_session(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.join_call_session(uuid, uuid)
  to authenticated;

commit;

