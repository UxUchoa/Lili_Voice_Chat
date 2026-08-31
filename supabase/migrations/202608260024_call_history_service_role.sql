begin;

-- Tabelas criadas depois do bootstrap não herdam automaticamente os grants.
-- O service_role precisa ler o histórico para manutenção e testes locais.
grant select on public.call_session_participants to service_role;

commit;
