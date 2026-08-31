begin;

alter table public.call_session_participants
  add column if not exists last_seen_at timestamptz not null default now();

create index if not exists call_session_participants_active_heartbeat_idx
  on public.call_session_participants(session_id, last_seen_at)
  where left_at is null;

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

  -- Uma aba encerrada à força não consegue chamar leave_call_session. O
  -- heartbeat impede que essa presença fantasma bloqueie a sala para sempre.
  update public.call_session_participants
  set left_at = clock_timestamp()
  where session_id = p_session_id
    and left_at is null
    and last_seen_at < clock_timestamp() - interval '45 seconds';

  update public.call_session_participants
  set left_at = clock_timestamp()
  where device_id = p_device_id and left_at is null and session_id <> p_session_id;

  update public.call_session_participants
  set last_seen_at = clock_timestamp()
  where session_id = p_session_id
    and device_id = p_device_id
    and user_id = v_user_id
    and left_at is null
  returning id into v_participant_id;
  if v_participant_id is not null then return v_participant_id; end if;

  -- LiveKit usa user_id como identidade. Uma nova sessão do mesmo usuário
  -- substitui o dispositivo anterior em vez de consumir outra vaga.
  update public.call_session_participants
  set left_at = clock_timestamp()
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

  insert into public.call_session_participants(
    session_id, user_id, device_id, last_seen_at
  ) values (
    p_session_id, v_user_id, p_device_id, clock_timestamp()
  ) returning id into v_participant_id;
  return v_participant_id;
end;
$$;

create or replace function public.heartbeat_call_session(
  p_session_id uuid,
  p_device_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.call_session_participants
  set last_seen_at = clock_timestamp()
  where session_id = p_session_id
    and device_id = p_device_id
    and user_id = auth.uid()
    and left_at is null;
  if not found then raise exception 'active call participant not found'; end if;
end;
$$;

create or replace function public.reap_stale_call_participants()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_reaped integer := 0;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;

  with stale as (
    update public.call_session_participants participant
    set left_at = clock_timestamp()
    from public.call_sessions session
    where participant.session_id = session.id
      and participant.left_at is null
      and participant.last_seen_at < clock_timestamp() - interval '45 seconds'
      and public.has_channel_permission(session.channel_id, 32, v_user_id)
    returning participant.id
  ) select count(*) into v_reaped from stale;

  update public.call_sessions session
  set ended_at = clock_timestamp()
  where session.ended_at is null
    and public.has_channel_permission(session.channel_id, 32, v_user_id)
    and not exists (
      select 1 from public.call_session_participants participant
      where participant.session_id = session.id and participant.left_at is null
    )
    and (
      exists (
        select 1 from public.call_session_participants participant
        where participant.session_id = session.id
      )
      or session.created_at < clock_timestamp() - interval '45 seconds'
    );

  return v_reaped;
end;
$$;

revoke all on function public.join_call_session(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.heartbeat_call_session(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reap_stale_call_participants()
  from public, anon, authenticated;
grant execute on function public.join_call_session(uuid, uuid) to authenticated;
grant execute on function public.heartbeat_call_session(uuid, uuid) to authenticated;
grant execute on function public.reap_stale_call_participants() to authenticated;

commit;
