import type { Channel, Profile, Server } from "../domain/types";
import type { ContextMenuItem } from "./ContextMenu";

export interface DirectMessageMenuInput {
  channel: Channel;
  /** Perfil do outro participante, ausente em grupos. */
  peer?: Profile;
  currentUserId: string;
  hasUnread: boolean;
  pinned: boolean;
  ignored: boolean;
  isFriend: boolean;
  mutedUntil?: string;
  /** Servidores nos quais o usuário atual pode convidar alguém. */
  invitableServers: Server[];
  actions: {
    markRead: () => void;
    togglePin: () => void;
    openProfile: () => void;
    startCall: () => void;
    editNote: () => void;
    editNickname: () => void;
    closeDm: () => void;
    inviteToServer: (serverId: string) => void;
    removeFriend: () => void;
    toggleIgnore: () => void;
    block: () => void;
    mute: (minutes: number | null) => void;
    unmute: () => void;
    copyUserId: () => void;
    copyChannelId: () => void;
  };
}

const MUTE_DURATIONS: Array<{ label: string; minutes: number | null }> = [
  { label: "Por 15 minutos", minutes: 15 },
  { label: "Por 1 hora", minutes: 60 },
  { label: "Por 3 horas", minutes: 180 },
  { label: "Por 8 horas", minutes: 480 },
  { label: "Por 24 horas", minutes: 1440 },
  { label: "Até eu ligá-las de novo", minutes: null },
];

/**
 * Itens do menu de contexto de uma conversa direta, na mesma ordem e
 * agrupamento do Discord.
 */
export function buildDirectMessageMenu({
  channel,
  peer,
  hasUnread,
  pinned,
  ignored,
  isFriend,
  mutedUntil,
  invitableServers,
  actions,
}: DirectMessageMenuInput): ContextMenuItem[] {
  const label = peer?.displayName ?? channel.name;
  const muted = Boolean(mutedUntil && new Date(mutedUntil) > new Date());
  const items: ContextMenuItem[] = [
    {
      id: "mark-read",
      label: "Marcar como lida",
      disabled: !hasUnread,
      onSelect: actions.markRead,
    },
    {
      id: "pin",
      label: pinned ? "Desafixar" : "Fixar",
      separatorBefore: true,
      onSelect: actions.togglePin,
    },
    {
      id: "profile",
      label: "Perfil",
      separatorBefore: true,
      disabled: !peer,
      onSelect: actions.openProfile,
    },
    { id: "call", label: "Iniciar chamada", onSelect: actions.startCall },
    {
      id: "note",
      label: "Adicionar nota",
      hint: "Visível apenas para você",
      disabled: !peer,
      onSelect: actions.editNote,
    },
    {
      id: "nickname",
      label: "Adicionar apelido de amigo",
      disabled: !peer,
      onSelect: actions.editNickname,
    },
    {
      id: "close",
      label: "Fechar mensagem direta",
      onSelect: actions.closeDm,
    },
  ];

  if (invitableServers.length && peer)
    items.push({
      id: "invite",
      label: "Convidar para o servidor",
      separatorBefore: true,
      submenu: invitableServers.map((server) => ({
        id: `invite-${server.id}`,
        label: server.name,
        onSelect: () => actions.inviteToServer(server.id),
      })),
    });

  if (peer) {
    items.push({
      id: "remove-friend",
      label: "Desfazer amizade",
      separatorBefore: !invitableServers.length,
      disabled: !isFriend,
      onSelect: actions.removeFriend,
    });
    items.push({
      id: "ignore",
      label: ignored ? "Parar de ignorar" : "Ignorar",
      onSelect: actions.toggleIgnore,
    });
    items.push({
      id: "block",
      label: "Bloquear",
      danger: true,
      onSelect: actions.block,
    });
  }

  items.push({
    id: "mute",
    label: muted ? `Dessilenciar ${label}` : `Silenciar ${label}`,
    separatorBefore: true,
    ...(muted
      ? { onSelect: actions.unmute }
      : {
          submenu: MUTE_DURATIONS.map((option) => ({
            id: `mute-${option.minutes ?? "forever"}`,
            label: option.label,
            onSelect: () => actions.mute(option.minutes),
          })),
        }),
  });

  if (peer)
    items.push({
      id: "copy-user",
      label: "Copiar ID do usuário",
      separatorBefore: true,
      onSelect: actions.copyUserId,
    });
  items.push({
    id: "copy-channel",
    label: "Copiar ID do canal",
    separatorBefore: !peer,
    onSelect: actions.copyChannelId,
  });
  return items;
}
