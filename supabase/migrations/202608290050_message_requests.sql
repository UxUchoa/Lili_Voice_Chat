begin;

-- ============================================================
-- Solicitações de mensagem
--
-- Uma conversa iniciada por quem ainda não é seu amigo chega como
-- solicitação: aparece numa lista à parte da Home, não conta como conversa
-- aberta e só entra na barra lateral depois de aceita.
-- ============================================================

alter table public.dm_states
  add column if not exists accepted boolean not null default true;

-- ------------------------------------------------------------
-- Quem cria a conversa marca os destinatários que ainda não são amigos.
-- O restante do corpo é o mesmo de 202608250013_p0_workspace_operations.
-- ------------------------------------------------------------
create or replace function public.create_direct_channel(
  p_member_ids uuid[],
  p_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_channel_id uuid := gen_random_uuid();
  v_actor uuid := auth.uid();
  v_members uuid[];
  v_target uuid;
  v_kind text;
  v_name text;
  v_existing uuid;
begin
  select array_agg(member_id order by member_id) into v_members
  from (
    select distinct member_id
    from unnest(array_append(coalesce(p_member_ids, '{}'), v_actor)) member_id
  ) unique_members;
  if v_actor is null or coalesce(array_length(v_members, 1), 0) not between 2 and 20 then
    raise exception 'a direct channel requires 2-20 members';
  end if;
  foreach v_target in array v_members loop
    if v_target <> v_actor and not public.can_direct_message(v_target, v_actor) then
      raise exception 'direct messages are not allowed for target %', v_target;
    end if;
  end loop;
  v_kind := case when array_length(v_members, 1) = 2 then 'dm' else 'gdm' end;
  if v_kind = 'dm' then
    select c.id into v_existing
    from public.channels c
    where c.kind = 'dm'
      and (
        select array_agg(cm.user_id order by cm.user_id)
        from public.channel_members cm where cm.channel_id = c.id
      ) = v_members
    limit 1;
    if v_existing is not null then
      -- Reabrir a conversa do próprio autor: fechar não apaga o histórico.
      insert into public.dm_states(user_id, channel_id, closed)
        values (v_actor, v_existing, false)
      on conflict (user_id, channel_id) do update set closed = false;
      return v_existing;
    end if;
  end if;
  v_name := left(
    coalesce(
      nullif(trim(p_name), ''),
      case when v_kind = 'dm' then 'Mensagem direta' else 'Novo grupo' end
    ),
    100
  );
  insert into public.channels(id, server_id, name, kind, position, private, created_by)
  values(v_channel_id, null, v_name, v_kind, 0, true, v_actor);
  insert into public.channel_members(channel_id, user_id)
  select v_channel_id, member_id from unnest(v_members) member_id;
  -- Destinatário que ainda não é amigo recebe a conversa como solicitação.
  insert into public.dm_states(user_id, channel_id, accepted)
  select member_id, v_channel_id, false
  from unnest(v_members) member_id
  where member_id <> v_actor
    and not public.are_friends(member_id, v_actor);
  return v_channel_id;
end $fn$;

-- ------------------------------------------------------------
-- Aceitar ou recusar uma solicitação de mensagem.
-- ------------------------------------------------------------
create or replace function public.respond_message_request(
  p_channel_id uuid,
  p_accept boolean
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.channel_members
    where channel_id = p_channel_id and user_id = v_actor
  ) then
    raise exception 'forbidden';
  end if;
  insert into public.dm_states(user_id, channel_id, accepted, closed)
  values (v_actor, p_channel_id, coalesce(p_accept, false), not coalesce(p_accept, false))
  on conflict (user_id, channel_id) do update set
    accepted = excluded.accepted,
    closed = excluded.closed,
    updated_at = now();
end;
$fn$;

revoke all on function public.respond_message_request(uuid, boolean)
  from public, anon;
grant execute on function public.respond_message_request(uuid, boolean)
  to authenticated;

-- ------------------------------------------------------------
-- Uma mensagem nova reabre a conversa fechada dos outros participantes.
-- A barra lateral já prometia esse comportamento, mas nada devolvia
-- `closed = false` — conversas fechadas sumiam para sempre.
-- ------------------------------------------------------------
create or replace function public.reopen_direct_channel_on_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update public.dm_states
  set closed = false, updated_at = now()
  where channel_id = new.channel_id
    and user_id <> new.author_id
    and closed
    and accepted;
  return new;
end;
$fn$;

drop trigger if exists messages_reopen_direct_channel on public.messages;
create trigger messages_reopen_direct_channel
after insert on public.messages
for each row execute function public.reopen_direct_channel_on_message();

commit;
