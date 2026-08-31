begin;

create table public.voice_move_requests (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers(id) on delete cascade,
  source_channel_id uuid not null references public.channels(id) on delete cascade,
  destination_channel_id uuid not null references public.channels(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 minute'),
  processed_at timestamptz,
  check (source_channel_id <> destination_channel_id),
  check (expires_at > created_at)
);

create index voice_move_requests_pending_target_idx
  on public.voice_move_requests(target_user_id, created_at desc)
  where processed_at is null;

create or replace function public.claim_voice_move_request()
returns table(
  request_id uuid,
  server_id uuid,
  source_channel_id uuid,
  destination_channel_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidate as (
    select request.id
    from public.voice_move_requests request
    where request.target_user_id = auth.uid()
      and request.processed_at is null
      and request.expires_at > now()
    order by request.created_at desc
    for update skip locked
    limit 1
  )
  update public.voice_move_requests request
  set processed_at = now()
  from candidate
  where request.id = candidate.id
  returning
    request.id,
    request.server_id,
    request.source_channel_id,
    request.destination_channel_id;
end;
$$;

grant select on public.voice_move_requests to authenticated;
grant select, insert, update, delete on public.voice_move_requests to service_role;
revoke all on function public.claim_voice_move_request()
  from public, anon, authenticated;
grant execute on function public.claim_voice_move_request() to authenticated;

alter table public.voice_move_requests enable row level security;
create policy voice_move_requests_target_select
on public.voice_move_requests for select to authenticated
using (target_user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'voice_move_requests'
  ) then
    alter publication supabase_realtime add table public.voice_move_requests;
  end if;
end $$;

commit;
