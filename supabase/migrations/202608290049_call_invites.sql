begin;

-- ============================================================
-- Convites de chamada (o "telefone tocando")
--
-- Até aqui uma chamada era só entrar na sala LiveKit do canal: quem estava do
-- outro lado nunca ficava sabendo. Esta tabela é a sinalização de toque —
-- quem liga cria um convite por destinatário, o destinatário responde, e os
-- dois lados acompanham o mesmo estado por Realtime.
-- ============================================================

create table if not exists public.call_invites (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  with_video boolean not null default false,
  accepted_with_video boolean,
  state text not null default 'ringing'
    check (state in ('ringing', 'accepted', 'declined', 'cancelled', 'missed')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  expires_at timestamptz not null default now() + interval '45 seconds',
  constraint call_invites_not_self check (caller_id <> callee_id)
);

-- Um toque por par e canal: ligar de novo enquanto o telefone toca deve
-- reaproveitar o mesmo convite em vez de empilhar modais no destinatário.
create unique index if not exists call_invites_one_ringing
  on public.call_invites (channel_id, caller_id, callee_id)
  where state = 'ringing';

create index if not exists call_invites_callee_state
  on public.call_invites (callee_id, state);
create index if not exists call_invites_caller_state
  on public.call_invites (caller_id, state);

alter table public.call_invites enable row level security;

drop policy if exists call_invites_select on public.call_invites;
create policy call_invites_select on public.call_invites
  for select to authenticated
  using (
    caller_id = (select auth.uid()) or callee_id = (select auth.uid())
  );

grant select on public.call_invites to authenticated;

-- ------------------------------------------------------------
-- Marca como perdidas as chamadas que ninguém atendeu. É idempotente e só
-- toca em linhas já vencidas, então qualquer cliente pode chamá-la.
-- ------------------------------------------------------------
create or replace function public.expire_call_invites()
returns void
language sql
volatile
security definer
set search_path = public
as $fn$
  update public.call_invites
  set state = 'missed', responded_at = now()
  where state = 'ringing' and expires_at < now();
$fn$;

-- ------------------------------------------------------------
-- Toca o telefone dos outros participantes do canal direto.
-- ------------------------------------------------------------
create or replace function public.start_call_invite(
  p_channel_id uuid,
  p_with_video boolean default false
)
returns setof public.call_invites
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_kind text;
  v_target uuid;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  perform public.expire_call_invites();
  select kind into v_kind from public.channels where id = p_channel_id;
  if v_kind is null or v_kind not in ('dm', 'gdm') then
    raise exception 'call invites are only available in direct channels';
  end if;
  if not exists (
    select 1 from public.channel_members
    where channel_id = p_channel_id and user_id = v_actor
  ) then
    raise exception 'forbidden';
  end if;
  for v_target in
    select user_id from public.channel_members
    where channel_id = p_channel_id and user_id <> v_actor
  loop
    -- Bloqueio corta a chamada nos dois sentidos; numa DM de duas pessoas
    -- isso deixa a chamada inteira impossível, e é esse o comportamento
    -- esperado. Num grupo, apenas o par bloqueado deixa de tocar.
    if public.is_blocked_pair(v_target, v_actor) then
      if v_kind = 'dm' then
        raise exception 'calls are blocked between these users';
      end if;
      continue;
    end if;
    insert into public.call_invites(
      channel_id, caller_id, callee_id, with_video, expires_at
    )
    values (
      p_channel_id, v_actor, v_target, coalesce(p_with_video, false),
      now() + interval '45 seconds'
    )
    on conflict (channel_id, caller_id, callee_id) where state = 'ringing'
    do update set
      with_video = excluded.with_video,
      expires_at = excluded.expires_at;
  end loop;
  return query
    select * from public.call_invites
    where channel_id = p_channel_id
      and caller_id = v_actor
      and state = 'ringing';
end;
$fn$;

-- ------------------------------------------------------------
-- Atender (com ou sem vídeo) ou recusar.
-- ------------------------------------------------------------
create or replace function public.respond_call_invite(
  p_invite_id uuid,
  p_accept boolean,
  p_with_video boolean default false
)
returns public.call_invites
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_invite public.call_invites%rowtype;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  select * into v_invite from public.call_invites
  where id = p_invite_id for update;
  if not found or v_invite.callee_id <> v_actor then
    raise exception 'forbidden';
  end if;
  if v_invite.state <> 'ringing' then
    -- Responder a um convite já resolvido não é erro: o outro lado pode ter
    -- desistido no mesmo instante. Devolvemos o estado real.
    return v_invite;
  end if;
  update public.call_invites
  set state = case when p_accept then 'accepted' else 'declined' end,
      accepted_with_video =
        case when p_accept then coalesce(p_with_video, false) else null end,
      responded_at = now()
  where id = p_invite_id
  returning * into v_invite;
  return v_invite;
end;
$fn$;

-- ------------------------------------------------------------
-- Desistir de ligar. Aceita o id de um convite ou o canal inteiro, porque
-- quem liga para um grupo cancela vários toques de uma vez.
-- ------------------------------------------------------------
create or replace function public.cancel_call_invite(
  p_invite_id uuid default null,
  p_channel_id uuid default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if p_invite_id is null and p_channel_id is null then
    raise exception 'informe o convite ou o canal';
  end if;
  update public.call_invites
  set state = 'cancelled', responded_at = now()
  where state = 'ringing'
    and caller_id = v_actor
    and (p_invite_id is null or id = p_invite_id)
    and (p_channel_id is null or channel_id = p_channel_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$fn$;

revoke all on function public.expire_call_invites() from public, anon;
grant execute on function public.expire_call_invites()
  to authenticated, service_role;
revoke all on function public.start_call_invite(uuid, boolean) from public, anon;
grant execute on function public.start_call_invite(uuid, boolean) to authenticated;
revoke all on function public.respond_call_invite(uuid, boolean, boolean)
  from public, anon;
grant execute on function public.respond_call_invite(uuid, boolean, boolean)
  to authenticated;
revoke all on function public.cancel_call_invite(uuid, uuid) from public, anon;
grant execute on function public.cancel_call_invite(uuid, uuid) to authenticated;

do $do$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'call_invites'
  ) then
    alter publication supabase_realtime add table public.call_invites;
  end if;
end $do$;

commit;
