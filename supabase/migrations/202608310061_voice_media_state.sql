begin;

-- ============================================================
-- Quem está no canal de voz, e com o quê
--
-- A barra lateral mostrava apenas um número. Para saber quem estava numa
-- conversa era preciso entrar nela, e não havia como perceber que alguém tinha
-- aberto a câmera ou estava transmitindo a tela sem estar lá dentro.
--
-- O estado não podia ser lido do LiveKit: o cliente só enxerga a sala em que
-- ele próprio está, e a barra lateral precisa falar de todos os canais ao
-- mesmo tempo. Então ele passa a viver ao lado do participante, que já é
-- sincronizado por Realtime.
-- ============================================================

alter table public.call_session_participants
  add column if not exists camera_on boolean not null default false,
  add column if not exists screen_on boolean not null default false;

comment on column public.call_session_participants.camera_on is
  'Câmera publicada agora. Mantido pelo próprio cliente, e reafirmado a cada '
  'heartbeat para que uma queda de conexão não deixe o ícone aceso para sempre.';

-- ------------------------------------------------------------
-- Publicar o próprio estado
--
-- Só o dono da sessão de voz altera o próprio registro: ninguém pode acender a
-- câmera de outra pessoa na interface alheia.
-- ------------------------------------------------------------
create or replace function public.set_voice_media_state(
  p_session_id uuid,
  p_device_id uuid,
  p_camera_on boolean,
  p_screen_on boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authenticated session required'; end if;

  update public.call_session_participants
  set camera_on = coalesce(p_camera_on, false),
      screen_on = coalesce(p_screen_on, false),
      last_seen_at = clock_timestamp()
  where session_id = p_session_id
    and device_id = p_device_id
    and user_id = v_user_id
    and left_at is null;
end;
$fn$;

revoke all on function public.set_voice_media_state(uuid, uuid, boolean, boolean)
  from public, anon;
grant execute on function public.set_voice_media_state(uuid, uuid, boolean, boolean)
  to authenticated;

-- ------------------------------------------------------------
-- Sair apaga o estado
--
-- Sem isto, quem saísse com a câmera aberta deixaria o ícone aceso na próxima
-- vez que entrasse, antes de publicar coisa alguma.
-- ------------------------------------------------------------
create or replace function public.clear_voice_media_on_leave()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.left_at is not null and old.left_at is null then
    new.camera_on := false;
    new.screen_on := false;
  end if;
  return new;
end;
$$;

drop trigger if exists call_participants_clear_media on public.call_session_participants;
create trigger call_participants_clear_media
before update on public.call_session_participants
for each row execute function public.clear_voice_media_on_leave();

commit;
