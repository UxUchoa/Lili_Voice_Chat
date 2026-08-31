begin;

-- Uma sala LiveKit representa uma ocorrência de chamada. O nome fixo anterior
-- impedia registrar uma segunda chamada no mesmo canal.
alter table public.call_sessions
  drop constraint if exists call_sessions_room_name_key;
create unique index if not exists call_sessions_room_name_idx
  on public.call_sessions(room_name);
create unique index if not exists call_sessions_one_active_per_channel_idx
  on public.call_sessions(channel_id)
  where ended_at is null;

create table public.call_session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  device_id uuid not null references public.devices(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  check (left_at is null or left_at >= joined_at)
);

create unique index call_session_participants_active_device_idx
  on public.call_session_participants(session_id, device_id)
  where left_at is null;
create index call_session_participants_user_idx
  on public.call_session_participants(user_id, joined_at desc);

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

  insert into public.call_session_participants(session_id, user_id, device_id)
  values(p_session_id, v_user_id, p_device_id)
  returning id into v_participant_id;
  return v_participant_id;
end;
$$;

create or replace function public.leave_call_session(
  p_session_id uuid,
  p_device_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_user_id uuid := auth.uid();
begin
  -- Serializa saídas simultâneas. Sem este lock, dois últimos participantes
  -- podem enxergar um ao outro como ativos e nenhum encerrar a sessão.
  perform 1 from public.call_sessions where id = p_session_id for update;
  if not found then raise exception 'call session not found'; end if;

  update public.call_session_participants
  set left_at = now()
  where session_id = p_session_id
    and device_id = p_device_id
    and user_id = v_user_id
    and left_at is null;

  if not exists (
    select 1 from public.call_session_participants
    where session_id = p_session_id and left_at is null
  ) then
    update public.call_sessions
    set ended_at = coalesce(ended_at, now())
    where id = p_session_id;
  end if;
end;
$$;

grant select on public.call_session_participants to authenticated, service_role;
revoke all on function public.join_call_session(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_call_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.join_call_session(uuid, uuid) to authenticated;
grant execute on function public.leave_call_session(uuid, uuid) to authenticated;

alter table public.call_session_participants enable row level security;
create policy call_session_participants_select
on public.call_session_participants for select to authenticated
using (
  exists (
    select 1 from public.call_sessions session
    where session.id = session_id
      and public.has_channel_permission(session.channel_id, 32)
  )
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_session_participants'
  ) then
    alter publication supabase_realtime add table public.call_session_participants;
  end if;
end $$;

commit;
