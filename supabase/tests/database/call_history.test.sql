begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('13000000-0000-0000-0000-000000000001', 'call-owner@lili.local', 'authenticated', 'authenticated', '{"username":"call_owner","display_name":"Call owner"}'),
  ('13000000-0000-0000-0000-000000000002', 'call-member@lili.local', 'authenticated', 'authenticated', '{"username":"call_member","display_name":"Call member"}');
insert into public.servers(id, owner_id, name)
values ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Call server');
insert into public.server_members(server_id, user_id)
values
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001'),
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, permissions, is_default)
values ('33000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '@everyone', 33, true);
insert into public.channels(id, server_id, name, kind, created_by)
values
  ('43000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', 'Lounge', 'voice', '13000000-0000-0000-0000-000000000001'),
  ('43000000-0000-0000-0000-000000000002', '23000000-0000-0000-0000-000000000001', 'Destino', 'voice', '13000000-0000-0000-0000-000000000001'),
  ('43000000-0000-0000-0000-000000000003', '23000000-0000-0000-0000-000000000001', 'Limitada', 'voice', '13000000-0000-0000-0000-000000000001');
update public.channels set user_limit = 1
where id = '43000000-0000-0000-0000-000000000003';
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential)
values
  ('53000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Owner device', 'test', 'call-owner-fingerprint', 'call-owner-key', 'call:owner'),
  ('53000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000002', 'Member device', 'test', 'call-member-fingerprint', 'call-member-key', 'call:member');
insert into public.call_sessions(id, channel_id, room_name, created_by)
values
  ('63000000-0000-0000-0000-000000000001', '43000000-0000-0000-0000-000000000001', 'call-history-room', '13000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000002', '43000000-0000-0000-0000-000000000003', 'call-limited-room', '13000000-0000-0000-0000-000000000001'),
  ('63000000-0000-0000-0000-000000000003', '43000000-0000-0000-0000-000000000002', 'call-connecting-room', '13000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.join_call_session('63000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001')$$,
  'the owner joins the persisted call session'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.join_call_session('63000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000002')$$,
  'the second account joins the same call session'
);
select is(
  (select count(*) from public.call_session_participants where left_at is null),
  2::bigint,
  'RLS exposes both active participants to a channel member'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.leave_call_session('63000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001')$$,
  'the first account leaves cleanly'
);
reset role;
select ok(
  (select ended_at is null from public.call_sessions where id = '63000000-0000-0000-0000-000000000001'),
  'the session remains active while one participant is connected'
);
select is(
  (select count(*) from public.call_session_participants where left_at is null),
  1::bigint,
  'one active participant remains'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.leave_call_session('63000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000002')$$,
  'the final account leaves cleanly'
);
reset role;
select ok(
  (select ended_at is not null from public.call_sessions where id = '63000000-0000-0000-0000-000000000001'),
  'the final leave closes the persisted session'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.join_call_session('63000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000001')$$,
  'the first account reserves the only slot in a limited voice channel'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.join_call_session('63000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002')$$,
  'P0001',
  'voice channel is full',
  'a second account cannot exceed the voice channel user limit'
);
reset role;
select is(
  (select count(*) from public.call_session_participants
   where session_id = '63000000-0000-0000-0000-000000000002' and left_at is null),
  1::bigint,
  'a rejected join does not persist an extra participant'
);

update public.call_session_participants
set last_seen_at = '2000-01-01 00:00:00+00'
where session_id = '63000000-0000-0000-0000-000000000002'
  and user_id = '13000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.join_call_session('63000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002')$$,
  'a stale crashed participant no longer blocks a limited channel'
);
reset role;
select ok(
  (select left_at is not null from public.call_session_participants
   where session_id = '63000000-0000-0000-0000-000000000002'
     and user_id = '13000000-0000-0000-0000-000000000001'),
  'joining reaps the stale participant row'
);

update public.call_session_participants
set last_seen_at = '2000-01-01 00:00:00+00'
where session_id = '63000000-0000-0000-0000-000000000002'
  and user_id = '13000000-0000-0000-0000-000000000002'
  and left_at is null;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.heartbeat_call_session('63000000-0000-0000-0000-000000000002', '53000000-0000-0000-0000-000000000002')$$,
  'an active participant can refresh its heartbeat'
);
reset role;
select ok(
  (select last_seen_at > '2000-01-01 00:00:00+00' from public.call_session_participants
   where session_id = '63000000-0000-0000-0000-000000000002'
     and user_id = '13000000-0000-0000-0000-000000000002'
     and left_at is null),
  'heartbeat persistence advances last_seen_at'
);

update public.call_session_participants
set last_seen_at = '2000-01-01 00:00:00+00'
where session_id = '63000000-0000-0000-0000-000000000002'
  and user_id = '13000000-0000-0000-0000-000000000002'
  and left_at is null;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select is(
  public.reap_stale_call_participants(),
  1,
  'reconciliation reaps a crashed participant after the heartbeat window'
);
reset role;
select ok(
  (select left_at is not null from public.call_session_participants
   where session_id = '63000000-0000-0000-0000-000000000002'
     and user_id = '13000000-0000-0000-0000-000000000002'),
  'the stale participant is marked as left'
);
select ok(
  (select ended_at is not null from public.call_sessions
   where id = '63000000-0000-0000-0000-000000000002'),
  'reconciliation closes a call session left empty by a crashed client'
);
select ok(
  (select ended_at is null from public.call_sessions
   where id = '63000000-0000-0000-0000-000000000003'),
  'reconciliation preserves a fresh empty session while its client connects'
);

insert into public.voice_move_requests(
  id, server_id, source_channel_id, destination_channel_id,
  target_user_id, requested_by
) values (
  '73000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '43000000-0000-0000-0000-000000000001',
  '43000000-0000-0000-0000-000000000002',
  '13000000-0000-0000-0000-000000000002',
  '13000000-0000-0000-0000-000000000001'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000001', true);
select is(
  (select count(*) from public.voice_move_requests),
  0::bigint,
  'the moderator cannot read another users pending move request'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '13000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*) from public.voice_move_requests),
  1::bigint,
  'the target can see its own pending move request'
);
select is(
  (select destination_channel_id from public.claim_voice_move_request()),
  '43000000-0000-0000-0000-000000000002'::uuid,
  'claiming a move returns the destination channel'
);
select is(
  (select count(*) from public.claim_voice_move_request()),
  0::bigint,
  'a processed move cannot be claimed twice'
);
reset role;
select ok(
  (select processed_at is not null from public.voice_move_requests where id = '73000000-0000-0000-0000-000000000001'),
  'claiming the move persists its processed timestamp'
);

select * from finish();
rollback;
