begin;

create table public.instance_quota_config (
  singleton boolean primary key default true check (singleton),
  database_limit_bytes bigint not null check (database_limit_bytes > 0),
  storage_limit_bytes bigint not null check (storage_limit_bytes > 0),
  updated_at timestamptz not null default now()
);

insert into public.instance_quota_config(
  singleton,
  database_limit_bytes,
  storage_limit_bytes
) values (
  true,
  10737418240,
  10737418240
);

alter table public.instance_quota_config enable row level security;
revoke all on public.instance_quota_config from public, anon, authenticated;
grant select, insert, update on public.instance_quota_config to service_role;

create function public.quota_alert_level(
  p_used_bytes bigint,
  p_limit_bytes bigint
) returns text
language sql
immutable
strict
set search_path = public, pg_temp
as $$
  select case
    when p_limit_bytes <= 0 then 'UNCONFIGURED'
    when p_used_bytes::numeric / p_limit_bytes >= 0.95 then 'CRITICAL'
    when p_used_bytes::numeric / p_limit_bytes >= 0.85 then 'WARNING'
    when p_used_bytes::numeric / p_limit_bytes >= 0.70 then 'NOTICE'
    else 'OK'
  end;
$$;

create function public.instance_quota_status()
returns table(
  database_used_bytes bigint,
  database_limit_bytes bigint,
  database_percent numeric,
  database_level text,
  storage_used_bytes bigint,
  storage_limit_bytes bigint,
  storage_percent numeric,
  storage_level text,
  measured_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_database_used bigint;
  v_storage_used bigint;
  v_config public.instance_quota_config%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from public.servers server_row
    where server_row.owner_id = auth.uid()
  ) then
    raise exception 'instance quota dashboard requires a server owner';
  end if;
  select * into strict v_config from public.instance_quota_config
  where singleton;
  select pg_database_size(current_database()) into v_database_used;
  select coalesce(sum(
    case
      when object_row.metadata ->> 'size' ~ '^[0-9]+$'
        then (object_row.metadata ->> 'size')::bigint
      else 0
    end
  ), 0)::bigint into v_storage_used
  from storage.objects object_row;

  return query select
    v_database_used,
    v_config.database_limit_bytes,
    round(v_database_used::numeric * 100 / v_config.database_limit_bytes, 2),
    public.quota_alert_level(v_database_used, v_config.database_limit_bytes),
    v_storage_used,
    v_config.storage_limit_bytes,
    round(v_storage_used::numeric * 100 / v_config.storage_limit_bytes, 2),
    public.quota_alert_level(v_storage_used, v_config.storage_limit_bytes),
    now();
end;
$$;

revoke all on function public.quota_alert_level(bigint, bigint),
  public.instance_quota_status()
from public, anon, authenticated;
grant execute on function public.instance_quota_status() to authenticated;
grant execute on function public.quota_alert_level(bigint, bigint)
  to service_role;

commit;
