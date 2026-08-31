begin;

-- A criação do token antecede o registro do participante por alguns segundos.
-- Não encerrar essa sessão vazia enquanto o cliente ainda está conectando.
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

revoke all on function public.reap_stale_call_participants()
  from public, anon, authenticated;
grant execute on function public.reap_stale_call_participants() to authenticated;

commit;
