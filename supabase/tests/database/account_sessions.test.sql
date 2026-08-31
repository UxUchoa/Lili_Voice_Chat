begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('18000000-0000-0000-0000-000000000001', 'sessions-owner@janja.local', 'authenticated', 'authenticated', '{"username":"sessions_owner","display_name":"Sessions owner"}'),
  ('18000000-0000-0000-0000-000000000002', 'sessions-other@janja.local', 'authenticated', 'authenticated', '{"username":"sessions_other","display_name":"Sessions other"}');
insert into auth.sessions(id, user_id, created_at, updated_at, user_agent, ip)
values
  ('58000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', now() - interval '2 hours', now() - interval '1 minute', 'Current browser', '127.0.0.1'),
  ('58000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 hour', 'Old browser', '192.0.2.1'),
  ('58000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000002', now(), now(), 'Other user', '192.0.2.2');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"58000000-0000-0000-0000-000000000001"}',
  true
);
select is((select count(*) from public.list_account_sessions()), 2::bigint, 'only the caller sessions are listed');
select is((select count(*) from public.list_account_sessions() where is_current), 1::bigint, 'the JWT session is marked as current');
select is((select user_agent from public.list_account_sessions() where is_current), 'Current browser', 'session metadata is returned');
select throws_ok(
  $$select public.revoke_account_session('58000000-0000-0000-0000-000000000003')$$,
  'P0001', 'account session not found or forbidden',
  'another user session cannot be revoked'
);
select lives_ok(
  $$select public.revoke_account_session('58000000-0000-0000-0000-000000000002')$$,
  'an owned session can be revoked'
);
select is((select count(*) from public.list_account_sessions()), 1::bigint, 'the revoked session disappears immediately');
reset role;

insert into auth.sessions(id, user_id, created_at, updated_at)
values ('58000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-000000000001', now(), now());
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"18000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"58000000-0000-0000-0000-000000000001"}',
  true
);
select is(public.revoke_other_account_sessions(), 1, 'all other owned sessions are revoked atomically');
select is((select count(*) from public.list_account_sessions()), 1::bigint, 'the current session is preserved');

select * from finish();
rollback;
