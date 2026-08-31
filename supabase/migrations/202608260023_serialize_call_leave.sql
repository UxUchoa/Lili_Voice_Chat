begin;

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

revoke all on function public.leave_call_session(uuid, uuid) from public, anon, authenticated;
grant execute on function public.leave_call_session(uuid, uuid) to authenticated;

commit;
