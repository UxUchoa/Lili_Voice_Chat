begin;

-- ============================================================
-- Apagar um anexo voltou a funcionar
--
-- `capture_orphaned_attachment` roda depois de cada `delete` em
-- `message_attachments` e grava o caminho do arquivo em
-- `pending_storage_deletions`, para a função de borda tirá-lo do Storage
-- depois. Só que a tabela nasceu fechada — `revoke all ... from public, anon,
-- authenticated`, e para `service_role` apenas `select` e `delete` — enquanto
-- a função de gatilho ficou sem `security definer`.
--
-- Gatilho sem `security definer` roda com os privilégios de quem apagou. Ou
-- seja: nenhum dos papéis que apagam anexos na prática tinha permissão de
-- inserir ali, e o `insert` derrubava a transação inteira com
--
--     42501: permission denied for table pending_storage_deletions
--
-- Isso levava junto tudo o que passa por esse `delete`: apagar uma mensagem
-- com anexo pelo aplicativo, apagar canal ou servidor (o anexo cai por
-- CASCADE) e a limpeza dos anexos vencidos, que a `attachments-expire` faz com
-- `service_role`. A tabela existe justamente para ser escrita por esse gatilho
-- e por mais ninguém, então quem ganha o privilégio é a função — não os
-- papéis. `security definer` a faz rodar como dona, e a tabela continua
-- fechada para `authenticated` e `anon`.
--
-- O teste não pegou porque apagava a mensagem depois de um `reset role`, isto
-- é, como superusuário, que ignora `grant`. Ele passa a apagar como
-- `authenticated` e como `service_role`, que são os dois caminhos reais.
-- ============================================================

create or replace function public.capture_orphaned_attachment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.pending_storage_deletions(bucket, path)
  values ('attachments', old.storage_object)
  on conflict (bucket, path) do nothing;
  return old;
end;
$$;

commit;
