begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('10000000-0000-0000-0000-000000000001', 'owner@lili.local', 'authenticated', 'authenticated', '{"username":"owner","display_name":"Owner"}'),
  ('10000000-0000-0000-0000-000000000002', 'member@lili.local', 'authenticated', 'authenticated', '{"username":"member","display_name":"Member"}'),
  ('10000000-0000-0000-0000-000000000003', 'outsider@lili.local', 'authenticated', 'authenticated', '{"username":"outsider","display_name":"Outsider"}'),
  ('10000000-0000-0000-0000-000000000004', 'friend@lili.local', 'authenticated', 'authenticated', '{"username":"friend","display_name":"Friend"}');

update public.profiles
set profile_visible = false
where id = '10000000-0000-0000-0000-000000000001';

insert into public.servers(id, owner_id, name)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'RLS server');
insert into public.server_members(server_id, user_id)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, position, permissions, is_default)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '@everyone', 0, 1048579, true),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Moderator', 10, 32770, false);
insert into public.member_roles(server_id, user_id, role_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002');
insert into public.channels(id, server_id, name, kind, created_by)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'seguro', 'text', '10000000-0000-0000-0000-000000000001');
insert into public.channels(id, server_id, name, kind, private, created_by)
values ('40000000-0000-0000-0000-000000000002', null, 'member-friend-dm', 'dm', true, '10000000-0000-0000-0000-000000000002');
insert into public.channel_members(channel_id, user_id)
values
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004');
insert into public.channel_permission_overrides(channel_id, target_type, target_id, allow_mask, deny_mask)
values
  ('40000000-0000-0000-0000-000000000001', 'ROLE', '30000000-0000-0000-0000-000000000001', 0, 2),
  ('40000000-0000-0000-0000-000000000001', 'ROLE', '30000000-0000-0000-0000-000000000002', 2, 0);
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Owner device', 'test', 'owner-fingerprint', 'owner-identity', 'owner:device'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Member device', 'test', 'member-fingerprint', 'member-identity', 'member:device');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is((select count(*) from public.servers), 0::bigint, 'outsider cannot enumerate servers');
select is((select count(*) from public.channels), 0::bigint, 'outsider cannot enumerate channels');
select is((select count(*) from public.profiles where id = '10000000-0000-0000-0000-000000000001'), 0::bigint, 'outsider cannot read unrelated profile');
select is(public.has_channel_permission('40000000-0000-0000-0000-000000000001', 1), false, 'outsider has no view permission');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select is((select count(*) from public.servers), 1::bigint, 'member can read joined server');
select is(public.has_channel_permission('40000000-0000-0000-0000-000000000001', 2), true, 'role allow overrides everyone deny');
select is(public.has_channel_permission('40000000-0000-0000-0000-000000000001', 32768), true, 'member effective role permission is enforced');

update public.profiles set display_name = 'Bypass' where id = '10000000-0000-0000-0000-000000000001';
reset role;
select is((select display_name from public.profiles where id = '10000000-0000-0000-0000-000000000001'), 'Owner', 'cross-user profile update changes no rows');

