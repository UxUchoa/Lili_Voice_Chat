begin;

-- ============================================================
-- Notas, apelidos e "ignorar" por contato (menu de contexto da DM)
-- ============================================================
create table if not exists public.user_contacts (
  user_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  nickname text,
  note text,
  ignored boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, target_user_id),
  constraint user_contacts_not_self check (user_id <> target_user_id),
  constraint user_contacts_nickname_length check (nickname is null or char_length(nickname) <= 32),
  constraint user_contacts_note_length check (note is null or char_length(note) <= 256)
);

alter table public.user_contacts enable row level security;
create policy user_contacts_select on public.user_contacts
  for select to authenticated using (user_id = (select auth.uid()));
create policy user_contacts_insert on public.user_contacts
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy user_contacts_update on public.user_contacts
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy user_contacts_delete on public.user_contacts
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_contacts to authenticated;

-- ============================================================
-- Estado local das conversas diretas: fixar e fechar
-- ============================================================
create table if not exists public.dm_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  pinned boolean not null default false,
  closed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, channel_id)
);

alter table public.dm_states enable row level security;
create policy dm_states_select on public.dm_states
  for select to authenticated using (user_id = (select auth.uid()));
create policy dm_states_insert on public.dm_states
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy dm_states_update on public.dm_states
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy dm_states_delete on public.dm_states
  for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.dm_states to authenticated;

-- ============================================================
-- Privacidade por servidor
-- ============================================================
create table if not exists public.server_privacy_settings (
  user_id uuid not null references public.profiles(id) on delete cascade,
  server_id uuid not null references public.servers(id) on delete cascade,
  allow_direct_messages boolean not null default true,
  filter_message_requests boolean not null default true,
  share_activity boolean not null default false,
  allow_activity_join boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (user_id, server_id)
);

alter table public.server_privacy_settings enable row level security;
create policy server_privacy_select on public.server_privacy_settings
  for select to authenticated using (user_id = (select auth.uid()));
create policy server_privacy_insert on public.server_privacy_settings
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy server_privacy_update on public.server_privacy_settings
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.server_privacy_settings to authenticated;

-- ============================================================
-- Ignorar precisa valer também no envio: quem ignora não recebe
-- notificação, mas continua podendo abrir a conversa (diferente de bloquear).
-- ============================================================
create or replace function public.is_ignored_by(p_target_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.user_contacts
    where user_id = p_actor_id and target_user_id = p_target_id and ignored
  );
$$;
revoke all on function public.is_ignored_by(uuid, uuid) from public, anon;
grant execute on function public.is_ignored_by(uuid, uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array['user_contacts','dm_states','server_privacy_settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
