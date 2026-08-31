begin;

-- ============================================================
-- Contadores de não lidas das conversas diretas
--
-- A barra lateral da Home precisa do "bolinha + número" por conversa. Contar
-- isso no cliente exigiria baixar o histórico inteiro (que é ciphertext e
-- paginado); aqui o banco devolve só os metadados necessários.
-- ============================================================

create or replace function public.direct_channel_unreads()
returns table (
  channel_id uuid,
  last_message_at timestamptz,
  unread_count integer,
  mention_count integer
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    channel_row.id as channel_id,
    stats.last_message_at,
    coalesce(stats.unread_count, 0)::integer as unread_count,
    coalesce(read_row.mention_count, 0)::integer as mention_count
  from public.channels channel_row
  join public.channel_members self_member
    on self_member.channel_id = channel_row.id
   and self_member.user_id = auth.uid()
  left join public.read_states read_row
    on read_row.channel_id = channel_row.id
   and read_row.user_id = auth.uid()
  left join lateral (
    select
      max(message_row.created_at) as last_message_at,
      count(*) filter (
        where message_row.author_id <> auth.uid()
          and message_row.created_at > coalesce(read_row.last_read_at, 'epoch')
      ) as unread_count
    from public.messages message_row
    where message_row.channel_id = channel_row.id
      and message_row.deleted_at is null
  ) stats on true
  where channel_row.kind in ('dm', 'gdm');
$fn$;

revoke all on function public.direct_channel_unreads() from public, anon;
grant execute on function public.direct_channel_unreads() to authenticated;

commit;
