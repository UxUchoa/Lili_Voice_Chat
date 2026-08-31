begin;

create extension if not exists pgtap with schema extensions;
select plan(3);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values ('1a000000-0000-0000-0000-000000000001', 'role-icon@lili.local', 'authenticated', 'authenticated', '{"username":"role_icon","display_name":"Role icon"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
select public.create_server('Role icon server');
select public.create_role(
  (select id from public.servers where owner_id = auth.uid() limit 1),
  'Icon role'
);
select lives_ok(
  $$select public.update_role(
    (select id from public.roles where not is_default and name = 'Icon role' limit 1),
    'Icon role', '#f00c14', 0, true, true, '🛡️'
  )$$,
  'a manageable role accepts a Unicode icon'
);
select is(
  (select unicode_emoji from public.roles where not is_default and name = 'Icon role' limit 1),
  '🛡️',
  'the role icon is persisted'
);
select is(
  (select changes -> 'after' ->> 'icon' from public.audit_logs where action_type = 'ROLE_UPDATE' order by created_at desc limit 1),
  '🛡️',
  'the role icon change is audited'
);

select * from finish();
rollback;
