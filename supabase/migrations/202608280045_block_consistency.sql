begin;

-- Quem bloqueou precisa continuar enxergando o perfil básico do bloqueado
-- (a aba "Bloqueados" mostra nome e avatar, como no Discord). O bloqueado
-- continua sem enxergar o perfil de quem o bloqueou.
create or replace function public.can_view_profile(p_profile_id uuid, p_actor_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_profile_id = p_actor_id
    or exists(
      select 1 from public.blocks b
      where b.blocker_id = p_actor_id and b.blocked_id = p_profile_id
    )
    or (
      not public.is_blocked_pair(p_profile_id, p_actor_id)
      and exists(
        select 1 from public.profiles p
        where p.id = p_profile_id
          and (p.profile_visible or public.are_friends(p_profile_id, p_actor_id) or public.share_server(p_profile_id, p_actor_id))
      )
    );
$$;

-- Bloquear alguém encerra a amizade e qualquer solicitação pendente entre o
-- par, impedindo o estado impossível "amigo e bloqueado ao mesmo tempo".
create or replace function public.enforce_block_consistency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.friendships
  where (requester_id = new.blocker_id and addressee_id = new.blocked_id)
     or (requester_id = new.blocked_id and addressee_id = new.blocker_id);
  return new;
end;
$$;

drop trigger if exists blocks_enforce_consistency on public.blocks;
create trigger blocks_enforce_consistency
after insert on public.blocks
for each row execute function public.enforce_block_consistency();

commit;
