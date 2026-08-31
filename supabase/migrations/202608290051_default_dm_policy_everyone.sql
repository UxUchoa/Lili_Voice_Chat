begin;

-- ============================================================
-- Política de mensagem direta padrão: EVERYONE
--
-- Com o padrão anterior (`FRIENDS`) nenhuma conversa podia começar antes da
-- amizade, e a fila de solicitações de mensagem nunca receberia nada. O
-- padrão do Discord é o inverso: qualquer pessoa pode escrever, mas quem não
-- é seu amigo cai em "Solicitações de mensagem" em vez de entrar direto na
-- sua lista de conversas. Quem quiser o comportamento restrito continua
-- podendo escolher FRIENDS ou NOBODY em Configurações › Privacidade.
-- ============================================================

alter table public.profiles alter column dm_policy set default 'EVERYONE';

update public.profiles set dm_policy = 'EVERYONE' where dm_policy = 'FRIENDS';

commit;
