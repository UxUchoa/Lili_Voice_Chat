begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

-- Chave de recuperacao: registro, consulta, verificacao e bloqueio.
insert into auth.users(id, email, aud, role, raw_user_meta_data, last_sign_in_at)
values
  ('1c000000-0000-0000-0000-000000000001', 'recovery-owner@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_owner","display_name":"Recovery owner"}', now() - interval '200 days'),
  ('1c000000-0000-0000-0000-000000000002', 'recovery-admin@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_admin","display_name":"Recovery admin"}', now()),
  ('1c000000-0000-0000-0000-000000000003', 'recovery-member@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_member","display_name":"Recovery member"}', now()),
  ('1c000000-0000-0000-0000-000000000004', 'recovery-alone@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_alone","display_name":"Recovery alone"}', now() - interval '200 days'),
  ('1c000000-0000-0000-0000-000000000005', 'recovery-active@janja.local', 'authenticated', 'authenticated', '{"username":"recovery_active","display_name":"Recovery active"}', now() - interval '2 days');

-- ============================================================
-- Registrar e consultar a própria chave
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);

select is(
  (select has_key from public.recovery_key_status()),
  false,
  'uma conta recem-criada nao tem chave de recuperacao'
);

select lives_ok(
  $$select public.set_recovery_key('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  'o dono da sessao registra a propria chave'
);

select is(
  (select has_key from public.recovery_key_status()),
  true,
  'a chave registrada aparece no status'
);

select throws_ok(
  $$select public.set_recovery_key('curta')$$,
  'invalid recovery key hash',
  'um hash truncado e recusado em vez de virar uma chave fraca'
);

-- O hash nunca pode ser lido pelo cliente, nem o proprio.
select throws_ok(
  $$select key_hash from public.account_recovery_keys$$,
  '42501',
  null,
  'authenticated nao alcanca a tabela de chaves nem para ler a propria'
);

select throws_ok(
  $$select public.verify_recovery_key('recovery-owner@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$,
  '42501',
  null,
  'authenticated nao pode verificar chave: isso e da funcao de borda'
);

select throws_ok(
  $$select public.tombstone_account('1c000000-0000-0000-0000-000000000001')$$,
  '42501',
  null,
  'authenticated nao pode transformar ninguem em lapide'
);

-- ============================================================
-- Verificação, do ponto de vista da função de borda
-- ============================================================
reset role;
set local role service_role;

select is(
  (select status from public.verify_recovery_key('recovery-owner@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'ok',
  'a chave correta confere'
);

select is(
  (select user_id from public.verify_recovery_key('recovery-owner@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  '1c000000-0000-0000-0000-000000000001'::uuid,
  'e devolve de quem e a conta'
);

select is(
  (select status from public.verify_recovery_key('RECOVERY-OWNER@JANJA.LOCAL', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'ok',
  'o e-mail confere sem depender de maiuscula'
);

select is(
  (select status from public.verify_recovery_key('recovery-owner@janja.local', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')),
  'invalid',
  'a chave errada e recusada'
);

select is(
  (select status from public.verify_recovery_key('ninguem@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'invalid',
  'conta inexistente responde igual a chave errada, sem revelar quem existe'
);

-- Quatro erros a mais fecham as cinco tentativas.
select public.verify_recovery_key('recovery-owner@janja.local', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') from generate_series(1, 4);

select is(
  (select status from public.verify_recovery_key('recovery-owner@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'locked',
  'cinco erros travam a conta mesmo para quem chega com a chave certa'
);

-- Trocar a chave pela sessão limpa o bloqueio: quem provou ser o dono não
-- herda as tentativas de um atacante.
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '1c000000-0000-0000-0000-000000000001', true);
select public.set_recovery_key('ccccccccccccccccccccccccccccccccccccccccccc');

reset role;
set local role service_role;
select is(
  (select status from public.verify_recovery_key('recovery-owner@janja.local', 'ccccccccccccccccccccccccccccccccccccccccccc')),
  'ok',
  'registrar chave nova destrava a conta'
);

select is(
  (select status from public.verify_recovery_key('recovery-owner@janja.local', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')),
  'invalid',
  'e a chave anterior deixa de valer na mesma operacao'
);

select * from finish();
rollback;
