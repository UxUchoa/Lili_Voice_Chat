-- Agenda a limpeza dos anexos vencidos.
--
-- Execute no SQL Editor do projeto hospedado depois de substituir os
-- placeholders. Sem isto o arquivo só some quando alguém abre o aplicativo, e
-- a promessa de "vive 24 h e depois some" deixa de valer para uma conversa
-- parada. Os segredos ficam no Vault; nenhuma migration os carrega.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Reaproveita o segredo criado por schedule_push_dispatch.sql quando ele já
-- existir; rodar duas vezes com o mesmo nome falha, e isso é intencional.
select vault.create_secret(
  'https://YOUR_PROJECT.supabase.co',
  'janja_project_url',
  'URL pública do projeto Janja'
);
select vault.create_secret(
  'REPLACE_WITH_ATTACHMENTS_EXPIRE_SECRET',
  'janja_attachments_expire_secret',
  'Autorização do expurgo de anexos'
);

select cron.schedule(
  'janja-attachments-expire',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'janja_project_url')
      || '/functions/v1/attachments-expire',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'janja_attachments_expire_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
