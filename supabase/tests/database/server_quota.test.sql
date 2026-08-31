begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1d000000-0000-0000-0000-000000000001', 'quota-owner@lili.local', 'authenticated', 'authenticated', '{"username":"quota_owner","display_name":"Quota owner"}'),
  ('1d000000-0000-0000-0000-000000000002', 'quota-member@lili.local', 'authenticated', 'authenticated', '{"username":"quota_member","display_name":"Quota member"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);

select public.create_server('Servidor da cota', null);
reset role;

-- ============================================================
-- Quem pode olhar
-- ============================================================
set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select * from public.server_quota_status(
    (select id from public.servers where name = 'Servidor da cota')
  )$$,
  'quem administra o servidor le a propria cota'
);

select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select * from public.server_quota_status(
    (select id from public.servers where name = 'Servidor da cota')
  )$$,
  'forbidden',
  'quem nao administra nao ve o consumo'
);
select throws_ok(
  $$select * from public.prune_server_messages(
    (select id from public.servers where name = 'Servidor da cota')
  )$$,
  'forbidden',
  'e muito menos apaga as mensagens dos outros'
);

-- ============================================================
-- A fatia é dinâmica
-- ============================================================
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);

-- `instance_quota_config` e negada a `authenticated` de proposito, entao a
-- leitura de conferencia acontece com o papel privilegiado.
--
-- A fatia e o teto dividido pelo numero de servidores do banco inteiro, entao
-- o esperado precisa ser calculado a partir da contagem real: assumir que so
-- existem os servidores deste teste faz a suite quebrar depois de qualquer uso
-- manual do aplicativo.
reset role;
create temporary table teto on commit drop as
select database_limit_bytes as bytes,
       (select count(*) from public.servers) as servidores_antes
from public.instance_quota_config where singleton;
-- Tabela temporaria criada como postgres nao e visivel para `authenticated`.
grant select on teto to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);
select is(
  (select share_bytes from public.server_quota_status(
    (select id from public.servers where name = 'Servidor da cota'))),
  (select bytes / greatest(servidores_antes, 1) from teto),
  'a fatia e o teto dividido pelos servidores existentes'
);

select public.create_server('Segundo servidor', null);

select is(
  (select share_bytes from public.server_quota_status(
    (select id from public.servers where name = 'Servidor da cota'))),
  (select bytes / greatest(servidores_antes + 1, 1) from teto),
  'criar um servidor novo divide a fatia de todos: e o rateio da banda'
);

-- ============================================================
-- A limpeza
-- ============================================================
reset role;

-- `messages.sender_device_id` aponta para um dispositivo real.
insert into public.devices(
  id, user_id, name, platform, identity_public_key, fingerprint,
  last_seen_at, created_at, mls_credential
) values (
  '1d00de00-0000-0000-0000-000000000001',
  '1d000000-0000-0000-0000-000000000001',
  'Dispositivo da cota', 'web', 'chave-publica', 'impressao',
  now(), now(), 'credencial'
);

-- Mensagens de tamanhos e idades diferentes, no canal criado com o servidor.
insert into public.messages(
  id, channel_id, author_id, sender_device_id, ciphertext, nonce,
  payload_version, mls_epoch, created_at
)
select
  ('1d0000aa-0000-0000-0000-00000000000' || n)::uuid,
  (select id from public.channels
   where server_id = (select id from public.servers where name = 'Servidor da cota')
   limit 1),
  '1d000000-0000-0000-0000-000000000001',
  '1d00de00-0000-0000-0000-000000000001',
  repeat('x', 4000)::bytea,
  gen_random_bytes(12),
  1,
  1,
  now() - make_interval(days => 10 - n)
from generate_series(1, 5) as n;

select is(
  (select message_count from public.server_quota_status(
    (select id from public.servers where name = 'Servidor da cota'))),
  5::bigint,
  'as cinco mensagens entram na contagem'
);

-- A mais antiga fica fixada: uma limpeza automatica nao deve discordar de
-- quem marcou aquilo como o que vale guardar.
insert into public.message_pins(message_id, channel_id, pinned_by)
values (
  '1d0000aa-0000-0000-0000-000000000001',
  (select channel_id from public.messages where id = '1d0000aa-0000-0000-0000-000000000001'),
  '1d000000-0000-0000-0000-000000000001'
);

-- Teto calculado a partir da contagem real de servidores, para que a fatia
-- deste servidor seja sempre 30000: cada mensagem ocupa ~8 KB e sao cinco,
-- entao o alvo de 70% fica em 21000 e a mais recente sobrevive - que e o que
-- este teste existe para provar.
update public.instance_quota_config
set database_limit_bytes = 30000 * (select count(*) from public.servers)
where singleton;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);

select ok(
  (select deleted_count from public.prune_server_messages(
    (select id from public.servers where name = 'Servidor da cota'), 70)) > 0,
  'a limpeza apaga quando o servidor nao cabe na fatia'
);

select is(
  (select count(*)::integer from public.messages
   where id = '1d0000aa-0000-0000-0000-000000000001'),
  1,
  'a mensagem fixada sobrevive a limpeza'
);

select is(
  (select count(*)::integer from public.messages
   where id = '1d0000aa-0000-0000-0000-000000000005'),
  1,
  'a mais recente sobrevive: apaga-se do mais velho para o mais novo'
);

select is(
  (select count(*)::integer from public.messages
   where id = '1d0000aa-0000-0000-0000-000000000002'),
  0,
  'e a mais antiga nao fixada e a primeira a sair'
);

-- Rodar de novo com o servidor ja dentro da fatia nao pode apagar mais nada.
select is(
  (select deleted_count from public.prune_server_messages(
    (select id from public.servers where name = 'Servidor da cota'), 100)),
  0,
  'nada e apagado quando o servidor ja cabe'
);

-- ============================================================
-- Arquivo orfao: o bug que existia antes desta migracao
-- ============================================================
reset role;
insert into public.messages(
  id, channel_id, author_id, sender_device_id, ciphertext, nonce,
  payload_version, mls_epoch
) values (
  '1d0000bb-0000-0000-0000-000000000001',
  (select id from public.channels
   where server_id = (select id from public.servers where name = 'Servidor da cota')
   limit 1),
  '1d000000-0000-0000-0000-000000000001',
  '1d00de00-0000-0000-0000-000000000001', 'x'::bytea, gen_random_bytes(12), 1, 1
);
insert into public.message_attachments(
  message_id, channel_id, storage_object, ciphertext_size, ciphertext_hash
) values (
  '1d0000bb-0000-0000-0000-000000000001',
  (select channel_id from public.messages where id = '1d0000bb-0000-0000-0000-000000000001'),
  'canal/arquivo-que-ficaria-orfao.bin',
  1024,
  repeat('a', 64)
);

delete from public.messages where id = '1d0000bb-0000-0000-0000-000000000001';

select is(
  (select count(*)::integer from public.pending_storage_deletions
   where path = 'canal/arquivo-que-ficaria-orfao.bin'),
  1,
  'apagar a mensagem registra o anexo para a funcao de borda remover do Storage'
);

select * from finish();
rollback;
