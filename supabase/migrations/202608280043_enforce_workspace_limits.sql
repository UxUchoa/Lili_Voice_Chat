begin;

create or replace function public.enforce_server_membership_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.server_members member
    where member.server_id = new.server_id and member.user_id = new.user_id
  ) then
    return new;
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('server-membership:' || new.user_id::text, 0)
  );
  if (
    select count(*) >= 100
    from public.server_members member
    where member.user_id = new.user_id
  ) then
    raise exception 'server membership limit reached';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_server_channel_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.server_id is null then return new; end if;
  perform pg_advisory_xact_lock(
    hashtextextended('server-channels:' || new.server_id::text, 0)
  );
  if (
    select count(*) >= 100
    from public.channels channel_row
    where channel_row.server_id = new.server_id
  ) then
    raise exception 'server channel limit reached';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_server_role_limit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('server-roles:' || new.server_id::text, 0)
  );
  if (
    select count(*) >= 100
    from public.roles role_row
    where role_row.server_id = new.server_id
  ) then
    raise exception 'server role limit reached';
  end if;
  return new;
end;
$$;

drop trigger if exists server_members_enforce_limit on public.server_members;
create trigger server_members_enforce_limit
before insert on public.server_members
for each row execute function public.enforce_server_membership_limit();

drop trigger if exists channels_enforce_limit on public.channels;
create trigger channels_enforce_limit
before insert on public.channels
for each row execute function public.enforce_server_channel_limit();

drop trigger if exists roles_enforce_limit on public.roles;
create trigger roles_enforce_limit
before insert on public.roles
for each row execute function public.enforce_server_role_limit();

revoke all on function public.enforce_server_membership_limit(),
  public.enforce_server_channel_limit(),
  public.enforce_server_role_limit()
from public, anon, authenticated;

commit;
