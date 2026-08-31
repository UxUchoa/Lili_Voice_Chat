begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('16000000-0000-0000-0000-000000000001', 'notice-owner@janja.local', 'authenticated', 'authenticated', '{"username":"notice_owner","display_name":"Notice owner"}'),
  ('16000000-0000-0000-0000-000000000002', 'notice-member@janja.local', 'authenticated', 'authenticated', '{"username":"notice_member","display_name":"Notice member"}'),
  ('16000000-0000-0000-0000-000000000003', 'notice-outsider@janja.local', 'authenticated', 'authenticated', '{"username":"notice_outsider","display_name":"Notice outsider"}');

insert into public.servers(id, owner_id, name)
values ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Notification server');
insert into public.server_members(server_id, user_id)
values
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001'),
  ('26000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, position, permissions, is_default)
values ('36000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', '@everyone', 0, 3, true);
insert into public.channels(id, server_id, name, kind, created_by)
values
  ('46000000-0000-0000-0000-000000000001', '26000000-0000-0000-0000-000000000001', 'general', 'text', '16000000-0000-0000-0000-000000000001'),
  ('46000000-0000-0000-0000-000000000002', '26000000-0000-0000-0000-000000000001', 'alerts', 'text', '16000000-0000-0000-0000-000000000001');
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values ('56000000-0000-0000-0000-000000000001', '16000000-0000-0000-0000-000000000001', 'Sender', 'test', 'notice-sender-fingerprint', 'notice-sender-key', 'notice:sender');

insert into public.notification_settings(user_id, scope_type, scope_id, mode)
values
  ('16000000-0000-0000-0000-000000000002', 'GLOBAL', '*', 'ALL'),
  ('16000000-0000-0000-0000-000000000002', 'SERVER', '26000000-0000-0000-0000-000000000001', 'MENTIONS'),
  ('16000000-0000-0000-0000-000000000002', 'CHANNEL', '46000000-0000-0000-0000-000000000002', 'NONE');

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.send_encrypted_message(
  p_channel_id => '46000000-0000-0000-0000-000000000001',
  p_device_id => '56000000-0000-0000-0000-000000000001',
  p_ciphertext => 'cipher-ordinary', p_nonce => 'nonce-ordinary',
  p_payload_version => 3::smallint, p_mls_epoch => 0
);
select public.send_encrypted_message(
  p_channel_id => '46000000-0000-0000-0000-000000000001',
  p_device_id => '56000000-0000-0000-0000-000000000001',
  p_ciphertext => 'cipher-mention', p_nonce => 'nonce-mention',
  p_payload_version => 3::smallint, p_mls_epoch => 0,
  p_mention_recipient_ids => array['16000000-0000-0000-0000-000000000002'::uuid]
);
select public.send_encrypted_message(
  p_channel_id => '46000000-0000-0000-0000-000000000002',
  p_device_id => '56000000-0000-0000-0000-000000000001',
  p_ciphertext => 'cipher-muted', p_nonce => 'nonce-muted',
  p_payload_version => 3::smallint, p_mls_epoch => 0,
  p_mention_recipient_ids => array['16000000-0000-0000-0000-000000000002'::uuid]
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-ordinary')),
  null,
  'SERVER MENTIONS overrides GLOBAL ALL for an ordinary message'
);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-mention')),
  'MENTION',
  'an effective mention is delivered in SERVER MENTIONS mode'
);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-muted')),
  null,
  'CHANNEL NONE overrides the server preference'
);
reset role;

update public.notification_settings
set mode = 'ALL', muted_until = now() + interval '1 hour'
where scope_type = 'SERVER';
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-mention')),
  null,
  'a temporary server mute suppresses foreground delivery'
);
reset role;

update public.notification_settings
set muted_until = null
where scope_type = 'SERVER';
set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000002', true);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-ordinary')),
  'MESSAGE',
  'server ALL delivers an ordinary message after the mute expires'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000001', true);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-mention')),
  null,
  'the author never receives a notification for the own message'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '16000000-0000-0000-0000-000000000003', true);
select is(
  public.notification_event_for_message((select id from public.messages where ciphertext = 'cipher-mention')),
  null,
  'a user without channel access cannot inspect a delivery event'
);
select throws_ok(
  $$select public.notification_preferences_for('16000000-0000-0000-0000-000000000002', '46000000-0000-0000-0000-000000000001')$$,
  '42501',
  'permission denied for function notification_preferences_for',
  'the internal preference resolver remains unavailable to clients'
);

select * from finish();
rollback;
