begin;

-- ============================================================
-- As últimas políticas com o nome antigo
--
-- `202608240003` e `202608240005` criaram `janja_realtime_receive` e
-- `janja_realtime_send` em `realtime.messages`. Aquelas migrações já rodaram
-- em produção: reescrevê-las não renomeia nada no banco e ainda faria o
-- arquivo mentir sobre o que foi aplicado. O rename precisa ser uma migração
-- nova.
--
-- E precisa ser por drop/create, não por `alter policy ... rename`: a tabela
-- `realtime.messages` pertence a `supabase_realtime_admin`, e renomear exige
-- ser dono dela. Criar política, não — foi assim que as originais nasceram.
-- Tudo numa transação, então não existe instante em que o Realtime fique sem
-- política nenhuma.
--
-- Nome de política é invisível para quem usa o aplicativo. Vale mesmo assim:
-- quem for depurar permissão de Realtime daqui a um ano não deveria encontrar
-- o nome de um produto que não existe mais.
-- ============================================================

drop policy if exists janja_realtime_receive on realtime.messages;
drop policy if exists janja_realtime_send on realtime.messages;
drop policy if exists lili_realtime_receive on realtime.messages;
drop policy if exists lili_realtime_send on realtime.messages;

create policy lili_realtime_receive
on realtime.messages for select to authenticated
using (
  exists (
    select 1 from public.channels c
    where realtime.topic() in (
        'channel:' || c.id::text,
        'presence:channel:' || c.id::text,
        'typing:channel:' || c.id::text
      )
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

create policy lili_realtime_send
on realtime.messages for insert to authenticated
with check (
  exists (
    select 1 from public.channels c
    where realtime.topic() in (
        'channel:' || c.id::text,
        'presence:channel:' || c.id::text,
        'typing:channel:' || c.id::text
      )
      and public.has_channel_permission(c.id, 1)
  )
  or realtime.topic() = 'user:' || (select auth.uid())::text
);

commit;
