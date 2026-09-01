begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1b000000-0000-0000-0000-000000000001', 'request-sender@lili.local', 'authenticated', 'authenticated', '{"username":"request_sender","display_name":"Request sender"}'),
  ('1b000000-0000-0000-0000-000000000002', 'request-target@lili.local', 'authenticated', 'authenticated', '{"username":"request_target","display_name":"Request target"}'),
  ('1b000000-0000-0000-0000-000000000003', 'request-friend@lili.local', 'authenticated', 'authenticated', '{"username":"request_friend","display_name":"Request friend"}');

select is(
  (select dm_policy from public.profiles where id = '1b000000-0000-0000-0000-000000000001'),
  'EVERYONE',
  'a new account accepts direct messages and filters them as requests'
);

insert into public.friendships(requester_id, addressee_id, status)
values ('1b000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000003', 'accepted');

-- ------------------------------------------------------------
-- Conversa com quem não é amigo vira solicitação
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000001', true);
create temporary table pedido on commit drop as
select public.create_direct_channel(array['1b000000-0000-0000-0000-000000000002']::uuid[]) as channel_id;
create temporary table conversa_amiga on commit drop as
select public.create_direct_channel(array['1b000000-0000-0000-0000-000000000003']::uuid[]) as channel_id;
reset role;

select is(
  (select accepted from public.dm_states
   where channel_id = (select channel_id from pedido)
     and user_id = '1b000000-0000-0000-0000-000000000002'),
  false,
  'a conversation started by a stranger arrives as a message request'
);
select is(
  (select count(*)::int from public.dm_states
   where channel_id = (select channel_id from pedido)
     and user_id = '1b000000-0000-0000-0000-000000000001'),
  0,
  'the sender does not see their own conversation as a request'
);
select is(
  (select count(*)::int from public.dm_states
   where channel_id = (select channel_id from conversa_amiga)
     and accepted = false),
  0,
  'a conversation between friends is never a request'
);

-- ------------------------------------------------------------
-- Recusar e aceitar
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000002', true);
select lives_ok(
  format($$select public.respond_message_request(%L, false)$$, (select channel_id from pedido)),
  'the recipient can decline a message request'
);
reset role;
select is(
  (select accepted::text || '/' || closed::text from public.dm_states
   where channel_id = (select channel_id from pedido)
     and user_id = '1b000000-0000-0000-0000-000000000002'),
  'false/true',
  'declining closes the conversation without accepting it'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000002', true);
select public.respond_message_request((select channel_id from pedido), true);
reset role;
select is(
  (select accepted::text || '/' || closed::text from public.dm_states
   where channel_id = (select channel_id from pedido)
     and user_id = '1b000000-0000-0000-0000-000000000002'),
  'true/false',
  'accepting reopens the conversation'
);

-- ------------------------------------------------------------
-- Quem não é do canal não responde por ele
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '1b000000-0000-0000-0000-000000000003', true);
select throws_ok(
  format($$select public.respond_message_request(%L, true)$$, (select channel_id from pedido)),
  'P0001', 'forbidden',
  'somebody outside the conversation cannot answer the request'
);
reset role;

-- ------------------------------------------------------------
-- Uma mensagem nova reabre a conversa fechada
-- ------------------------------------------------------------
update public.dm_states set closed = true
where channel_id = (select channel_id from conversa_amiga)
  and user_id = '1b000000-0000-0000-0000-000000000003';
insert into public.dm_states(user_id, channel_id, closed)
values ('1b000000-0000-0000-0000-000000000003', (select channel_id from conversa_amiga), true)
on conflict (user_id, channel_id) do update set closed = true;
select is(
  (select closed from public.dm_states
   where channel_id = (select channel_id from conversa_amiga)
     and user_id = '1b000000-0000-0000-0000-000000000003'),
  true,
  'the conversation starts closed for this test'
);

insert into public.devices(id, user_id, name, platform, identity_public_key, fingerprint, mls_credential)
values ('1c000000-0000-0000-0000-000000000001', '1b000000-0000-0000-0000-000000000001', 'Test device', 'test', 'chave', 'digital', 'cred');
insert into public.messages(channel_id, author_id, sender_device_id, body)
values ((select channel_id from conversa_amiga), '1b000000-0000-0000-0000-000000000001', '1c000000-0000-0000-0000-000000000001', 'ola');

select is(
  (select closed from public.dm_states
   where channel_id = (select channel_id from conversa_amiga)
     and user_id = '1b000000-0000-0000-0000-000000000003'),
  false,
  'a new message reopens the conversation the other side had closed'
);
select is(
  (select closed from public.dm_states
   where channel_id = (select channel_id from pedido)
     and user_id = '1b000000-0000-0000-0000-000000000002'),
  false,
  'a message request that was accepted stays open'
);

select finish();
rollback;
