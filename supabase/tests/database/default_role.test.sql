begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

-- ============================================================
-- O cargo padrão (@everyone) é editável por quem administra cargos
--
-- `update_role` usava `can_manage_role`, que nega o cargo padrão de propósito
-- (ele não pode ser excluído, duplicado nem reordenado). O efeito colateral era
-- que nada no @everyone podia ser salvo — inclusive as permissões, que são a
-- única razão de esse cargo existir.
-- ============================================================

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1e000000-0000-0000-0000-000000000001', 'default-role-owner@lili.local', 'authenticated', 'authenticated', '{"username":"default_role_owner","display_name":"Dono"}'),
  ('1e000000-0000-0000-0000-000000000002', 'default-role-member@lili.local', 'authenticated', 'authenticated', '{"username":"default_role_member","display_name":"Membro"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);

create temporary table servidor on commit drop as
select public.create_server('Servidor do cargo padrao') as id;

create temporary table everyone on commit drop as
select id from public.roles
where server_id = (select id from servidor) and is_default;

select lives_ok(
  format(
    $$select public.update_role(%L, 'tentativa de renomear', '#12ab34', 3, true, true, '🛡️')$$,
    (select id from everyone)
  ),
  'the owner can save the default role'
);
select is(
  (select permissions from public.roles where id = (select id from everyone)),
  3::bigint,
  'the default role permissions are persisted'
);
select is(
  (select color from public.roles where id = (select id from everyone)),
  '#12ab34',
  'the default role color is persisted'
);
select is(
  (select unicode_emoji from public.roles where id = (select id from everyone)),
  '🛡️',
  'the default role icon is persisted'
);
select is(
  (select name from public.roles where id = (select id from everyone)),
  '@everyone',
  'the default role name cannot be changed'
);
select is(
  (select hoist from public.roles where id = (select id from everyone)),
  false,
  'the default role is never hoisted'
);
select is(
  (select changes -> 'after' ->> 'permissions' from public.audit_logs
   where action_type = 'ROLE_UPDATE' and target_id = (select id from everyone)
   order by created_at desc limit 1),
  '3',
  'the change to the default role is audited'
);
reset role;

-- ------------------------------------------------------------
-- Um membro comum continua sem poder mexer no @everyone.
-- ------------------------------------------------------------
insert into public.server_members(server_id, user_id)
select id, '1e000000-0000-0000-0000-000000000002' from servidor;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format(
    $$select public.update_role(%L, '@everyone', '#ffffff', 8, false, false, null)$$,
    (select id from everyone)
  ),
  'P0001', 'forbidden',
  'a member without MANAGE_ROLES cannot edit the default role'
);
reset role;

select finish();
rollback;
