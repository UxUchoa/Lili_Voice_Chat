begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values (
  '1a000000-0000-0000-0000-000000000001',
  'limits-owner@lili.local',
  'authenticated',
  'authenticated',
  '{"username":"limits_owner","display_name":"Limits owner"}'
);
insert into public.servers(id, owner_id, name)
values (
  '2a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  'Limits server'
);
insert into public.server_members(server_id, user_id)
values (
  '2a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001'
);
insert into public.roles(id, server_id, name, position, permissions, is_default)
values (
  '3a000000-0000-0000-0000-000000000001',
  '2a000000-0000-0000-0000-000000000001',
  '@everyone',
  0,
  11,
  true
);
insert into public.channels(id, server_id, name, kind, created_by)
values (
  '4a000000-0000-0000-0000-000000000001',
  '2a000000-0000-0000-0000-000000000001',
  'pins',
  'text',
  '1a000000-0000-0000-0000-000000000001'
);
insert into public.devices(
  id, user_id, name, platform, fingerprint, identity_public_key, mls_credential
)
values (
  '5a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  'Limits device',
  'test',
  'limits-fingerprint',
  'limits-public-key',
  'limits:device'
);

insert into public.messages(
  id, channel_id, author_id, sender_device_id, body, payload_version
)
select
  md5('limits-message-' || item)::uuid,
  '4a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001',
  '5a000000-0000-0000-0000-000000000001',
  'cipher-' || item,
  4
from generate_series(1, 251) item;

insert into public.message_pins(message_id, channel_id, pinned_by)
select
  md5('limits-message-' || item)::uuid,
  '4a000000-0000-0000-0000-000000000001',
  '1a000000-0000-0000-0000-000000000001'
from generate_series(1, 250) item;

select is(
  (select count(*) from public.message_pins
   where channel_id = '4a000000-0000-0000-0000-000000000001'),
  250::bigint,
  'a channel accepts exactly 250 pinned messages'
);
select throws_ok(
  $$insert into public.message_pins(message_id, channel_id, pinned_by)
    values (
      md5('limits-message-251')::uuid,
      '4a000000-0000-0000-0000-000000000001',
      '1a000000-0000-0000-0000-000000000001'
    )$$,
  'P0001',
  'channel pin limit reached',
  'the database rejects pin 251 even when the client is bypassed'
);

select * from finish();
rollback;
