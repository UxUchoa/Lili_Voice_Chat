begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1e000000-0000-0000-0000-000000000001', 'cat-owner@lili.local', 'authenticated', 'authenticated', '{"username":"cat_owner","display_name":"Cat owner"}'),
  ('1e000000-0000-0000-0000-000000000002', 'cat-outsider@lili.local', 'authenticated', 'authenticated', '{"username":"cat_outsider","display_name":"Cat outsider"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000001', true);

create temporary table servidor on commit drop as
select public.create_server('Servidor de categorias') as id;

create temporary table origem on commit drop as
select public.create_channel(
  (select id from servidor), 'Origem', 'category', null, false
) as id;
create temporary table destino on commit drop as
select public.create_channel(
  (select id from servidor), 'Destino', 'category', null, false
) as id;

create temporary table canal_a on commit drop as
select public.create_channel(
  (select id from servidor), 'canal-a', 'text', (select id from origem), false
) as id;
create temporary table canal_b on commit drop as
select public.create_channel(
  (select id from servidor), 'canal-b', 'text', (select id from origem), false
) as id;

-- ------------------------------------------------------------
-- Excluir movendo para outra categoria
-- ------------------------------------------------------------
select lives_ok(
  $$select public.delete_category(
      (select id from origem), 'MOVE_TO_CATEGORY', (select id from destino)
    )$$,
  'a category can be deleted while its channels move elsewhere'
);
select is(
  (select count(*)::int from public.channels
   where parent_id = (select id from destino)),
  2,
  'both channels ended up in the target category'
);
select is(
  (select count(*)::int from public.channels
   where id in ((select id from canal_a), (select id from canal_b))),
  2,
  'deleting the category never deletes the channels by accident'
);
select is(
  (select count(*)::int from public.channels where id = (select id from origem)),
  0,
  'the category itself is gone'
);

-- ------------------------------------------------------------
-- Guardas
-- ------------------------------------------------------------
select throws_ok(
  $$select public.delete_category(
      (select id from destino), 'MOVE_TO_CATEGORY', (select id from destino)
    )$$,
  'P0001', 'invalid target category',
  'a category cannot be moved into itself'
);
select throws_ok(
  $$select public.delete_category((select id from destino), 'INVENTADA')$$,
  'P0001', 'invalid strategy',
  'an unknown strategy is refused instead of silently uncategorising'
);
select throws_ok(
  $$select public.delete_category((select id from canal_a))$$,
  'P0001', 'not a category',
  'delete_category refuses a plain channel'
);

-- Quem nao administra o servidor nao reordena nem exclui.
select set_config('request.jwt.claim.sub', '1e000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.delete_category((select id from destino))$$,
  'P0001', 'forbidden',
  'an outsider cannot delete a category of a server'
);

select * from finish();
rollback;
