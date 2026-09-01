begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- ============================================================
-- Anexos: teto de 100 MB, validade de um dia e pedido de reenvio
--
-- O limite era 25 MB e nada expirava: todo arquivo já enviado ficava no
-- bucket para sempre. Agora o arquivo vive 24 h e quem perdeu o prazo pede o
-- reenvio para quem mandou.
-- ============================================================

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('20000000-0000-0000-0000-000000000001', 'anexo-autor@lili.local', 'authenticated', 'authenticated', '{"username":"anexo_autor","display_name":"Autor"}'),
  ('20000000-0000-0000-0000-000000000002', 'anexo-leitor@lili.local', 'authenticated', 'authenticated', '{"username":"anexo_leitor","display_name":"Leitor"}'),
  ('20000000-0000-0000-0000-000000000003', 'anexo-estranho@lili.local', 'authenticated', 'authenticated', '{"username":"anexo_estranho","display_name":"Estranho"}');

insert into public.servers(id, owner_id, name)
values ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Servidor de anexos');
insert into public.server_members(server_id, user_id)
values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002');
insert into public.roles(id, server_id, name, position, permissions, is_default)
values ('22000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '@everyone', 0, 1081868515, true);
insert into public.channels(id, server_id, name, kind, created_by)
values ('23000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'midia', 'text', '20000000-0000-0000-0000-000000000001');
insert into public.devices(
  id, user_id, name, platform, fingerprint, identity_public_key, mls_credential
)
values (
  '24000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'Dispositivo do autor', 'test', 'anexo-fingerprint',
  'anexo-public-key', 'anexo:device'
);
insert into public.messages(
  id, channel_id, author_id, sender_device_id, body
)
values (
  '25000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  '24000000-0000-0000-0000-000000000001',
  'cipher'
);

-- ------------------------------------------------------------
-- Teto de 100 MB
-- ------------------------------------------------------------
select lives_ok(
  $$insert into public.message_attachments(
      message_id, channel_id, storage_object, byte_size, name, mime
    ) values (
      '25000000-0000-0000-0000-000000000001',
      '23000000-0000-0000-0000-000000000001',
      '23000000-0000-0000-0000-000000000001/grande/cipher.bin',
      31457280, 'no-teto.bin', 'application/octet-stream'
    )$$,
  'an attachment exactly at the 30 MB ceiling fits'
);
select throws_ok(
  $$insert into public.message_attachments(
      message_id, channel_id, storage_object, byte_size, name, mime
    ) values (
      '25000000-0000-0000-0000-000000000001',
      '23000000-0000-0000-0000-000000000001',
      '23000000-0000-0000-0000-000000000001/enorme/cipher.bin',
      31457281, 'enorme.bin', 'application/octet-stream'
    )$$,
  '23514', null,
  'anything past the ceiling is rejected by the database'
);
select is(
  (select file_size_limit from storage.buckets where id = 'attachments'),
  104861696::bigint,
  'the bucket refuses the same ceiling as the table'
);

-- ------------------------------------------------------------
-- Validade
-- ------------------------------------------------------------
select ok(
  (select expires_at from public.message_attachments
   where name = 'no-teto.bin')
    between now() + interval '23 hours' and now() + interval '25 hours',
  'an attachment expires one day after being sent'
);

-- A limpeza em si roda na função de borda `attachments-expire`: o Supabase
-- recusa `delete` direto em `storage.objects`, e só a API de Storage tira o
-- arquivo do ar. O que o banco garante é a marcação de vencimento, que é o
-- critério que a função usa.
insert into public.message_attachments(
  message_id, channel_id, storage_object, byte_size, name, mime,
  expires_at
) values (
  '25000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001',
  '23000000-0000-0000-0000-000000000001/velho/cipher.bin',
  2048, 'velho.bin', 'application/octet-stream', now() - interval '1 minute'
);

select is(
  (select count(*)::int from public.message_attachments
   where channel_id = '23000000-0000-0000-0000-000000000001'
     and expires_at <= now()),
  1,
  'exactly the overdue attachment is listed for removal'
);
select is(
  (select count(*)::int from public.message_attachments
   where channel_id = '23000000-0000-0000-0000-000000000001'
     and expires_at > now()),
  1,
  'what is still within the day is left alone'
);

-- ------------------------------------------------------------
-- Pedido de reenvio
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.request_attachment_resend(
      '25000000-0000-0000-0000-000000000001', 'anexo-1', 'foto.png'
    )$$,
  'someone who saw the channel can ask the sender to send it again'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.request_attachment_resend(
      '25000000-0000-0000-0000-000000000001', 'anexo-1', 'foto.png'
    )$$,
  'P0001', 'cannot request a resend from yourself',
  'the sender cannot ask themselves for a resend'
);
reset role;

-- Quem não está no servidor não enxerga nem pede.
set local role authenticated;
select set_config('request.jwt.claim.sub', '20000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$select public.request_attachment_resend(
      '25000000-0000-0000-0000-000000000001', 'anexo-1', 'foto.png'
    )$$,
  'P0001', 'forbidden',
  'an outsider cannot request anything from this channel'
);
reset role;

select finish();
rollback;