set local role authenticated;
select throws_ok(
  $$insert into public.friendships(requester_id, addressee_id) values ('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004')$$,
  '42501', null, 'direct friendship insert is denied'
);
select lives_ok(
  $$select public.request_friend('10000000-0000-0000-0000-000000000004')$$,
  'friend request RPC accepts an eligible target'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select lives_ok(
  $$select public.respond_friend_request((select id from public.friendships where addressee_id = auth.uid()), true)$$,
  'only addressee can accept a pending request'
);
select ok(public.are_friends('10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000004'), 'accepted friendship is visible to permission helpers');

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select ok(
  public.has_channel_permission('40000000-0000-0000-0000-000000000002', 2),
  'an existing DM allows messages before either participant blocks the other'
);
insert into public.blocks(blocker_id, blocked_id)
values (
  '10000000-0000-0000-0000-000000000002',
  '10000000-0000-0000-0000-000000000004'
);
select is(
  public.has_channel_permission('40000000-0000-0000-0000-000000000002', 2),
  false,
  'the blocker cannot bypass the UI and send into the existing DM'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000004', true);
select is(
  public.has_channel_permission('40000000-0000-0000-0000-000000000002', 226),
  false,
  'the blocked participant cannot send, speak, connect, or stream in the DM'
);
select ok(
  public.has_channel_permission('40000000-0000-0000-0000-000000000002', 1),
  'blocking preserves read-only access to the existing encrypted history'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$insert into public.messages(channel_id, author_id, sender_device_id, body, payload_version) values ('40000000-0000-0000-0000-000000000001', auth.uid(), '50000000-0000-0000-0000-000000000002', 'cipher', 4)$$,
  '42501', null, 'direct message insert is denied'
);
select lives_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000001', 'ciphertext-only', '50000000-0000-0000-0000-000000000002')$$,
  'the send RPC enforces channel membership and device ownership'
);
select lives_ok(
  $$select public.send_message('40000000-0000-0000-0000-000000000001', 'epoch-zero-ciphertext', '50000000-0000-0000-0000-000000000002')$$,
  'the send RPC accepts a second message from the same author'
);
select is((select count(*) from public.messages), 2::bigint, 'an authorized member reads the messages of the channel');

-- Mensagem só de mídia. O guard antigo media o ciphertext, que nunca era
-- vazio nem sem legenda; com o corpo em claro, exigir texto passou a recusar
-- foto e vídeo sem legenda com `invalid payload`.
select lives_ok(
  $$select public.send_message(
      '40000000-0000-0000-0000-000000000001', '',
      '50000000-0000-0000-0000-000000000002', null,
      '{}'::uuid[], '{}'::uuid[], '{}'::uuid[], false, false,
      '[{"storage_object":"40000000-0000-0000-0000-000000000001/video.mp4","byte_size":2048,"name":"video.mp4","mime":"video/mp4"}]'::jsonb
    )$$,
  'an attachment without a caption is a valid message'
);
select is(
  (select count(*)::int from public.message_attachments
   where channel_id = '40000000-0000-0000-0000-000000000001'),
  1,
  'the attachment lands in the same transaction as the message'
);
-- Sem texto e sem anexo continua não sendo mensagem.
select throws_ok(
  $$select public.send_message(
      '40000000-0000-0000-0000-000000000001', '',
      '50000000-0000-0000-0000-000000000002'
    )$$,
  'P0001', 'invalid payload',
  'a message with neither body nor attachment is still rejected'
);

reset role;
-- O corpo passou a ser guardado em claro por decisão de produto. A garantia
-- que resta — e que os testes acima exercitam — é de acesso: só participante
-- do canal lê, e é a RLS que decide. Este teste fixa o novo contrato para que
-- a coluna não seja renomeada ou removida sem que alguém perceba.
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'body'), 1::bigint, 'messages stores the body in a plain column, guarded by RLS');

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$insert into storage.objects(bucket_id, name, owner_id) values ('attachments', '40000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000001/file.bin', auth.uid()::text)$$,
  'authorized member can create attachment object metadata'
);
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$insert into storage.objects(bucket_id, name, owner_id) values ('attachments', '40000000-0000-0000-0000-000000000001/60000000-0000-0000-0000-000000000002/bypass.bin', auth.uid()::text)$$,
  '42501', null, 'outsider attachment upload is denied'
);

select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select lives_ok($$select public.create_server('Created through RPC')$$, 'authenticated user can create a server atomically');
select is((select count(*) from public.servers), 2::bigint, 'server creator can read both joined servers');

reset role;
set local role service_role;
select lives_ok(
  $$insert into public.call_sessions(channel_id, room_name, created_by) values ('40000000-0000-0000-0000-000000000001', 'service-role-test', '10000000-0000-0000-0000-000000000001')$$,
  'service role has the narrowly-scoped call session write required by the token service'
);

select * from finish();
rollback;
