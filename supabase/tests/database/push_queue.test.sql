begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('11000000-0000-0000-0000-000000000001', 'push-owner@lili.local', 'authenticated', 'authenticated', '{"username":"push_owner","display_name":"Push owner"}'),
  ('11000000-0000-0000-0000-000000000002', 'push-member@lili.local', 'authenticated', 'authenticated', '{"username":"push_member","display_name":"Push member"}');

insert into public.servers(id, owner_id, name)
values ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Push server');
insert into public.server_members(server_id, user_id)
values
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001'),
  ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, position, permissions, is_default)
values ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '@everyone', 0, 3, true);
insert into public.channels(id, server_id, name, kind, created_by)
values ('41000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'push', 'text', '11000000-0000-0000-0000-000000000001');
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values ('51000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Push sender', 'test', 'push-sender-fingerprint', 'push-sender-key', 'push:sender');
insert into public.push_subscriptions(user_id, endpoint, p256dh, auth)
values ('11000000-0000-0000-0000-000000000002', 'https://push.invalid/member', 'test-p256dh', 'test-auth');

insert into public.notification_settings(user_id, scope_type, scope_id, mode)
values ('11000000-0000-0000-0000-000000000002', 'GLOBAL', '*', 'MENTIONS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.send_encrypted_message('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'cipher-one', 'nonce-one', 3::smallint, 0, null, '{}')$$,
  'a non-mention encrypted message is accepted'
);
reset role;
select is(
  (select count(*) from public.notification_envelopes
   where channel_id = '41000000-0000-0000-0000-000000000001'),
  0::bigint,
  'MENTIONS mode does not enqueue ordinary messages'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.send_encrypted_message('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'cipher-two', 'nonce-two', 3::smallint, 0, null, array['11000000-0000-0000-0000-000000000002'::uuid])$$,
  'an encrypted mention is accepted'
);
reset role;
select is(
  (select event_type from public.notification_envelopes
   where channel_id = '41000000-0000-0000-0000-000000000001' limit 1),
  'MENTION',
  'MENTIONS mode enqueues only a generic mention envelope'
);
select is(
  (select mention_count from public.read_states where user_id = '11000000-0000-0000-0000-000000000002'),
  1,
  'a mention increments the recipient read-state counter'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.send_encrypted_message('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'cipher-invalid', 'nonce-invalid', 3::smallint, 0, null, array['11000000-0000-0000-0000-000000000099'::uuid])$$,
  'P0001',
  'invalid mention recipient',
  'a sender cannot create notification metadata for a user without channel access'
);
reset role;

update public.notification_settings
set suppress_everyone = true
where user_id = '11000000-0000-0000-0000-000000000002';
delete from public.notification_envelopes;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.send_encrypted_message(
  p_channel_id => '41000000-0000-0000-0000-000000000001',
  p_device_id => '51000000-0000-0000-0000-000000000001',
  p_ciphertext => 'cipher-suppressed-everyone',
  p_nonce => 'nonce-suppressed-everyone',
  p_payload_version => 3::smallint,
  p_mls_epoch => 0,
  p_mentions_everyone => true
);
reset role;
select is(
  (select count(*) from public.notification_envelopes),
  0::bigint,
  'suppress everyone prevents @everyone push in MENTIONS mode'
);
select is(
  (select mention_count from public.read_states where user_id = '11000000-0000-0000-0000-000000000002'),
  1,
  'suppress everyone prevents an @everyone mention badge'
);

update public.notification_settings
set mode = 'NONE', suppress_everyone = false
where user_id = '11000000-0000-0000-0000-000000000002';
delete from public.notification_envelopes;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.send_encrypted_message('41000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'cipher-three', 'nonce-three', 3::smallint, 0, null, array['11000000-0000-0000-0000-000000000002'::uuid])$$,
  'a message is still accepted while the recipient is muted'
);
select is((select count(*) from public.notification_envelopes), 0::bigint, 'NONE mode never enqueues push');
reset role;
select is(
  (select mention_count from public.read_states where user_id = '11000000-0000-0000-0000-000000000002'),
  2,
  'muting push does not discard the persisted mention count'
);

set local role service_role;
select is((select count(*) from public.claim_notification_envelopes(100)), 0::bigint, 'service role atomically claims only pending envelopes');

select * from finish();
rollback;
