-- Agenda o expurgo das contas paradas há 90 dias.
--
-- Execute no SQL Editor do projeto hospedado depois de substituir os
-- placeholders. Uma vez por dia basta: a regra é de 90 dias, e correr mais que
-- isso só gasta invocação. O lote é de 50 contas por chamada — a resposta traz
-- `remaining` quando sobrou fila, e o dia seguinte continua de onde parou.
--
-- "Apagada" aqui quer dizer lápide: login, senha, sessões, dispositivos,
-- chaves e a chave de recuperação são destruídos e a identidade é anonimizada.
-- Mensagens, canais e servidores permanecem, e o servidor órfão passa para o
-- administrador mais antigo. Apagar a linha do perfil levaria junto a conversa
-- de todo mundo que falou com a pessoa.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Reaproveita `janja_project_url` quando os outros agendadores já o criaram;
-- rodar duas vezes com o mesmo nome falha, e isso é intencional.
select vault.create_secret(
  'https://YOUR_PROJECT.supabase.co',
  'janja_project_url',
  'URL pública do projeto Janja'
);
select vault.create_secret(
  'REPLACE_WITH_ACCOUNTS_PRUNE_SECRET',
  'janja_accounts_prune_secret',
  'Autorização do expurgo de contas inativas'
);

-- 03:20 UTC, longe do horário de pico de qualquer fuso brasileiro.
select cron.schedule(
  'janja-accounts-prune',
  '20 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'janja_project_url')
      || '/functions/v1/accounts-prune',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'janja_accounts_prune_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Antes de deixar rodar sozinho, confira quem seria atingido hoje:
--   select * from public.list_inactive_accounts(90);
