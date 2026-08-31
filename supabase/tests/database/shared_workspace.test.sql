begin;

create extension if not exists pgtap with schema extensions;
select plan(29);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('11000000-0000-0000-0000-000000000001', 'invite-owner@janja.local', 'authenticated', 'authenticated', '{"username":"inviteowner","display_name":"Invite Owner"}'),
  ('11000000-0000-0000-0000-000000000002', 'invite-member@janja.local', 'authenticated', 'authenticated', '{"username":"invitemember","display_name":"Invite Member"}'),
  ('11000000-0000-0000-0000-000000000003', 'invite-outsider@janja.local', 'authenticated', 'authenticated', '{"username":"inviteoutsider","display_name":"Invite Outsider"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$select public.create_server('Servidor compartilhado')$$,
  'owner creates a shared server'
);

select lives_ok(
  $$select set_config('app.test_invite_code', public.create_invite(
    (select id from public.servers where owner_id = auth.uid() limit 1),
    (select id from public.channels where server_id = (select id from public.servers where owner_id = auth.uid() limit 1) and kind = 'text' limit 1),
    2,
    60
  ), true)$$,
  'owner creates a persisted invite'
);

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.redeem_invite(current_setting('app.test_invite_code'))$$,
  'second account redeems the invite'
);
select is(
  (select count(*) from public.server_members where user_id = auth.uid()),
  1::bigint,
  'second account becomes a server member'
);
select is(
  (select uses from public.invites limit 1),
  1,
  'first redemption consumes one use'
);

select lives_ok(
  $$select public.redeem_invite(current_setting('app.test_invite_code'))$$,
  'redeeming again is idempotent for an existing member'
);
select is(
  (select uses from public.invites limit 1),
  1,
  'duplicate redemption does not consume another use'
);

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select set_config('app.test_role_id', public.create_role(
    (select id from public.servers where owner_id = auth.uid() limit 1),
    'Moderadores'
  )::text, true)$$,
  'owner creates a persisted role'
);
select lives_ok(
  $$select set_config('app.test_role_copy_id', public.duplicate_role(
    current_setting('app.test_role_id')::uuid
  )::text, true)$$,
  'owner duplicates a persisted role'
);
-- 3 = "Administração" (criado junto com o servidor), o cargo do teste e a
-- cópia dele.
select is(
  (select count(*) from public.roles where server_id = (select id from public.servers where owner_id = auth.uid()) and not is_default),
  3::bigint,
  'role duplication creates one independent copy'
);
select lives_ok(
  $$select public.reorder_role(current_setting('app.test_role_id')::uuid, 'up')$$,
  'owner reorders roles atomically'
);
select lives_ok(
  $$select public.update_member_nickname(
    (select id from public.servers where owner_id = auth.uid() limit 1),
    '11000000-0000-0000-0000-000000000002',
    'Convidado'
  )$$,
  'owner updates a member nickname'
);
select is(
  (select nickname from public.server_members where user_id = '11000000-0000-0000-0000-000000000002'),
  'Convidado',
  'nickname is persisted in the shared membership'
);
select lives_ok(
  $$select set_config('app.test_channel_copy_id', public.duplicate_channel(
    (select id from public.channels where server_id = (select id from public.servers where owner_id = auth.uid()) and kind = 'text' order by created_at limit 1)
  )::text, true)$$,
  'owner duplicates a persisted channel'
);
select is(
  (select count(*) from public.channels where server_id = (select id from public.servers where owner_id = auth.uid())),
  3::bigint,
  'channel duplication creates one independent copy'
);
select lives_ok(
  $$select public.reorder_channel(current_setting('app.test_channel_copy_id')::uuid, 'up')$$,
  'owner reorders channels'
);
select lives_ok(
  $$select public.mark_channel_read(
    (select id from public.channels where server_id = (select id from public.servers where owner_id = auth.uid()) and kind = 'text' order by created_at limit 1),
    null
  )$$,
  'member persists a read state through the authorized RPC'
);
select is(
  (select count(*) from public.read_states where user_id = auth.uid()),
  1::bigint,
  'read state is stored for the authenticated account'
);
select lives_ok(
  $$select set_config('app.test_category_id', public.create_channel(
    (select id from public.servers where owner_id = auth.uid() limit 1),
    'Projetos', 'category', null
  )::text, true)$$,
  'owner creates a real category'
);
select lives_ok(
  $$select public.set_channel_override(
    current_setting('app.test_category_id')::uuid,
    'ROLE',
    (select id from public.roles where server_id = (select id from public.servers where owner_id = auth.uid()) and is_default),
    4, 0
  )$$,
  'category receives a permission override'
);
select lives_ok(
  $$select public.move_channel_to_category(
    current_setting('app.test_channel_copy_id')::uuid,
    current_setting('app.test_category_id')::uuid,
    true
  )$$,
  'channel moves to a category with synchronized permissions'
);
select is(
  (select count(*) from public.channel_permission_overrides where channel_id = current_setting('app.test_channel_copy_id')::uuid),
  1::bigint,
  'category permission overrides are copied to the synchronized child'
);
select lives_ok(
  $$select public.update_channel(
    current_setting('app.test_category_id')::uuid,
    'Projetos privados', 0, true, 0
  )$$,
  'owner can make a category private'
);
select ok(
  (select (deny_mask & 1) = 1 from public.channel_permission_overrides
   where channel_id = current_setting('app.test_channel_copy_id')::uuid
     and target_type = 'ROLE'
     and target_id = (select id from public.roles where is_default limit 1)),
  'private category propagates VIEW_CHANNEL deny to a synchronized child'
);
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select is(
  public.has_channel_permission(current_setting('app.test_channel_copy_id')::uuid, 1),
  false,
  'ordinary member cannot view a child of a private synchronized category'
);
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.set_channel_override(
    current_setting('app.test_channel_copy_id')::uuid,
    'ROLE',
    (select id from public.roles where is_default limit 1),
    5, 0
  )$$,
  'owner can customize a synchronized child override'
);
select is(
  (select permissions_synced from public.channels where id = current_setting('app.test_channel_copy_id')::uuid),
  false,
  'custom child override marks category permissions as unsynchronized'
);
select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000002', true);
select is(
  public.has_channel_permission(current_setting('app.test_channel_copy_id')::uuid, 1),
  true,
  'custom child permissions remain effective independently from the private category'
);

select set_config('request.jwt.claim.sub', '11000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*) from public.servers),
  0::bigint,
  'an unrelated account still cannot enumerate the server'
);

select * from finish();
rollback;
