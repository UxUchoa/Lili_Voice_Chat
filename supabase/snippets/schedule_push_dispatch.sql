-- Execute no SQL Editor do projeto hospedado depois de definir os placeholders.
-- Os segredos ficam no Vault; a migration não contém URL ou segredo de produção.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret(
  'https://YOUR_PROJECT.supabase.co',
  'lili_project_url',
  'URL pública do projeto Lili'
);
select vault.create_secret(
  'REPLACE_WITH_PUSH_DISPATCH_SECRET',
  'lili_push_dispatch_secret',
  'Autorização do dispatcher de push'
);

select cron.schedule(
  'lili-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'lili_project_url')
      || '/functions/v1/push-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-push-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'lili_push_dispatch_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
