begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1f000000-0000-0000-0000-000000000001', 'layout-a@lili.local', 'authenticated', 'authenticated', '{"username":"layout_a","display_name":"Layout A"}'),
  ('1f000000-0000-0000-0000-000000000002', 'layout-b@lili.local', 'authenticated', 'authenticated', '{"username":"layout_b","display_name":"Layout B"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000001', true);

create temporary table servidor_um on commit drop as
select public.create_server('Servidor um') as id;
create temporary table servidor_dois on commit drop as
select public.create_server('Servidor dois') as id;

create temporary table pasta on commit drop as
select public.create_server_folder('Trabalho', '#3355ff') as id;

-- ------------------------------------------------------------
-- Pasta
-- ------------------------------------------------------------
select is(
  (select name || '/' || color from public.server_folders
   where id = (select id from pasta)),
  'Trabalho/#3355ff',
  'a folder keeps the name and the colour it was created with'
);
select throws_ok(
  $$select public.create_server_folder('  ')$$,
  '23514', null,
  'a blank folder name is refused by the database'
);
select throws_ok(
  $$select public.create_server_folder('Cor ruim', 'azul')$$,
  '23514', null,
  'a colour that is not a hex triplet is refused'
);

-- ------------------------------------------------------------
-- Arranjo
-- ------------------------------------------------------------
select lives_ok(
  format(
    $$select public.save_server_layout(
        '[{"id":"%s","position":0}]'::jsonb,
        '[{"id":"%s","folder_id":"%s","position":0},
          {"id":"%s","folder_id":null,"position":1}]'::jsonb
      )$$,
    (select id from pasta),
    (select id from servidor_um), (select id from pasta),
    (select id from servidor_dois)
  ),
  'the whole layout is saved in one call'
);
select is(
  (select folder_id from public.server_placements
   where server_id = (select id from servidor_um)),
  (select id from pasta),
  'the server that was dropped into the folder is inside it'
);
select is(
  (select folder_id from public.server_placements
   where server_id = (select id from servidor_dois)),
  null,
  'the loose server stays at the top level'
);

-- Repetir a mesma chamada nao muda nada: o arranjo chega inteiro.
select lives_ok(
  format(
    $$select public.save_server_layout(
        '[]'::jsonb,
        '[{"id":"%s","folder_id":null,"position":0}]'::jsonb
      )$$,
    (select id from servidor_um)
  ),
  'saving again moves the server back out of the folder'
);
select is(
  (select folder_id from public.server_placements
   where server_id = (select id from servidor_um)),
  null,
  'the placement is replaced, not accumulated'
);

-- ------------------------------------------------------------
-- Dissolver a pasta nao pode levar servidor junto
-- ------------------------------------------------------------
select lives_ok(
  format(
    $$select public.save_server_layout(
        '[]'::jsonb,
        '[{"id":"%s","folder_id":"%s","position":0}]'::jsonb
      )$$,
    (select id from servidor_um), (select id from pasta)
  ),
  'the server goes back into the folder'
);
select lives_ok(
  $$select public.delete_server_folder((select id from pasta))$$,
  'the folder can be dissolved'
);
select is(
  (select count(*)::int from public.servers where id = (select id from servidor_um)),
  1,
  'dissolving a folder never deletes the servers inside it'
);

-- ------------------------------------------------------------
-- O arranjo e de cada pessoa
-- ------------------------------------------------------------
select set_config('request.jwt.claim.sub', '1f000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from public.server_placements),
  0,
  'another account cannot see the arrangement of the first one'
);

select * from finish();
rollback;
