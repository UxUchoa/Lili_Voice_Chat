begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1a000000-0000-0000-0000-000000000001', 'profile-owner@lili.local', 'authenticated', 'authenticated', '{"username":"profile_owner","display_name":"Profile owner"}'),
  ('1a000000-0000-0000-0000-000000000002', 'profile-member@lili.local', 'authenticated', 'authenticated', '{"username":"profile_member","display_name":"Profile member"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000001', true);

-- ------------------------------------------------------------
-- Criação com perfil completo
-- ------------------------------------------------------------
select isnt(public.reserve_server_id(), null, 'the client can reserve a server id before uploading the icon');

create temporary table novo_servidor on commit drop as
select public.create_server(
  '  Servidor com perfil  ',
  '  Um espaço para testar o perfil  '
) as id;

select is(
  (select name from public.servers where id = (select id from novo_servidor)),
  'Servidor com perfil',
  'the server name is trimmed and persisted'
);
select is(
  (select description from public.servers where id = (select id from novo_servidor)),
  'Um espaço para testar o perfil',
  'the description is trimmed and persisted'
);
select is(
  (select owner_id from public.servers where id = (select id from novo_servidor)),
  '1a000000-0000-0000-0000-000000000001'::uuid,
  'the creator owns the server'
);
select isnt(
  (select created_at from public.servers where id = (select id from novo_servidor)),
  null,
  'the creation date is recorded'
);
select is(
  (select count(*)::int from public.channels where server_id = (select id from novo_servidor)),
  2,
  'a new server starts with its default text and voice channels'
);

select throws_ok(
  $$select public.create_server('   ')$$,
  'P0001', 'invalid server name',
  'a name made only of spaces is refused'
);
select throws_ok(
  $$select public.create_server('Nome válido', '', 'outro-servidor/icone.png')$$,
  'P0001', 'invalid server icon path',
  'an icon path outside the server folder is refused'
);

-- ------------------------------------------------------------
-- Edição
-- ------------------------------------------------------------
select lives_ok(
  format(
    $$select public.update_server(%L, 'Servidor renomeado', 'Nova descrição', %L)$$,
    (select id from novo_servidor),
    (select id::text || '/icone.png' from novo_servidor)
  ),
  'the owner can edit name, description and icon'
);
select is(
  (select name || ' | ' || description || ' | ' || icon_path
   from public.servers where id = (select id from novo_servidor)),
  (select 'Servidor renomeado | Nova descrição | ' || id::text || '/icone.png'
   from novo_servidor),
  'every profile field is persisted together'
);

-- Passar null mantém o valor anterior: editar só o nome não apaga o resto.
select public.update_server(
  (select id from novo_servidor),
  'Só o nome mudou'
);
select is(
  (select description from public.servers where id = (select id from novo_servidor)),
  'Nova descrição',
  'editing only the name keeps the description'
);
select isnt(
  (select icon_path from public.servers where id = (select id from novo_servidor)),
  null,
  'editing only the name keeps the icon'
);

-- Remover o ícone é explícito.
select public.update_server(
  (select id from novo_servidor),
  'Só o nome mudou',
  null,
  null,
  true
);
select is(
  (select icon_path from public.servers where id = (select id from novo_servidor)),
  null,
  'removing the icon clears the stored path'
);
reset role;

-- ------------------------------------------------------------
-- Permissão
-- ------------------------------------------------------------
insert into public.server_members(server_id, user_id)
select id, '1a000000-0000-0000-0000-000000000002' from novo_servidor;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1a000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format(
    $$select public.update_server(%L, 'Tentativa de invasão')$$,
    (select id from novo_servidor)
  ),
  'P0001', 'forbidden',
  'a member without MANAGE_SERVER cannot edit the profile'
);
reset role;

select finish();
rollback;
