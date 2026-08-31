begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- Expurgo de conta parada: 1c…01 dono que some, 1c…02 administrador, 1c…03 membro comum,
-- 1c…04 dono solitário, 1c…05 conta ativa que não pode ser tocada.
insert into auth.users(id, email, aud, role, raw_user_meta_data, last_sign_in_at)
values
  ('1c000000-0000-0000-0000-000000000001', 'recovery-owner@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_owner","display_name":"Recovery owner"}', now() - interval '200 days'),
  ('1c000000-0000-0000-0000-000000000002', 'recovery-admin@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_admin","display_name":"Recovery admin"}', now()),
  ('1c000000-0000-0000-0000-000000000003', 'recovery-member@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_member","display_name":"Recovery member"}', now()),
  ('1c000000-0000-0000-0000-000000000004', 'recovery-alone@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_alone","display_name":"Recovery alone"}', now() - interval '200 days'),
  ('1c000000-0000-0000-0000-000000000005', 'recovery-active@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_active","display_name":"Recovery active"}', now() - interval '2 days');

-- ============================================================
-- Servidores: quem herda quando o dono vira lápide
-- ============================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);

select public.create_server('Servidor herdado', null);

-- O administrador entra antes do membro comum, para provar que a escolha é
-- pela permissão e não pela ordem de chegada. Os inserts vão sem papel de
-- cliente: `authenticated` não tem grant de escrita nestas tabelas, e o
-- caminho normal seria um convite, que não é o que este teste investiga.
reset role;
insert into public.server_members(server_id, user_id, joined_at)
values
  ((select id from public.servers where name = 'Servidor herdado'), '1c000000-0000-0000-0000-000000000003', now() - interval '10 days'),
  ((select id from public.servers where name = 'Servidor herdado'), '1c000000-0000-0000-0000-000000000002', now() - interval '1 day');

insert into public.member_roles(server_id, user_id, role_id)
select (select id from public.servers where name = 'Servidor herdado'),
       '1c000000-0000-0000-0000-000000000002',
       r.id
from public.roles r
where r.server_id = (select id from public.servers where name = 'Servidor herdado')
  and (r.permissions & (1::bigint << 60)) <> 0
limit 1;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000004', true);
select public.create_server('Servidor solitario', null);

reset role;
set local role service_role;

select public.tombstone_account('1c000000-0000-0000-0000-000000000001');

reset role;
select is(
  (select owner_id from public.servers where id = (select id from public.servers where name = 'Servidor herdado')),
  '1c000000-0000-0000-0000-000000000002'::uuid,
  'o servidor passa para o administrador, e nao para o membro mais antigo'
);

set local role service_role;
select public.tombstone_account('1c000000-0000-0000-0000-000000000004');

reset role;
select is(
  (select count(*)::integer from public.servers where id = (select id from public.servers where name = 'Servidor solitario')),
  0,
  'servidor sem mais ninguem e apagado, porque nao sobrou conversa a preservar'
);

-- ============================================================
-- O que a lápide destrói e o que ela preserva
-- ============================================================
select is(
  (select display_name from public.profiles where id = '1c000000-0000-0000-0000-000000000001'),
  'Usuário removido',
  'a identidade e apagada'
);

select matches(
  (select username from public.profiles where id = '1c000000-0000-0000-0000-000000000001'),
  '^removido_[0-9a-f]{12}$',
  'o username vira um identificador sem pessoa'
);

-- As duas contas do teste compartilham os primeiros hexadecimais do uuid de
-- propósito: é o caso que fazia o expurgo da segunda quebrar com violação de
-- unicidade.
select isnt(
  (select username from public.profiles where id = '1c000000-0000-0000-0000-000000000004'),
  (select username from public.profiles where id = '1c000000-0000-0000-0000-000000000001'),
  'duas lapides com uuid parecido nao disputam o mesmo username'
);

select is(
  (select dm_policy from public.profiles where id = '1c000000-0000-0000-0000-000000000001'),
  'NOBODY',
  'a lapide nao recebe mais conversa'
);

select isnt(
  (select deleted_at from public.profiles where id = '1c000000-0000-0000-0000-000000000001'),
  null,
  'a lapide fica marcada com a data'
);

-- ============================================================
-- Quem ainda usa a conta não é tocado
-- ============================================================
select is(
  (select count(*)::integer from public.list_inactive_accounts(90)
   where user_id = '1c000000-0000-0000-0000-000000000005'),
  0,
  'conta com login recente fica fora da lista de inativas'
);

select is(
  (select count(*)::integer from public.list_inactive_accounts(90)
   where user_id in (
     '1c000000-0000-0000-0000-000000000001',
     '1c000000-0000-0000-0000-000000000004'
   )),
  0,
  'e a lapide nao volta para a lista, para nao ser processada duas vezes'
);

select * from finish();
rollback;
