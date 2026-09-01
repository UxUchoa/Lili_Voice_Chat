begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('12000000-0000-0000-0000-000000000001', 'mention-owner@lili.local', 'authenticated', 'authenticated', '{"username":"mention_owner","display_name":"Mention owner"}'),
  ('12000000-0000-0000-0000-000000000002', 'mention-sender@lili.local', 'authenticated', 'authenticated', '{"username":"mention_sender","display_name":"Mention sender"}'),
  ('12000000-0000-0000-0000-000000000003', 'mention-target@lili.local', 'authenticated', 'authenticated', '{"username":"mention_target","display_name":"Mention target"}');

insert into public.servers(id, owner_id, name)
values ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Mention server');
insert into public.server_members(server_id, user_id)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003');
insert into public.roles(id, server_id, name, position, permissions, mentionable, is_default)
values
  ('32000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '@everyone', 0, 3, false, true),
  ('32000000-0000-0000-0000-000000000002', '22000000-0000-0000-0000-000000000001', 'Mentionable', 1, 0, true, false),
  ('32000000-0000-0000-0000-000000000003', '22000000-0000-0000-0000-000000000001', 'Locked', 2, 0, false, false);
insert into public.member_roles(server_id, user_id, role_id)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000002'),
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000003', '32000000-0000-0000-0000-000000000003');
insert into public.channels(id, server_id, name, kind, created_by)
values ('42000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 'mentions', 'text', '12000000-0000-0000-0000-000000000001');
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values ('52000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000002', 'Mention sender', 'test', 'mention-sender-fingerprint', 'mention-sender-key', 'mention:sender');

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.send_message(p_channel_id => '42000000-0000-0000-0000-000000000001', p_body => 'cipher-role', p_device_id => '52000000-0000-0000-0000-000000000001', p_mention_role_ids => array['32000000-0000-0000-0000-000000000002'::uuid])$$,
  'a mentionable role can be mentioned without the global mention permission'
);
reset role;

select is(
  (select mention_recipient_ids from public.messages where body = 'cipher-role'),
  array['12000000-0000-0000-0000-000000000003'::uuid],
  'role membership is resolved into recipient ids'
);
select is(
  (select mention_role_ids from public.messages where body = 'cipher-role'),
  array['32000000-0000-0000-0000-000000000002'::uuid],
  'role mention metadata is persisted'
);
select is(
  (select mention_count from public.read_states
   where channel_id = '42000000-0000-0000-0000-000000000001'
     and user_id = '12000000-0000-0000-0000-000000000003'),
  1,
  'an unread role mention increments the persisted counter'
);
update public.messages
set mention_role_ids = '{}'
where body = 'cipher-role';
select is(
  (select mention_count from public.read_states
   where channel_id = '42000000-0000-0000-0000-000000000001'
     and user_id = '12000000-0000-0000-0000-000000000003'),
  0,
  'editing away an unread mention decrements the persisted counter'
);
update public.messages
set mention_user_ids = array['12000000-0000-0000-0000-000000000003'::uuid]
where body = 'cipher-role';
select is(
  (select mention_count from public.read_states
   where channel_id = '42000000-0000-0000-0000-000000000001'
     and user_id = '12000000-0000-0000-0000-000000000003'),
  1,
  'editing an unread message to add a mention increments the counter once'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.send_message(p_channel_id => '42000000-0000-0000-0000-000000000001', p_body => 'cipher-locked', p_device_id => '52000000-0000-0000-0000-000000000001', p_mention_role_ids => array['32000000-0000-0000-0000-000000000003'::uuid])$$,
  'P0001', 'invalid or non-mentionable role',
  'a non-mentionable role is rejected without permission'
);
select throws_ok(
  $$select public.send_message(p_channel_id => '42000000-0000-0000-0000-000000000001', p_body => 'cipher-everyone-denied', p_device_id => '52000000-0000-0000-0000-000000000001', p_mentions_everyone => true)$$,
  'P0001', 'missing mention everyone permission',
  '@everyone is rejected without MENTION_EVERYONE'
);
reset role;

update public.roles
set permissions = permissions | 8388608
where id = '32000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '12000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.send_message(p_channel_id => '42000000-0000-0000-0000-000000000001', p_body => 'cipher-special', p_device_id => '52000000-0000-0000-0000-000000000001', p_mention_here_recipient_ids => array['12000000-0000-0000-0000-000000000003'::uuid], p_mentions_everyone => true, p_mentions_here => true)$$,
  '@everyone and @here are accepted with permission'
);
reset role;

select ok(
  (select mentions_everyone and mentions_here from public.messages where body = 'cipher-special'),
  'special mention flags are persisted'
);
select ok(
  (select mention_recipient_ids @> array['12000000-0000-0000-0000-000000000003'::uuid]
   from public.messages where body = 'cipher-special'),
  'special mentions resolve the target member'
);

select * from finish();
rollback;
