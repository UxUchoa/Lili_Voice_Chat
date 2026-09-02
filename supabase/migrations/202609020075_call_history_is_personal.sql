begin;

-- ============================================================
-- Chamada encerrada é de quem participou dela
--
-- `call_sessions_select` liberava toda sessão do canal a quem tem permissão de
-- entrar nele (32). Isso é o certo para a chamada **em andamento**: é assim que
-- o "ativo agora" mostra quem está na sala antes de alguém entrar.
--
-- Só que a mesma permissão entregava o histórico inteiro. Quem dividia um canal
-- de voz via, com nome e horário, todas as chamadas já feitas ali — inclusive
-- as que aconteceram entre outras duas pessoas, sem ele. No painel de amigos
-- isso aparecia como "chamadas recentes" de contas alheias.
--
-- A separação é por `ended_at`: enquanto a chamada está de pé, ela é um fato do
-- canal e continua visível a ele. Encerrada, vira histórico, e histórico é de
-- quem esteve nele.
--
-- A checagem de participação mora numa função `security definer` para não criar
-- recursão: a política de `call_session_participants` consulta `call_sessions`,
-- e se a de `call_sessions` consultasse `call_session_participants` sob RLS, uma
-- chamaria a outra sem fim.
-- ============================================================

create or replace function public.joined_call_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists(
    select 1 from public.call_session_participants
    where session_id = p_session_id and user_id = auth.uid()
  );
$$;

revoke all on function public.joined_call_session(uuid) from public, anon;
grant execute on function public.joined_call_session(uuid) to authenticated;

drop policy if exists call_sessions_select on public.call_sessions;
create policy call_sessions_select
on public.call_sessions for select to authenticated
using (
  public.has_channel_permission(channel_id, 32)
  and (ended_at is null or public.joined_call_session(id))
);

drop policy if exists call_session_participants_select on public.call_session_participants;
create policy call_session_participants_select
on public.call_session_participants for select to authenticated
using (
  exists (
    select 1 from public.call_sessions session
    where session.id = session_id
      and public.has_channel_permission(session.channel_id, 32)
      and (session.ended_at is null or public.joined_call_session(session.id))
  )
);

commit;
