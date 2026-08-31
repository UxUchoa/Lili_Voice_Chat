begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values (
  '1b000000-0000-0000-0000-000000000001',
  'workspace-limits@lili.local',
  'authenticated',
  'authenticated',
  '{"username":"workspace_limits","display_name":"Workspace limits"}'
);

insert into public.servers(id, owner_id, name)
select
  md5('workspace-limit-server-' || item)::uuid,
  '1b000000-0000-0000-0000-000000000001',
  'Server ' || item
from generate_series(1, 101) item;

insert into public.server_members(server_id, user_id)
select
  md5('workspace-limit-server-' || item)::uuid,
  '1b000000-0000-0000-0000-000000000001'
from generate_series(1, 100) item;

select is(
  (select count(*) from public.server_members
   where user_id = '1b000000-0000-0000-0000-000000000001'),
  100::bigint,
  'a user can belong to exactly 100 servers'
);
select throws_ok(
  $$insert into public.server_members(server_id, user_id)
    values (
      md5('workspace-limit-server-101')::uuid,
      '1b000000-0000-0000-0000-000000000001'
    )$$,
  'P0001',
  'server membership limit reached',
  'membership 101 is rejected transactionally'
);

insert into public.channels(id, server_id, name, kind, created_by)
select
  md5('workspace-limit-channel-' || item)::uuid,
  md5('workspace-limit-server-1')::uuid,
  'Channel ' || item,
  'text',
  '1b000000-0000-0000-0000-000000000001'
from generate_series(1, 100) item;

select is(
  (select count(*) from public.channels
   where server_id = md5('workspace-limit-server-1')::uuid),
  100::bigint,
  'a server can contain exactly 100 channels'
);
select throws_ok(
  $$insert into public.channels(server_id, name, kind, created_by)
    values (
      md5('workspace-limit-server-1')::uuid,
      'Channel 101',
      'text',
      '1b000000-0000-0000-0000-000000000001'
    )$$,
  'P0001',
  'server channel limit reached',
  'channel 101 is rejected transactionally'
);

insert into public.roles(id, server_id, name, position, permissions, is_default)
select
  md5('workspace-limit-role-' || item)::uuid,
  md5('workspace-limit-server-1')::uuid,
  case when item = 1 then '@everyone' else 'Role ' || item end,
  item - 1,
  0,
  item = 1
from generate_series(1, 100) item;

select is(
  (select count(*) from public.roles
   where server_id = md5('workspace-limit-server-1')::uuid),
  100::bigint,
  'a server can contain exactly 100 roles including @everyone'
);
select throws_ok(
  $$insert into public.roles(server_id, name, position, permissions)
    values (
      md5('workspace-limit-server-1')::uuid,
      'Role 101',
      100,
      0
    )$$,
  'P0001',
  'server role limit reached',
  'role 101 is rejected transactionally'
);

select * from finish();
rollback;
