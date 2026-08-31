begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select is(public.quota_alert_level(69, 100), 'OK', 'usage below 70 percent is OK');
select is(public.quota_alert_level(70, 100), 'NOTICE', '70 percent raises a notice');
select is(public.quota_alert_level(85, 100), 'WARNING', '85 percent raises a warning');
select is(public.quota_alert_level(95, 100), 'CRITICAL', '95 percent is critical');

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('19000000-0000-0000-0000-000000000001', 'quota-owner@janja.local', 'authenticated', 'authenticated', '{"username":"quota_owner","display_name":"Quota owner"}'),
  ('19000000-0000-0000-0000-000000000002', 'quota-member@janja.local', 'authenticated', 'authenticated', '{"username":"quota_member","display_name":"Quota member"}');
insert into public.servers(id, owner_id, name)
values ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Quota server');
insert into public.server_members(server_id, user_id)
values
  ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001'),
  ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, position, permissions, is_default)
values ('39000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '@everyone', 0, 3, true);
insert into public.channels(id, server_id, name, kind, created_by)
values (
  '49000000-0000-0000-0000-000000000001',
  '29000000-0000-0000-0000-000000000001',
  'quota-uploads',
  'text',
  '19000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.instance_quota_status()), 1::bigint, 'a server owner can open the instance dashboard');
select ok((select database_used_bytes > 0 from public.instance_quota_status()), 'the dashboard measures the actual database size');
select ok((select database_percent >= 0 and storage_percent >= 0 from public.instance_quota_status()), 'the dashboard returns real percentages');
select is(
  (select database_limit_bytes from public.instance_quota_status()),
  524288000::bigint,
  'the default database budget matches the 500 MB deployment target'
);
select is(
  (select storage_limit_bytes from public.instance_quota_status()),
  1073741824::bigint,
  'the default storage budget matches the 1 GB deployment target'
);
select ok(
  public.can_accept_storage_upload(1),
  'an upload is accepted while storage remains below 95 percent'
);
select lives_ok(
  $$insert into storage.objects(bucket_id, name, owner_id, metadata)
    values (
      'attachments',
      '49000000-0000-0000-0000-000000000001/quota-ok.bin',
      '19000000-0000-0000-0000-000000000001',
      '{"size":1}'::jsonb
    )$$,
  'the Storage RLS policy accepts an authorized upload below the cutoff'
);
select throws_ok(
  $$select * from public.instance_quota_config$$,
  '42501', 'permission denied for table instance_quota_config',
  'authenticated users cannot read or alter raw quota configuration'
);
reset role;

update public.instance_quota_config
set storage_limit_bytes = 1
where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  public.can_accept_storage_upload(1),
  false,
  'a new upload is rejected when it would reach the 95 percent cutoff'
);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, owner_id, metadata)
    values (
      'attachments',
      '49000000-0000-0000-0000-000000000001/quota-blocked.bin',
      '19000000-0000-0000-0000-000000000001',
      '{"size":1}'::jsonb
    )$$,
  '42501',
  'new row violates row-level security policy for table "objects"',
  'the Storage RLS policy blocks an upload at the critical cutoff'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select throws_ok(
  $$select * from public.instance_quota_status()$$,
  'P0001', 'instance quota dashboard requires a server owner',
  'a non-owner cannot inspect instance-wide usage'
);

select * from finish();
rollback;
