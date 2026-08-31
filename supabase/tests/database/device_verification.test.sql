begin;
create extension if not exists pgtap with schema extensions;
select plan(4);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('81000000-0000-0000-0000-000000000001', 'verify-one@janja.local', 'authenticated', 'authenticated', '{"username":"verify_one"}'),
  ('81000000-0000-0000-0000-000000000002', 'verify-two@janja.local', 'authenticated', 'authenticated', '{"username":"verify_two"}');
insert into public.devices(id, user_id, name, platform, fingerprint, identity_public_key, mls_credential, revoked_at)
values
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001', 'Own', 'test', 'ABCDEFGHIJKLMNOPQRSTUV', 'pk-1', 'credential-1', null),
  ('82000000-0000-0000-0000-000000000002', '81000000-0000-0000-0000-000000000002', 'Other', 'test', 'ZYXWVUTSRQPONMLKJIHGFE', 'pk-2', 'credential-2', null),
  ('82000000-0000-0000-0000-000000000003', '81000000-0000-0000-0000-000000000001', 'Revoked', 'test', 'AAAABBBBCCCCDDDDEEEEFFFF', 'pk-3', 'credential-3', now());

set local role authenticated;
select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select lives_ok(
  $$select public.verify_device('82000000-0000-0000-0000-000000000001', 'ABCD-EFGH-IJKL-MNOP-QRST')$$,
  'matching short code verifies an owned active device'
);
select ok(
  (select verified_at is not null from public.devices where id = '82000000-0000-0000-0000-000000000001'),
  'verification timestamp is persisted'
);
select throws_like(
  $$select public.verify_device('82000000-0000-0000-0000-000000000002', 'ZYXW-VUTS-RQPO-NMLK-JIHG')$$,
  '%device not found%',
  'an account cannot verify another account device'
);
select throws_like(
  $$select public.verify_device('82000000-0000-0000-0000-000000000003', 'AAAA-BBBB-CCCC-DDDD-EEEE')$$,
  '%device not found%',
  'a revoked device cannot be verified'
);

select * from finish();
rollback;
