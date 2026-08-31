begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('17000000-0000-0000-0000-000000000001', 'gdm-owner@lili.local', 'authenticated', 'authenticated', '{"username":"gdm_owner","display_name":"GDM owner"}'),
  ('17000000-0000-0000-0000-000000000002', 'gdm-member@lili.local', 'authenticated', 'authenticated', '{"username":"gdm_member","display_name":"GDM member"}'),
  ('17000000-0000-0000-0000-000000000003', 'gdm-member-two@lili.local', 'authenticated', 'authenticated', '{"username":"gdm_member_two","display_name":"GDM member two"}'),
  ('17000000-0000-0000-0000-000000000004', 'gdm-new@lili.local', 'authenticated', 'authenticated', '{"username":"gdm_new","display_name":"GDM new"}');
update public.profiles set dm_policy = 'EVERYONE'
where id::text like '17000000-0000-0000-0000-%';

insert into public.channels(id, name, kind, private, created_by)
values ('47000000-0000-0000-0000-000000000001', 'Original group', 'gdm', true, '17000000-0000-0000-0000-000000000001');
insert into public.channel_members(channel_id, user_id)
values
  ('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001'),
  ('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000002'),
  ('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.update_group_dm('47000000-0000-0000-0000-000000000001', 'Renamed group', '47000000-0000-0000-0000-000000000001/icon.png')$$,
  'a group member can update the name and icon metadata'
);
reset role;
select is((select name from public.channels where id = '47000000-0000-0000-0000-000000000001'), 'Renamed group', 'the group name is persisted');
select is((select icon_path from public.channels where id = '47000000-0000-0000-0000-000000000001'), '47000000-0000-0000-0000-000000000001/icon.png', 'the private icon path is persisted');

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.add_group_dm_member('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000004')$$,
  'an existing member can add an allowed recipient'
);
select throws_ok(
  $$select public.remove_group_dm_member('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000004')$$,
  'P0001', 'only the group creator can remove another member',
  'a non-creator cannot remove somebody else'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.remove_group_dm_member('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000004')$$,
  'the group creator can remove another member'
);
select public.remove_group_dm_member('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001');
reset role;
select isnt(
  (select created_by from public.channels where id = '47000000-0000-0000-0000-000000000001'),
  '17000000-0000-0000-0000-000000000001'::uuid,
  'leaving as creator transfers group ownership to a remaining member'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '17000000-0000-0000-0000-000000000004', true);
select is(
  public.has_channel_permission('47000000-0000-0000-0000-000000000001', 1),
  false,
  'a removed member immediately loses channel access'
);

select * from finish();
rollback;
