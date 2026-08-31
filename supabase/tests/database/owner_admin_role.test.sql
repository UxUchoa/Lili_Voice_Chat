begin;

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ============================================================
-- O criador do servidor recebe um cargo de Administração
--
-- O servidor nascia só com o @everyone e todo o poder do dono vinha de
-- `is_server_owner`, então não havia como delegar administração nem o que
-- mostrar na aba "Cargos". `ADMINISTRATOR` também não valia nada no banco.
-- ============================================================

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1f000000-0000-0000-0000-000000000001', 'admin-role-owner@lili.local', 'authenticated', 'authenticated', '{"username":"admin_role_owner","display_name":"Dono"}'),
  ('1f000000-0000-0000-0000-000000000002', 'admin-role-member@lili.local', 'authenticated', 'authenticated', '{"username":"admin_role_member","display_name":"Membro"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000001', true);

create temporary table servidor on commit drop as
select public.create_server('Servidor com administracao') as id;

select is(
  (select count(*)::int from public.roles
   where server_id = (select id from servidor) and not is_default),
  1,
  'a new server starts with exactly one role besides @everyone'
);
select is(
  (select name from public.roles
   where server_id = (select id from servidor) and not is_default),
  'Administração',
  'that role is the administration role'
);
select is(
  (select permissions from public.roles
   where server_id = (select id from servidor) and not is_default),
  (1::bigint << 60),
  'the administration role carries ADMINISTRATOR'
);
select is(
  (select count(*)::int from public.member_roles mr
   join public.roles r on r.id = mr.role_id
   where mr.server_id = (select id from servidor)
     and mr.user_id = '1f000000-0000-0000-0000-000000000001'
     and not r.is_default),
  1,
  'the creator receives the administration role'
);

-- O @everyone continua no básico: entrar, ler, falar e usar a voz.
select is(
  (select permissions from public.roles
   where server_id = (select id from servidor) and is_default),
  1081868515::bigint,
  'the default role keeps only the baseline permissions'
);
reset role;

-- ------------------------------------------------------------
-- ADMINISTRATOR vale no banco, não só no cliente.
-- ------------------------------------------------------------
insert into public.server_members(server_id, user_id)
select id, '1f000000-0000-0000-0000-000000000002' from servidor;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000002', true);
-- 32768 = MANAGE_CHANNELS, que o @everyone não tem.
select is(
  public.has_server_permission((select id from servidor), 32768),
  false,
  'a plain member cannot manage channels'
);
reset role;

insert into public.member_roles(server_id, user_id, role_id)
select (select id from servidor), '1f000000-0000-0000-0000-000000000002',
       (select id from public.roles
        where server_id = (select id from servidor) and not is_default);

set local role authenticated;
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000002', true);
select is(
  public.has_server_permission((select id from servidor), 32768),
  true,
  'ADMINISTRATOR alone grants every server permission'
);
reset role;

select finish();
rollback;
