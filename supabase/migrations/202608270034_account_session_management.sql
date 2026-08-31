begin;

create function public.list_account_sessions()
returns table(
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  user_agent text,
  ip text,
  is_current boolean
)
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select
    session_row.id,
    session_row.created_at,
    session_row.updated_at,
    session_row.user_agent,
    session_row.ip::text,
    session_row.id = nullif(auth.jwt() ->> 'session_id', '')::uuid
  from auth.sessions session_row
  where session_row.user_id = auth.uid()
  order by session_row.updated_at desc nulls last,
    session_row.created_at desc nulls last;
$$;

create function public.revoke_account_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  if not exists (
    select 1 from auth.sessions session_row
    where session_row.id = p_session_id
      and session_row.user_id = auth.uid()
  ) then
    raise exception 'account session not found or forbidden';
  end if;
  delete from auth.sessions session_row
  where session_row.id = p_session_id
    and session_row.user_id = auth.uid();
end;
$$;

create function public.revoke_other_account_sessions()
returns integer
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_current_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_count integer;
begin
  if auth.uid() is null or v_current_session is null then
    raise exception 'authenticated session required';
  end if;
  delete from auth.sessions session_row
  where session_row.user_id = auth.uid()
    and session_row.id <> v_current_session;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.list_account_sessions(),
  public.revoke_account_session(uuid),
  public.revoke_other_account_sessions()
from public, anon, authenticated;
grant execute on function public.list_account_sessions(),
  public.revoke_account_session(uuid),
  public.revoke_other_account_sessions()
to authenticated;

commit;
