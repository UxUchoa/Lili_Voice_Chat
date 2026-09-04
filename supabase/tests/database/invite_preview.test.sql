begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

-- Prévia pública de convite: é a primeira coisa neste banco que responde a
-- quem não fez login. O que se testa aqui é tanto o que ela mostra quanto o
-- que ela recusa a mostrar.
insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('7a000000-0000-0000-0000-000000000001', 'preview-owner@lili.local', 'authenticated', 'authenticated', '{"username":"preview_owner","display_name":"Preview owner"}'),
  ('7a000000-0000-0000-0000-000000000002', 'preview-member@lili.local', 'authenticated', 'authenticated', '{"username":"preview_member","display_name":"Preview member"}');

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000001', true);
select public.create_server('Servidor do convite', null);

reset role;
update public.servers
set icon_path = id || '/icone.png',
    description = 'Um servidor para o teste da prévia'
where name = 'Servidor do convite';

insert into public.server_members(server_id, user_id)
values (
  (select id from public.servers where name = 'Servidor do convite'),
  '7a000000-0000-0000-0000-000000000002'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000001', true);
select public.create_invite(
  (select id from public.servers where name = 'Servidor do convite'),
  (select id from public.channels
   where server_id = (select id from public.servers where name = 'Servidor do convite')
   order by position limit 1),
  null,
  null
) as vivo \gset

-- ============================================================
-- Sem login: é este o caso que existe para resolver
-- ============================================================
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', null, true);

select is(
  (select server_name from public.invite_preview(:'vivo')),
  'Servidor do convite',
  'quem não fez login enxerga o nome do servidor'
);
select is(
  (select member_count from public.invite_preview(:'vivo')),
  2,
  'e quantas pessoas já estão lá'
);
select isnt(
  (select server_icon_path from public.invite_preview(:'vivo')),
  null,
  'e o caminho do ícone, que o cartão precisa para desenhar a imagem'
);
select is(
  (select channel_name from public.invite_preview(:'vivo')),
  'geral',
  'e em que canal vai cair'
);

-- Um código que não existe não pode devolver nada — nem uma pista de que
-- existe alguma coisa por perto.
select is_empty(
  $$select * from public.invite_preview('codigo-que-nao-existe')$$,
  'código inventado não devolve linha nenhuma'
);

-- ============================================================
-- Convite morto para de anunciar o servidor
-- ============================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000001', true);
select public.create_invite(
  (select id from public.servers where name = 'Servidor do convite'),
  (select id from public.channels
   where server_id = (select id from public.servers where name = 'Servidor do convite')
   order by position limit 1),
  null,
  null
) as revogado \gset

reset role;
update public.invites set revoked_at = now() where code = :'revogado';

set local role anon;
select is_empty(
  format($$select * from public.invite_preview(%L)$$, :'revogado'),
  'convite revogado não devolve nada'
);

reset role;
update public.invites set revoked_at = null, expires_at = now() - interval '1 minute'
where code = :'revogado';
set local role anon;
select is_empty(
  format($$select * from public.invite_preview(%L)$$, :'revogado'),
  'convite expirado não devolve nada'
);

reset role;
update public.invites set expires_at = null, max_uses = 1, uses = 1
where code = :'revogado';
set local role anon;
select is_empty(
  format($$select * from public.invite_preview(%L)$$, :'revogado'),
  'convite esgotado não devolve nada'
);

-- ============================================================
-- O que a superfície anônima **não** abriu junto
--
-- A pergunta não é "o `select` volta vazio?" e sim "o `select` é permitido?".
-- Aqui ele nem chega à RLS: `anon` não tem privilégio nenhum nestas tabelas, e
-- é assim que tem que continuar. A prévia é uma função `security definer`
-- justamente para não precisar abrir tabela para ninguém.
-- ============================================================
reset role;

select ok(
  not has_table_privilege('anon', 'public.servers', 'select'),
  'a prévia não abriu a lista de servidores para quem não fez login'
);
select ok(
  not has_table_privilege('anon', 'public.server_members', 'select'),
  'nem quem são os membros'
);
select ok(
  not has_table_privilege('anon', 'public.invites', 'select'),
  'nem a tabela de convites, que continua só para quem pode administrar'
);

-- ============================================================
-- O ícone: balde privado, leitura anônima só enquanto o convite vive
--
-- É por causa deste caso que a condição virou uma função `security definer`
-- em `private`. Escrita direto na política, ela rodava com os privilégios de
-- `anon` — que acabou de ser confirmado como zero em `public.invites` — e
-- falhava com "permission denied for table invites". O ícone simplesmente
-- nunca aparecia no cartão, e o erro só saía no corpo da resposta do Storage.
-- ============================================================
reset role;
insert into storage.objects(bucket_id, name)
values (
  'server-icons',
  (select id from public.servers where name = 'Servidor do convite') || '/icone.png'
);

-- Um segundo servidor, sem convite nenhum, para provar que a porta não abriu
-- para o balde inteiro.
set local role authenticated;
select set_config('request.jwt.claim.sub', '7a000000-0000-0000-0000-000000000002', true);
select public.create_server('Servidor sem convite', null);
reset role;
insert into storage.objects(bucket_id, name)
values (
  'server-icons',
  (select id from public.servers where name = 'Servidor sem convite') || '/icone.png'
);

-- Os dois ids saem daqui ainda com privilégio: `anon` não lê `public.servers`,
-- e uma subconsulta lá embaixo morreria na permissão em vez de medir o que
-- este teste quer medir.
select id as convidado from public.servers where name = 'Servidor do convite' \gset
select id as sem_convite from public.servers where name = 'Servidor sem convite' \gset

select ok(
  private.server_has_live_invite(:'convidado'),
  'o auxiliar enxerga o convite vivo'
);
select ok(
  not private.server_has_live_invite(:'sem_convite'),
  'e não inventa convite onde não há'
);

set local role anon;
select set_config('request.jwt.claim.sub', null, true);

select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'server-icons' and name like :'convidado' || '%'),
  1,
  'sem login, o ícone do servidor convidado é legível'
);
select is(
  (select count(*)::integer from storage.objects
   where bucket_id = 'server-icons' and name like :'sem_convite' || '%'),
  0,
  'e o de um servidor sem convite continua invisível'
);

-- Revogar o convite fecha a porta no mesmo instante, sem passo nenhum de
-- limpeza: a condição é avaliada a cada leitura.
reset role;
update public.invites set revoked_at = now() where server_id = :'convidado';

set local role anon;
select is(
  (select count(*)::integer from storage.objects where bucket_id = 'server-icons'),
  0,
  'revogar o convite esconde o ícone de novo'
);

reset role;
select * from finish();
rollback;
