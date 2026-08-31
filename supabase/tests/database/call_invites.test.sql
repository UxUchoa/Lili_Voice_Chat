begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users(id, email, aud, role, raw_user_meta_data)
values
  ('19000000-0000-0000-0000-000000000001', 'ring-caller@lili.local', 'authenticated', 'authenticated', '{"username":"ring_caller","display_name":"Ring caller"}'),
  ('19000000-0000-0000-0000-000000000002', 'ring-callee@lili.local', 'authenticated', 'authenticated', '{"username":"ring_callee","display_name":"Ring callee"}'),
  ('19000000-0000-0000-0000-000000000003', 'ring-outsider@lili.local', 'authenticated', 'authenticated', '{"username":"ring_outsider","display_name":"Ring outsider"}');

insert into public.channels(id, name, kind, private, created_by)
values ('49000000-0000-0000-0000-000000000001', 'Ring DM', 'dm', true, '19000000-0000-0000-0000-000000000001');
insert into public.channel_members(channel_id, user_id)
values
  ('49000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001'),
  ('49000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000002');

-- ------------------------------------------------------------
-- Tocar o telefone
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.start_call_invite('49000000-0000-0000-0000-000000000001', true)$$,
  'a member of the direct channel can ring the other side'
);
select is(
  (select count(*)::int from public.call_invites where state = 'ringing' and channel_id = '49000000-0000-0000-0000-000000000001'),
  1,
  'ringing creates exactly one invite per recipient'
);
select is(
  (select with_video from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' limit 1),
  true,
  'the requested call kind is recorded'
);

-- Ligar de novo enquanto toca reaproveita o convite em vez de empilhar modais.
select public.start_call_invite('49000000-0000-0000-0000-000000000001', false);
select is(
  (select count(*)::int from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001'),
  1,
  'calling again while it rings reuses the same invite'
);
select is(
  (select with_video from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' limit 1),
  false,
  'the reused invite adopts the new call kind'
);
select is(
  (select count(*)::int from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' and callee_id = '19000000-0000-0000-0000-000000000001'),
  0,
  'the caller never rings themselves'
);
reset role;

-- O id fica guardado fora do RLS: o teste do "forasteiro" precisa apontar
-- para um convite que ele justamente não enxerga.
create temporary table ring_ids on commit drop as
select id from public.call_invites
where channel_id = '49000000-0000-0000-0000-000000000001';
grant select on ring_ids to authenticated;

-- ------------------------------------------------------------
-- Quem não é do canal não liga, e quem não é destinatário não responde
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000003', true);
select throws_ok(
  $$select public.start_call_invite('49000000-0000-0000-0000-000000000001', false)$$,
  'P0001', 'forbidden',
  'somebody outside the channel cannot start a call'
);
select is(
  (select count(*)::int from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001'),
  0,
  'an unrelated user cannot even see the invite'
);
select throws_ok(
  format(
    $$select public.respond_call_invite(%L, true, false)$$,
    (select id from ring_ids)
  ),
  'P0001', 'forbidden',
  'only the recipient can answer the call'
);
reset role;

-- ------------------------------------------------------------
-- Atender
-- ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
select is(
  (select count(*)::int from public.call_invites where state = 'ringing' and channel_id = '49000000-0000-0000-0000-000000000001'),
  1,
  'the recipient sees the ringing invite'
);
select is(
  (select state from public.respond_call_invite(
    (select id from public.call_invites where state = 'ringing' and channel_id = '49000000-0000-0000-0000-000000000001'), true, true)),
  'accepted',
  'answering marks the invite as accepted'
);
select is(
  (select accepted_with_video from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' limit 1),
  true,
  'answering with video is recorded for the caller'
);
reset role;

-- ------------------------------------------------------------
-- Recusar e cancelar
-- ------------------------------------------------------------
-- O convite volta a tocar para exercitar a recusa. A escrita direta acontece
-- fora do papel `authenticated`: pelo RLS só as RPCs mudam o estado.
update public.call_invites set state = 'ringing', responded_at = null
where channel_id = '49000000-0000-0000-0000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000002', true);
select is(
  (select state from public.respond_call_invite(
    (select id from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001'), false, false)),
  'declined',
  'declining marks the invite as declined'
);
reset role;

update public.call_invites set state = 'ringing', responded_at = null
where channel_id = '49000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select is(
  public.cancel_call_invite(null, '49000000-0000-0000-0000-000000000001'),
  1,
  'the caller can cancel every invite of the channel at once'
);
reset role;
select is(
  (select state from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' limit 1),
  'cancelled',
  'cancelling is visible to both sides'
);

-- ------------------------------------------------------------
-- Chamada não atendida expira sozinha
-- ------------------------------------------------------------
update public.call_invites
set state = 'ringing', responded_at = null, expires_at = now() - interval '1 minute'
where channel_id = '49000000-0000-0000-0000-000000000001';
select public.expire_call_invites();
select is(
  (select state from public.call_invites where channel_id = '49000000-0000-0000-0000-000000000001' limit 1),
  'missed',
  'an unanswered call becomes a missed call'
);

-- ------------------------------------------------------------
-- Bloqueio impede a chamada
-- ------------------------------------------------------------
delete from public.call_invites
where channel_id = '49000000-0000-0000-0000-000000000001';
insert into public.blocks(blocker_id, blocked_id)
values ('19000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001');
set local role authenticated;
select set_config('request.jwt.claim.sub', '19000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.start_call_invite('49000000-0000-0000-0000-000000000001', false)$$,
  'P0001', 'calls are blocked between these users',
  'a blocked pair cannot start a call'
);
reset role;

select finish();
rollback;
