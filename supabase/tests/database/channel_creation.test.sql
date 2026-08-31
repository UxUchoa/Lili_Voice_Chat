begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('1d000000-0000-0000-0000-000000000001', 'channel-owner@lili.local', 'authenticated', 'authenticated', '{"username":"channel_owner","display_name":"Channel owner"}'),
  ('1d000000-0000-0000-0000-000000000002', 'channel-member@lili.local', 'authenticated', 'authenticated', '{"username":"channel_member","display_name":"Channel member"}');

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000001', true);

create temporary table servidor on commit drop as
select public.create_server('Servidor de canais') as id;

-- ------------------------------------------------------------
-- Tipo, nome e opções
-- ------------------------------------------------------------
create temporary table categoria on commit drop as
select public.create_channel(
  (select id from servidor), 'Categoria privada', 'category', null, true
) as id;

select is(
  (select private::text || '/' || kind
   from public.channels where id = (select id from categoria)),
  'true/category',
  'a category can be created already private'
);

create temporary table canal_texto on commit drop as
select public.create_channel(
  (select id from servidor), '  canal-de-texto  ', 'text',
  (select id from categoria), false, 30, 0, '  Assunto do canal  '
) as id;

select is(
  (select name from public.channels where id = (select id from canal_texto)),
  'canal-de-texto',
  'the channel name is trimmed'
);
select is(
  (select topic from public.channels where id = (select id from canal_texto)),
  'Assunto do canal',
  'the topic is trimmed and persisted at creation'
);
select is(
  (select slowmode_seconds from public.channels where id = (select id from canal_texto)),
  30,
  'slowmode is applied to a text channel at creation'
);
select is(
  (select permissions_synced from public.channels where id = (select id from canal_texto)),
  true,
  'a channel created inside a category starts synced with it'
);
select is(
  (select count(*)::int from public.channel_permission_overrides
   where channel_id = (select id from canal_texto)),
  1,
  'the channel inherits the overrides of its category'
);

create temporary table canal_voz on commit drop as
select public.create_channel(
  (select id from servidor), 'Sala de voz', 'voice', null, false, 45, 7
) as id;

select is(
  (select user_limit from public.channels where id = (select id from canal_voz)),
  7,
  'the voice user limit is applied at creation'
);
select is(
  (select slowmode_seconds from public.channels where id = (select id from canal_voz)),
  0,
  'slowmode never applies to a voice channel'
);

-- ------------------------------------------------------------
-- Validação
-- ------------------------------------------------------------
select throws_ok(
  format($$select public.create_channel(%L, '   ', 'text')$$, (select id from servidor)),
  'P0001', 'invalid channel name',
  'a name made only of spaces is refused'
);
select throws_ok(
  format($$select public.create_channel(%L, 'x', 'fofoca')$$, (select id from servidor)),
  'P0001', 'invalid channel kind',
  'an unknown channel kind is refused'
);
select throws_ok(
  format(
    $$select public.create_channel(%L, 'x', 'text', null, false, 99999)$$,
    (select id from servidor)
  ),
  'P0001', 'invalid channel settings',
  'slowmode above the limit is refused'
);

-- ------------------------------------------------------------
-- Edição
-- ------------------------------------------------------------
select public.update_channel(
  (select id from canal_texto), 'canal-renomeado', 10, true, 0, 'Outro assunto'
);
select is(
  (select name || '|' || topic || '|' || slowmode_seconds::text || '|' || private::text
   from public.channels where id = (select id from canal_texto)),
  'canal-renomeado|Outro assunto|10|true',
  'name, topic, slowmode and privacy are saved together'
);
select is(
  (select (deny_mask & 1) = 1
   from public.channel_permission_overrides override
   join public.roles everyone on everyone.id = override.target_id and everyone.is_default
   where override.channel_id = (select id from canal_texto)),
  true,
  'making a channel private denies VIEW_CHANNEL for @everyone'
);

-- `null` mantém o tópico; string vazia limpa.
select public.update_channel((select id from canal_texto), 'canal-renomeado', 10, true, 0);
select is(
  (select topic from public.channels where id = (select id from canal_texto)),
  'Outro assunto',
  'editing without a topic keeps the current one'
);
select public.update_channel((select id from canal_texto), 'canal-renomeado', 10, true, 0, '');
select is(
  (select topic from public.channels where id = (select id from canal_texto)),
  null,
  'an empty topic clears it'
);

-- ------------------------------------------------------------
-- Ressincronizar com a categoria
-- ------------------------------------------------------------
select public.sync_channel_with_category((select id from canal_texto));
select is(
  (select permissions_synced from public.channels where id = (select id from canal_texto)),
  true,
  'the channel can be synced with its category again'
);
reset role;

-- ------------------------------------------------------------
-- Permissão
-- ------------------------------------------------------------
insert into public.server_members(server_id, user_id)
select id, '1d000000-0000-0000-0000-000000000002' from servidor;

set local role authenticated;
select set_config('request.jwt.claim.sub', '1d000000-0000-0000-0000-000000000002', true);
select throws_ok(
  format($$select public.create_channel(%L, 'invasao', 'text')$$, (select id from servidor)),
  'P0001', 'forbidden',
  'a member without MANAGE_CHANNELS cannot create channels'
);
reset role;

select finish();
rollback;
