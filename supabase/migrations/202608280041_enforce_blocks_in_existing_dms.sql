begin;

create or replace function public.has_channel_permission(
  p_channel_id uuid,
  p_permission bigint,
  p_user_id uuid default auth.uid()
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    (public.effective_channel_permissions(p_channel_id, p_user_id) & p_permission)
      = p_permission
    and not (
      p_permission in (2::bigint, 64::bigint)
      and exists(
        select 1
        from public.channels channel_row
        join public.server_members member
          on member.server_id = channel_row.server_id
         and member.user_id = p_user_id
        where channel_row.id = p_channel_id
          and member.communication_disabled_until > now()
      )
    )
    and not (
      (p_permission & 226::bigint) <> 0
      and exists (
        select 1
        from public.channels channel_row
        join public.channel_members self_member
          on self_member.channel_id = channel_row.id
         and self_member.user_id = p_user_id
        join public.channel_members other_member
          on other_member.channel_id = channel_row.id
         and other_member.user_id <> p_user_id
        where channel_row.id = p_channel_id
          and channel_row.kind = 'dm'
          and public.is_blocked_pair(p_user_id, other_member.user_id)
      )
    );
$$;

revoke all on function public.has_channel_permission(uuid, bigint, uuid)
from public, anon;
grant execute on function public.has_channel_permission(uuid, bigint, uuid)
to authenticated, service_role;

commit;
