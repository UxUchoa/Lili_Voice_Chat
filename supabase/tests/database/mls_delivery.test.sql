begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('71000000-0000-0000-0000-000000000001', 'founder@janja.local', 'authenticated', 'authenticated', '{"username":"founder"}'),
  ('71000000-0000-0000-0000-000000000002', 'recipient@janja.local', 'authenticated', 'authenticated', '{"username":"recipient"}'),
  ('71000000-0000-0000-0000-000000000003', 'outsider-mls@janja.local', 'authenticated', 'authenticated', '{"username":"outsider_mls"}');
insert into public.servers(id, owner_id, name)
values ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'MLS server');
insert into public.server_members(server_id, user_id)
values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001'),
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, permissions, is_default)
values ('73000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '@everyone', 3, true);
insert into public.channels(id, server_id, name, kind, slowmode_seconds, created_by)
values
  ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', 'mls', 'text', 60, '71000000-0000-0000-0000-000000000001'),
  ('74000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', 'empty-mls', 'voice', 0, '71000000-0000-0000-0000-000000000001');
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values
  ('75000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', 'Founder', 'test', 'founder-mls', 'founder-public', 'founder:device'),
  ('75000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002', 'Recipient', 'test', 'recipient-mls', 'recipient-public', 'recipient:device');
insert into public.e2ee_key_packages(user_id, device_id, cipher_suite, key_package, expires_at)
values ('71000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000002', 3, 'public-key-package', now() + interval '1 day');

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(public.initialize_mls_group('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001'), true, 'first device atomically becomes founder');
select is(public.initialize_mls_group('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001'), false, 'group initialization is idempotent');
select is(public.initialize_mls_group('74000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000001'), true, 'a founder initializes a second empty group');
reset role;
update public.mls_groups set created_at = now() - interval '10 seconds'
where channel_id = '74000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(public.initialize_mls_group('74000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000002'), true, 'an authorized device recovers an abandoned empty group');
reset role;
select is(
  (select founder_device_id from public.mls_groups where channel_id = '74000000-0000-0000-0000-000000000002'),
  '75000000-0000-0000-0000-000000000002'::uuid,
  'empty-group recovery replaces the stale founder'
);
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is((select count(*) from public.channel_recipient_devices('74000000-0000-0000-0000-000000000001')), 2::bigint, 'recipient device list is channel scoped');
select is((select count(*) from public.claim_mls_key_package('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000001')), 1::bigint, 'founder atomically claims one KeyPackage');
select is((select count(*) from public.claim_mls_key_package('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000001')), 0::bigint, 'consumed KeyPackage cannot be claimed twice');
select lives_ok(
  $$select public.publish_mls_add('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', 1, '{"proposal":"AA","commit":"BB"}', '71000000-0000-0000-0000-000000000002', '75000000-0000-0000-0000-000000000002', '{"welcome":"CC","ratchetTree":"DD"}')$$,
  'event and Welcome publish atomically'
);
select is((select current_epoch from public.mls_groups where channel_id = '74000000-0000-0000-0000-000000000001'), 1, 'published commits advance the server epoch monotonically');

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.mls_group_events), 1::bigint, 'recipient can read ordered group events');
select is((select count(*) from public.channel_key_envelopes), 1::bigint, 'only recipient can read its Welcome envelope');
select ok((select (envelope::jsonb ? 'joinedAfterSequence') from public.channel_key_envelopes limit 1), 'Welcome records the exact join sequence');
select lives_ok(
  $$select public.send_encrypted_message('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', 'Y2lwaGVydGV4dA==', 'nonce-1', 3::smallint, 1, null::uuid, '{}'::uuid[])$$,
  'authorized member sends ciphertext'
);
select throws_like(
  $$select public.send_encrypted_message('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', 'Y2lwaGVydGV4dDI=', 'nonce-2', 3::smallint, 1, null::uuid, '{}'::uuid[])$$,
  '%slowmode active%',
  'server-enforced slowmode rejects immediate repeated sends'
);

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000003', true);
select is((select count(*) from public.mls_group_events), 0::bigint, 'outsider cannot enumerate MLS events');

reset role;
select is((select count(*) from public.mls_group_members where channel_id = '74000000-0000-0000-0000-000000000001' and removed_epoch is null), 2::bigint, 'database tracks both active MLS devices');
delete from public.server_members
where server_id = '72000000-0000-0000-0000-000000000001'
  and user_id = '71000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.publish_mls_remove('74000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-000000000002', 2, '{"proposal":"EE","commit":"FF","memberDeviceIds":["75000000-0000-0000-0000-000000000001"]}')$$,
  'founder can publish a remove commit only after channel access is lost'
);
select is((select current_epoch from public.mls_groups where channel_id = '74000000-0000-0000-0000-000000000001'), 2, 'remove commit advances the MLS epoch');
reset role;
select is((select count(*) from public.mls_group_members where channel_id = '74000000-0000-0000-0000-000000000001' and removed_epoch is null), 1::bigint, 'removed device is no longer an active MLS member');
select is((select event_type from public.mls_group_events where channel_id = '74000000-0000-0000-0000-000000000001' order by sequence desc limit 1), 'REMOVE_COMMIT', 'ordered event stream records the cryptographic removal');

select * from finish();
rollback;
