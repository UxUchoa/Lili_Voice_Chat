import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Fragment,
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Permissions,
  hasPermission,
  resolvePermissions,
} from "./domain/permissions";
import type {
  Channel,
  Friendship,
  MessageView,
  NotificationSetting,
  Profile,
  Role,
  Server,
  ServerMember,
} from "./domain/types";
import { useMessages } from "./hooks/useMessages";
import { useRtc } from "./hooks/useRtc";
import type { CameraResolution, RemotePeer } from "./hooks/useLiveKitRtc";
import { useOnlinePresence } from "./hooks/useOnlinePresence";
import { useTyping } from "./hooks/useTyping";
import { useForegroundNotifications } from "./hooks/useForegroundNotifications";
import { downloadOnlineAttachment, getMlsEngine } from "./crypto/mlsEngine";
import {
  getCurrentOnlineAccount,
  listOnlineAccountSessions,
  loginOnlineAccount,
  logoutOnlineAccount,
  clearPasswordRecoveryLink,
  isPasswordRecoveryLink,
  registerOnlineAccount,
  requestOnlinePasswordReset,
  revokeOnlineAccountSession,
  revokeOtherOnlineAccountSessions,
  updateOnlinePassword,
  type OnlineAuthSession,
  type OnlineAccount,
} from "./services/online/auth";
import {
  createOnlineInvite,
  createOnlineChannel,
  hydrateOnlineWorkspace,
  redeemOnlineInvite,
  revokeOnlineInvite,
  subscribeOnlineWorkspace,
} from "./services/online/data";
import { registerRemotePush } from "./services/online/push";
import {
  getOnlineQuotaStatus,
  getServerQuotaStatus,
  pruneOnlineServerMessages,
  type OnlineQuotaStatus,
  type ServerQuotaStatus,
} from "./services/online/quota";
import { supabase } from "./services/online/client";
import {
  listRecentOnlineCalls,
  subscribeActiveOnlineVoiceCounts,
  subscribeActiveOnlineVoiceMembers,
  subscribeVoiceMoveRequests,
  type OnlineVoiceMember,
  type OnlineVoiceMembers,
  type OnlineCallSession,
} from "./services/online/calls";
import {
  addOnlineGroupDmMember,
  cancelOnlineFriendRequest,
  createOnlineDirectChannel,
  blockOnlineUser,
  createOnlineRole,
  deleteOnlineChannel,
  deleteOnlineRole,
  deleteOnlineServer,
  duplicateOnlineChannel,
  duplicateOnlineRole,
  leaveOnlineServer,
  markOnlineChannelRead,
  moderateOnlineVoice,
  moveOnlineChannelToCategory,
  moderateOnlineMember,
  removeOnlineFriend,
  removeOnlineGroupDmMember,
  requestOnlineFriend,
  respondOnlineFriend,
  reorderOnlineChannel,
  reorderOnlineRole,
  setOnlineChannelOverride,
  setOnlineMemberRole,
  saveOnlineGroupDm,
  transferOnlineServer,
  unblockOnlineUser,
  unbanOnlineMember,
  updateOnlineChannel,
  updateOnlineMemberNickname,
  updateOnlineRole,
  syncOnlineChannelWithCategory,
} from "./services/online/actions";
import {
  createOnlineServerProfile,
  updateOnlineServerProfile,
} from "./services/online/servers";
import {
  listDecryptedOnlineMessages,
  listOnlineDevices,
  revokeOnlineDevice,
  saveOnlinePrivacy,
  saveOnlineProfile,
  uploadOnlineProfileMedia,
  verifyOnlineDevice,
  type OnlineDevice,
} from "./services/online/profile";
import { useAppStore } from "./store/appStore";
import { reportRuntimeError } from "./services/runtimeErrors";
import { MediaCropModal } from "./ui/MediaCropModal";
import { DeviceMenu } from "./ui/DeviceMenu";
import { ContextMenu, useContextMenu } from "./ui/ContextMenu";
import { ComposerPicker } from "./ui/ComposerPicker";
import { MessageAttachment } from "./ui/MessageAttachment";
import {
  expireOnlineAttachments,
  listOnlineAttachmentResendRequests,
  requestOnlineAttachmentResend,
  resolveOnlineAttachmentResend,
  subscribeOnlineAttachmentResendRequests,
  type AttachmentResendRequest,
} from "./services/online/attachments";
import { useConfirm } from "./ui/ConfirmModal";
import { buildDirectMessageMenu } from "./ui/useDirectMessageMenu";
import { UserProfileModal, type UserRelationship } from "./ui/UserProfileModal";
import { ServerPrivacyModal } from "./ui/ServerPrivacyModal";
import {
  listUserContacts,
  respondMessageRequest,
  saveServerPrivacy,
  setContactIgnored,
  setContactNote,
  setDmState,
  setFriendNickname,
  subscribeDirectChannelUnreads,
  type DirectChannelUnread,
} from "./services/online/contacts";
import {
  playSound,
  primeAudioOnUserGesture,
  setSoundVolume,
  setSoundsEnabled,
  soundVolume,
  soundsEnabled,
} from "./services/sounds";
import { useCallSignaling } from "./hooks/useCallSignaling";
import { IncomingCallOverlay, OutgoingCallOverlay } from "./ui/CallOverlays";
import { ServerIcon } from "./ui/ServerIcon";
import { ChannelSetupModal, type NewChannelKind } from "./ui/ChannelSetupModal";
import { ChannelSettingsModal } from "./ui/ChannelSettingsModal";
import {
  ServerProfileFields,
  emptyServerProfileDraft,
  type ServerProfileDraft,
} from "./ui/ServerProfileFields";
import {
  inviteCodeFromHash,
  inviteUrl,
  locationHash,
  parseLocationHash,
  useNavigationStore,
} from "./store/navigationStore";
import {
  ScreenSharePicker,
  type ShareQuality,
  type ShareSelection,
} from "./ui/ScreenSharePicker";
import {
  IconBan,
  IconBell,
  IconBellOff,
  IconCamera,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconHash,
  IconHeadphones,
  IconHeadphonesOff,
  IconHelp,
  IconInbox,
  IconMaximize,
  IconMessage,
  IconMic,
  IconMicOff,
  IconMonitor,
  IconMoreHorizontal,
  IconPencil,
  IconPhone,
  IconPhoneOff,
  IconPictureInPicture,
  IconPin,
  IconPlus,
  IconReply,
  IconScreenShare,
  IconScreenShareOff,
  IconSearch,
  IconSend,
  IconSettings,
  IconSmile,
  IconTrash,
  IconUpload,
  IconUserPlus,
  IconUsers,
  IconUserX,
  IconVideo,
  IconVideoOff,
  IconVolume,
  IconX,
} from "./ui/icons";
import "./styles.css";
import "./styles.discord.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 2_000, retry: 1 } },
});
type AppAccount = OnlineAccount;
const serverPermissionMask = (
  server: Server | undefined,
  userId: string,
  roles: Role[],
  members: ServerMember[],
) => {
  if (!server) return 0n;
  const everyoneRole = roles.find(
    (role) => role.serverId === server.id && role.isDefault,
  );
  if (!everyoneRole) return 0n;
  const member = members.find(
    (item) => item.serverId === server.id && item.userId === userId,
  );
  return resolvePermissions({
    userId,
    ownerId: server.ownerId,
    everyoneRole: {
      ...everyoneRole,
      permissions: BigInt(everyoneRole.permissions),
    },
    memberRoles: roles
      .filter((role) => member?.roleIds.includes(role.id))
      .map((role) => ({ ...role, permissions: BigInt(role.permissions) })),
  });
};
const deviceVerificationCode = (fingerprint: string) =>
  fingerprint
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 20)
    .toUpperCase()
    .match(/.{1,4}/g)
    ?.join("-") ?? "";
const notificationMuteUntil = (hours: number) =>
  new Date(Date.now() + hours * 60 * 60 * 1_000).toISOString();
const requestNotificationAccess = () => {
  if (
    !window.janjaDesktop &&
    "Notification" in window &&
    Notification.permission === "default"
  )
    void Notification.requestPermission();
};
type Person = Pick<
  Profile,
  | "id"
  | "displayName"
  | "username"
  | "avatar"
  | "avatarUrl"
  | "color"
  | "status"
> & { role?: string; self?: boolean };

function Icon({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`icon ${className}`} aria-hidden="true">
      {children}
    </span>
  );
}

/**
 * Substituto para um perfil que este usuário não pode mais enxergar — depois
 * de um bloqueio, por exemplo. Antes o código caía em `profiles[0]`, que
 * atribuía as mensagens ao nome e ao avatar de uma pessoa qualquer.
 */
const unknownPerson = (id: string): Profile => ({
  id,
  username: "indisponivel",
  displayName: "Usuário indisponível",
  avatar: "?",
  color: "#5a5257",
  bio: "",
  pronouns: "",
  customStatus: "",
  status: "offline",
  preferredStatus: "offline",
  createdAt: new Date(0).toISOString(),
});

function Avatar({
  person,
  size = "md",
  online = true,
}: {
  person: Pick<Person, "avatar" | "avatarUrl" | "color" | "status">;
  size?: "sm" | "md" | "lg" | "xl";
  online?: boolean;
}) {
  return (
    <span
      className={`avatar avatar-${size}`}
      style={{ "--avatar-color": person.color } as CSSProperties}
    >
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" />
      ) : (
        <span>{person.avatar}</span>
      )}
      {online && <i className={`presence ${person.status}`} />}
    </span>
  );
}

function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`brand ${compact ? "brand-compact" : ""}`}>
      <img src="/logo-vetorizada.svg" alt="" />
      <span>Janja</span>
    </div>
  );
}

function Titlebar({
  serverName,
  channelName,
  navigationOpen,
  onToggleNavigation,
  onSearch,
  onInbox,
  onHelp,
}: {
  serverName: string;
  channelName: string;
  navigationOpen: boolean;
  onToggleNavigation: () => void;
  onSearch: () => void;
  onInbox: () => void;
  onHelp: () => void;
}) {
  return (
    <header className="titlebar">
      <Logo />
      <button
        className="mobile-nav-button"
        aria-label={navigationOpen ? "Fechar navegação" : "Abrir navegação"}
        aria-expanded={navigationOpen}
        onClick={onToggleNavigation}
      >
        {navigationOpen ? "×" : "☰"}
      </button>
      <div className="breadcrumbs">
        <span>{serverName}</span>
        <b>/</b>
        <strong>{channelName}</strong>
      </div>
      <div className="title-actions">
        <button className="search-pill" onClick={onSearch}>
          <IconSearch size={16} />
          <span>Busca rápida</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button className="icon-button" aria-label="Inbox" onClick={onInbox}>
          <IconInbox size={20} />
          <i className="notification-dot" />
        </button>
        <button className="icon-button" aria-label="Ajuda" onClick={onHelp}>
          <IconHelp size={20} />
        </button>
        {window.janjaDesktop && (
          <>
            <button
              className="window-button"
              aria-label="Minimizar"
              onClick={() => window.janjaDesktop?.minimize()}
            >
              —
            </button>
            <button
              className="window-button"
              aria-label="Maximizar"
              onClick={() => window.janjaDesktop?.maximize()}
            >
              □
            </button>
            <button
              className="window-button close"
              aria-label="Fechar"
              onClick={() => window.janjaDesktop?.close()}
            >
              ×
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function ServerRail({
  view,
  selectedServerId,
  unreadDirectCount,
  pendingRequestCount,
  onHome,
  onServer,
  onSearch,
  onSettings,
  onAddServer,
}: {
  view: "home" | "server";
  selectedServerId: string;
  unreadDirectCount: number;
  pendingRequestCount: number;
  onHome: () => void;
  onServer: (serverId: string) => void;
  onSearch: () => void;
  onSettings: () => void;
  onAddServer: () => void;
}) {
  const servers = useAppStore((state) => state.servers);
  const home = view === "home";
  const homeBadge = unreadDirectCount + pendingRequestCount;
  return (
    <aside className="server-rail">
      <button
        className={`rail-home ${home ? "active" : ""}`}
        onClick={onHome}
        aria-label="Início — amigos e mensagens diretas"
        aria-current={home ? "page" : undefined}
        title="Início"
      >
        <Logo compact />
        {homeBadge > 0 && (
          <em className="rail-badge" aria-label={`${homeBadge} pendências`}>
            {homeBadge > 99 ? "99+" : homeBadge}
          </em>
        )}
      </button>
      <div className="rail-divider" />
      {servers.map((server) => (
        <button
          key={server.id}
          className={`server-avatar ${
            !home && selectedServerId === server.id ? "selected" : ""
          }`}
          onClick={() => onServer(server.id)}
          aria-label={server.name}
          aria-current={
            !home && selectedServerId === server.id ? "page" : undefined
          }
          title={server.name}
        >
          <ServerIcon server={server} size={44} />
        </button>
      ))}
      <button
        className="server-avatar server-add"
        aria-label="Adicionar servidor"
        title="Adicionar servidor"
        onClick={onAddServer}
      >
        <IconPlus size={22} />
      </button>
      <div className="rail-spacer" />
      <button
        className="rail-action"
        aria-label="Busca rápida"
        title="Busca rápida (Ctrl+K)"
        onClick={onSearch}
      >
        <IconSearch size={20} />
      </button>
      <button
        className="rail-action"
        aria-label="Configurações"
        title="Configurações"
        onClick={onSettings}
      >
        <IconSettings size={20} />
      </button>
    </aside>
  );
}

function ServerSetupModal({
  required = false,
  onClose,
  onReady,
}: {
  required?: boolean;
  onClose: () => void;
  onReady: (serverId: string) => void;
}) {
  const currentUserId = useAppStore((state) => state.currentUserId);
  const [mode, setMode] = useState<"choose" | "create" | "join">("choose");
  const [draft, setDraft] = useState<ServerProfileDraft>(() =>
    emptyServerProfileDraft(),
  );
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nameError, setNameError] = useState("");

  const createServer = async () => {
    // Nome só de espaços não é nome: a validação acontece antes de qualquer
    // chamada de rede e o modal continua aberto para a correção.
    if (!draft.name.trim()) {
      setNameError("Informe um nome para o servidor.");
      setError("");
      return;
    }
    setNameError("");
    setBusy(true);
    setError("");
    try {
      const serverId = await createOnlineServerProfile({
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
      });
      await hydrateOnlineWorkspace(currentUserId);
      // O modal só fecha quando o servidor existe de verdade no banco.
      onReady(serverId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível criar o servidor. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };

  const joinServer = async () => {
    setBusy(true);
    setError("");
    try {
      const serverId = await redeemOnlineInvite(code);
      await hydrateOnlineWorkspace(currentUserId);
      onReady(serverId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível entrar com este convite.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className={`server-setup-card ${mode === "create" ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="server-setup-title"
      >
        {!required && (
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Fechar"
            disabled={busy}
          >
            <IconX size={18} />
          </button>
        )}
        <Logo />
        <span className="eyebrow">WORKSPACE COMPARTILHADO</span>
        <h2 id="server-setup-title">
          {mode === "create"
            ? "Criar um servidor"
            : mode === "join"
              ? "Entrar com convite"
              : "Onde vamos conversar?"}
        </h2>
        {mode === "choose" ? (
          <div className="server-setup-options">
            <button onClick={() => setMode("create")}>
              <Icon>＋</Icon>
              <b>Criar servidor</b>
              <span>Escolha nome, ícone e descrição do seu espaço.</span>
            </button>
            <button onClick={() => setMode("join")}>
              <Icon>↗</Icon>
              <b>Entrar em servidor</b>
              <span>Use o código criado por outro participante.</span>
            </button>
          </div>
        ) : mode === "create" ? (
          <>
            <p className="server-setup-help">
              O nome, o ícone e a descrição formam o perfil do servidor e
              aparecem para todos que entrarem nele.
            </p>
            <ServerProfileFields
              draft={draft}
              onChange={(next) => {
                setDraft(next);
                if (next.name.trim()) setNameError("");
              }}
              disabled={busy}
              nameError={
                nameError ||
                (draft.name.length > 0 && !draft.name.trim()
                  ? "O nome não pode conter apenas espaços."
                  : "")
              }
              autoFocusName
            />
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <div className="server-setup-actions">
              <button
                className="outline-button"
                disabled={busy}
                onClick={() => {
                  setMode("choose");
                  setError("");
                  setNameError("");
                }}
              >
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={busy || !draft.name.trim()}
                onClick={() => void createServer()}
              >
                {busy ? "Criando…" : "Criar servidor"}
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="server-setup-field">
              Código ou link do convite
              <input
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && void joinServer()
                }
                placeholder="Cole o link do convite"
              />
            </label>
            {error && (
              <div className="auth-error" role="alert">
                {error}
              </div>
            )}
            <div className="server-setup-actions">
              <button
                className="outline-button"
                disabled={busy}
                onClick={() => {
                  setMode("choose");
                  setError("");
                }}
              >
                Voltar
              </button>
              <button
                className="primary-button"
                disabled={busy || !code.trim()}
                onClick={() => void joinServer()}
              >
                {busy ? "Conectando…" : "Entrar"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function NewDirectMessageModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (channelId: string) => void;
}) {
  const profiles = useAppStore((state) => state.profiles),
    friendships = useAppStore((state) => state.friendships),
    blocks = useAppStore((state) => state.blocks),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<string[]>([]),
    [groupName, setGroupName] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const blockedIds = new Set(
    blocks
      .filter((item) =>
        [item.blockerId, item.blockedId].includes(currentUserId),
      )
      .map((item) =>
        item.blockerId === currentUserId ? item.blockedId : item.blockerId,
      ),
  );
  const friends = friendships
    .filter(
      (item) =>
        item.status === "accepted" &&
        [item.requesterId, item.addresseeId].includes(currentUserId),
    )
    .map((item) =>
      profiles.find(
        (profile) =>
          profile.id ===
          (item.requesterId === currentUserId
            ? item.addresseeId
            : item.requesterId),
      ),
    )
    .filter(
      (profile): profile is Profile =>
        Boolean(profile) && !blockedIds.has(profile!.id),
    )
    .filter((profile) => {
      const term = query.trim().toLowerCase();
      return (
        !term ||
        `${profile.displayName} ${profile.username}`
          .toLowerCase()
          .includes(term)
      );
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
  const create = async () => {
    if (selected.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const channelId = await createOnlineDirectChannel(
        selected,
        selected.length > 1 ? groupName.trim() || "Novo grupo" : undefined,
      );
      await hydrateOnlineWorkspace(currentUserId);
      onCreated(channelId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível abrir a conversa.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="account-panel create-group-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Nova conversa"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">NOVA CONVERSA E2EE</span>
            <h2>{selected.length > 1 ? "Criar grupo" : "Iniciar conversa"}</h2>
          </div>
          <button
            className="close-settings"
            aria-label="Fechar"
            onClick={onClose}
          >
            <IconX size={18} />
          </button>
        </header>
        <p className="empty-copy">
          Escolha uma pessoa para uma conversa direta ou marque várias para
          formar um grupo.
        </p>
        <div className="friend-filter">
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar amigos"
            aria-label="Buscar amigos"
          />
          <IconSearch size={18} />
        </div>
        {selected.length > 1 && (
          <label>
            Nome do grupo
            <input
              aria-label="Nome do grupo"
              value={groupName}
              maxLength={100}
              placeholder="Novo grupo"
              onChange={(event) => setGroupName(event.target.value)}
            />
          </label>
        )}
        <span className="eyebrow">
          {selected.length} SELECIONADO{selected.length === 1 ? "" : "S"}
        </span>
        <div className="create-group-friends">
          {friends.map((profile) => (
            <label key={profile.id}>
              <input
                type="checkbox"
                checked={selected.includes(profile.id)}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(profile.id)
                      ? current.filter((id) => id !== profile.id)
                      : current.length < 19
                        ? [...current, profile.id]
                        : current,
                  )
                }
              />
              <Avatar person={profile} size="sm" />
              <span>
                <b>{profile.displayName}</b>
                <small>@{profile.username}</small>
              </span>
            </label>
          ))}
          {friends.length === 0 && (
            <p className="empty-copy">
              {query.trim()
                ? "Nenhum amigo corresponde à busca."
                : "Adicione amigos para começar uma conversa."}
            </p>
          )}
        </div>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="primary-button"
          disabled={busy || selected.length === 0}
          onClick={() => void create()}
        >
          {busy
            ? "Abrindo…"
            : selected.length > 1
              ? "Criar grupo cifrado"
              : "Abrir conversa"}
        </button>
      </section>
    </div>
  );
}

/**
 * Barra lateral da Home. É o contraponto de `ChannelSidebar`: aqui só existe
 * comunicação privada — amigos, solicitações e conversas diretas. Nenhum
 * elemento de servidor aparece nesta coluna.
 */
function DirectMessageSidebar({
  section,
  activeChannelId,
  unreads,
  onFriends,
  onRequests,
  onChannel,
  onProfile,
  onProfilePreview,
  onCall,
}: {
  section: "friends" | "requests" | "dm";
  activeChannelId: string;
  unreads: DirectChannelUnread[];
  onFriends: () => void;
  onRequests: () => void;
  onChannel: (channelId: string) => void;
  onProfile: () => void;
  onProfilePreview: (userId: string) => void;
  onCall: (channelId: string, withVideo: boolean) => void;
}) {
  const channels = useAppStore((state) => state.channels),
    servers = useAppStore((state) => state.servers),
    members = useAppStore((state) => state.members),
    profiles = useAppStore((state) => state.profiles),
    contacts = useAppStore((state) => state.contacts),
    dmStates = useAppStore((state) => state.dmStates),
    channelMembers = useAppStore((state) => state.channelMembers),
    friendships = useAppStore((state) => state.friendships),
    blocks = useAppStore((state) => state.blocks),
    notificationSettings = useAppStore((state) => state.notificationSettings),
    setNotificationSetting = useAppStore(
      (state) => state.setNotificationSetting,
    ),
    markChannelRead = useAppStore((state) => state.markChannelRead),
    currentUserId = useAppStore((state) => state.currentUserId);
  const contextMenu = useContextMenu();
  const [newDmOpen, setNewDmOpen] = useState(false);
  const currentUser =
    profiles.find((profile) => profile.id === currentUserId) ?? profiles[0];
  const refreshWorkspace = () => hydrateOnlineWorkspace(currentUserId);
  const dmStateFor = (channelId: string) =>
    dmStates.find((item) => item.channelId === channelId);
  const unreadFor = (channelId: string) =>
    unreads.find((item) => item.channelId === channelId);
  const peerOf = (channel: Channel) =>
    channel.kind === "dm"
      ? profiles.find(
          (profile) =>
            profile.id !== currentUserId &&
            channelMembers.some(
              (member) =>
                member.channelId === channel.id && member.userId === profile.id,
            ),
        )
      : undefined;
  const contactFor = (userId?: string) =>
    userId ? contacts.find((item) => item.targetUserId === userId) : undefined;
  const pendingFriendRequests = friendships.filter(
    (item) => item.status === "pending" && item.addresseeId === currentUserId,
  ).length;
  const directChannels = channels.filter(
    (channel) => channel.serverId === "direct",
  );
  const messageRequests = directChannels.filter((channel) => {
    const state = dmStateFor(channel.id);
    return state ? !state.accepted && !state.closed : false;
  });
  const conversations = directChannels
    .filter((channel) => {
      const state = dmStateFor(channel.id);
      // Solicitações não aparecem entre as conversas; conversas fechadas
      // voltam sozinhas quando chega uma mensagem nova.
      if (!state) return true;
      return state.accepted && !state.closed;
    })
    .sort((left, right) => {
      const pinnedDelta =
        Number(Boolean(dmStateFor(right.id)?.pinned)) -
        Number(Boolean(dmStateFor(left.id)?.pinned));
      if (pinnedDelta) return pinnedDelta;
      const recency =
        new Date(unreadFor(right.id)?.lastMessageAt ?? 0).getTime() -
        new Date(unreadFor(left.id)?.lastMessageAt ?? 0).getTime();
      return recency || left.position - right.position;
    });
  const blockedWith = (userId?: string) =>
    Boolean(
      userId &&
      blocks.some(
        (block) =>
          [block.blockerId, block.blockedId].includes(currentUserId) &&
          [block.blockerId, block.blockedId].includes(userId),
      ),
    );
  const openDirectMessageMenu = (event: ReactMouseEvent, channel: Channel) => {
    const peer = peerOf(channel);
    const state = dmStateFor(channel.id);
    const notification = notificationSettings.find(
      (item) =>
        item.userId === currentUserId &&
        item.scopeType === "CHANNEL" &&
        item.scopeId === channel.id,
    );
    contextMenu.open(
      event,
      buildDirectMessageMenu({
        channel,
        peer,
        currentUserId,
        hasUnread: (unreadFor(channel.id)?.unreadCount ?? 0) > 0,
        pinned: Boolean(state?.pinned),
        ignored: Boolean(contactFor(peer?.id)?.ignored),
        isFriend: friendships.some(
          (item) =>
            item.status === "accepted" &&
            peer &&
            [item.requesterId, item.addresseeId].includes(currentUserId) &&
            [item.requesterId, item.addresseeId].includes(peer.id),
        ),
        mutedUntil: notification?.mutedUntil,
        invitableServers: servers.filter((item) =>
          members.some(
            (member) =>
              member.serverId === item.id && member.userId === currentUserId,
          ),
        ),
        actions: {
          markRead: () => {
            markChannelRead(channel.id);
            void markOnlineChannelRead(channel.id).catch(() => {});
          },
          togglePin: () =>
            void setDmState(currentUserId, channel.id, {
              pinned: !state?.pinned,
            }).then(refreshWorkspace),
          openProfile: () => peer && onProfilePreview(peer.id),
          startCall: () => onCall(channel.id, false),
          editNote: () => {
            if (!peer) return;
            const note = window.prompt(
              `Nota sobre ${peer.displayName} (visível apenas para você)`,
              contactFor(peer.id)?.note ?? "",
            );
            if (note === null) return;
            void setContactNote(currentUserId, peer.id, note).then(
              refreshWorkspace,
            );
          },
          editNickname: () => {
            if (!peer) return;
            const nickname = window.prompt(
              `Apelido para ${peer.displayName}`,
              contactFor(peer.id)?.nickname ?? "",
            );
            if (nickname === null) return;
            void setFriendNickname(currentUserId, peer.id, nickname).then(
              refreshWorkspace,
            );
          },
          closeDm: () =>
            void setDmState(currentUserId, channel.id, { closed: true }).then(
              refreshWorkspace,
            ),
          inviteToServer: (serverId) =>
            void createOnlineInvite(serverId, channel.id)
              .then((code) =>
                navigator.clipboard
                  .writeText(code)
                  .catch(() => undefined)
                  .then(() =>
                    reportRuntimeError(
                      `Convite ${code} copiado para a área de transferência`,
                    ),
                  ),
              )
              .catch((caught) =>
                reportRuntimeError("Falha ao criar convite", caught),
              ),
          removeFriend: () => {
            const friendship = friendships.find(
              (item) =>
                item.status === "accepted" &&
                peer &&
                [item.requesterId, item.addresseeId].includes(currentUserId) &&
                [item.requesterId, item.addresseeId].includes(peer.id),
            );
            if (friendship)
              void removeOnlineFriend(friendship.id).then(refreshWorkspace);
          },
          toggleIgnore: () =>
            peer &&
            void setContactIgnored(
              currentUserId,
              peer.id,
              !contactFor(peer.id)?.ignored,
            ).then(refreshWorkspace),
          block: () =>
            peer &&
            void blockOnlineUser(currentUserId, peer.id).then(refreshWorkspace),
          mute: (minutes) =>
            setNotificationSetting({
              scopeType: "CHANNEL",
              scopeId: channel.id,
              mode: notification?.mode ?? "ALL",
              suppressEveryone: notification?.suppressEveryone ?? false,
              suppressRoles: notification?.suppressRoles ?? false,
              mutedUntil:
                minutes === null
                  ? new Date(Date.now() + 100 * 365 * 86_400_000).toISOString()
                  : new Date(Date.now() + minutes * 60_000).toISOString(),
            }),
          unmute: () =>
            setNotificationSetting({
              scopeType: "CHANNEL",
              scopeId: channel.id,
              mode: notification?.mode ?? "ALL",
              suppressEveryone: notification?.suppressEveryone ?? false,
              suppressRoles: notification?.suppressRoles ?? false,
              mutedUntil: undefined,
            }),
          copyUserId: () =>
            peer && void navigator.clipboard.writeText(peer.id).catch(() => {}),
          copyChannelId: () =>
            void navigator.clipboard.writeText(channel.id).catch(() => {}),
        },
      }),
    );
  };
  return (
    <aside className="channel-sidebar dm-sidebar">
      <div className="dm-heading">
        <strong>Mensagens diretas</strong>
      </div>
      <div className="channel-scroll">
        <button
          className={`dm-nav-row ${section === "friends" ? "active" : ""}`}
          onClick={onFriends}
          aria-current={section === "friends" ? "page" : undefined}
        >
          <IconUsers size={20} />
          <span>Amigos</span>
          {pendingFriendRequests > 0 && (
            <em
              className="dm-badge"
              aria-label={`${pendingFriendRequests} pedidos de amizade`}
            >
              {pendingFriendRequests}
            </em>
          )}
        </button>
        <button
          className={`dm-nav-row ${section === "requests" ? "active" : ""}`}
          onClick={onRequests}
          aria-current={section === "requests" ? "page" : undefined}
        >
          <IconInbox size={20} />
          <span>Solicitações de mensagem</span>
          {messageRequests.length > 0 && (
            <em
              className="dm-badge"
              aria-label={`${messageRequests.length} solicitações de mensagem`}
            >
              {messageRequests.length}
            </em>
          )}
        </button>
        <div className="channel-group">
          <div className="group-title">
            <span>CONVERSAS</span>
            <button
              className="group-add"
              aria-label="Iniciar nova conversa"
              title="Nova conversa"
              onClick={() => setNewDmOpen(true)}
            >
              <IconPlus size={16} />
            </button>
          </div>
          {conversations.map((channel) => {
            const peer = peerOf(channel);
            const nickname = contactFor(peer?.id)?.nickname;
            const unread = unreadFor(channel.id)?.unreadCount ?? 0;
            const blocked = blockedWith(peer?.id);
            return (
              <button
                key={channel.id}
                onClick={() => onChannel(channel.id)}
                onContextMenu={(event) => openDirectMessageMenu(event, channel)}
                className={`channel-row dm-row ${
                  activeChannelId === channel.id ? "active" : ""
                } ${unread > 0 ? "unread" : ""}`}
                aria-current={
                  activeChannelId === channel.id ? "page" : undefined
                }
              >
                {channel.kind === "gdm" ? (
                  channel.iconUrl ? (
                    <img
                      className="gdm-channel-icon"
                      src={channel.iconUrl}
                      alt=""
                    />
                  ) : (
                    <span className="gdm-channel-icon fallback">
                      <IconUsers size={16} />
                    </span>
                  )
                ) : peer ? (
                  <Avatar person={peer} size="sm" />
                ) : (
                  <Icon>@</Icon>
                )}
                <span className="dm-row-name">{nickname || channel.name}</span>
                {blocked && (
                  <IconBan
                    size={14}
                    className="dm-blocked"
                    aria-label="Bloqueado"
                  />
                )}
                {dmStateFor(channel.id)?.pinned && (
                  <IconPin size={13} className="dm-pinned" />
                )}
                {unread > 0 && (
                  <em className="dm-badge" aria-label={`${unread} não lidas`}>
                    {unread > 99 ? "99+" : unread}
                  </em>
                )}
              </button>
            );
          })}
          {conversations.length === 0 && (
            <p className="empty-copy dm-empty">
              Nenhuma conversa aberta. Escolha alguém em Amigos para começar.
            </p>
          )}
        </div>
      </div>
      <button className="user-panel" onClick={onProfile}>
        <Avatar person={currentUser} size="sm" />
        <div className="user-copy">
          <b>{currentUser.displayName}</b>
          <span>{currentUser.status}</span>
        </div>
        <IconSettings size={18} />
      </button>
      {contextMenu.menu && (
        <ContextMenu state={contextMenu.menu} onClose={contextMenu.close} />
      )}
      {newDmOpen && (
        <NewDirectMessageModal
          onClose={() => setNewDmOpen(false)}
          onCreated={(channelId) => {
            setNewDmOpen(false);
            onChannel(channelId);
          }}
        />
      )}
    </aside>
  );
}

/**
 * Quem está no canal de voz, listado abaixo dele.
 *
 * Antes havia só um número, e para descobrir quem estava numa conversa era
 * preciso entrar nela — o que, num canal de voz, significa aparecer. Os ícones
 * dizem o que cada um está transmitindo sem que ninguém precise perguntar.
 */
function VoiceChannelMembers({
  members,
  profiles,
}: {
  members: OnlineVoiceMember[];
  profiles: Profile[];
}) {
  if (!members.length) return null;
  return (
    <ul className="voice-members">
      {members.map((member) => {
        const person = profiles.find((one) => one.id === member.userId);
        // Um participante recém-entrado pode chegar antes do perfil dele na
        // reconciliação do workspace; some da lista por um instante é pior que
        // aparecer sem nome.
        if (!person) return null;
        return (
          <li key={member.userId} className="voice-member">
            <Avatar person={person} size="sm" />
            <span className="voice-member-name">{person.displayName}</span>
            {member.screenOn && (
              <span className="voice-member-live" title="Transmitindo a tela">
                AO VIVO
              </span>
            )}
            {member.cameraOn && <IconVideo size={13} aria-label="Com câmera" />}
          </li>
        );
      })}
    </ul>
  );
}

function ChannelSidebar({
  serverId,
  activeChannelId,
  voiceMembers,
  onChannel,
  onSettings,
  onProfile,
}: {
  serverId: string;
  activeChannelId: string;
  /**
   * Quem está em cada canal de voz, vindo de cima. A barra chegou a assinar a
   * própria contagem, o que abria mais um canal de Realtime para dizer um
   * número que esta lista já contém — e os dois podiam discordar por um
   * instante.
   */
  voiceMembers: OnlineVoiceMembers;
  onChannel: (id: string) => void;
  onSettings: () => void;
  onProfile: () => void;
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    () => {
      try {
        return new Set(
          JSON.parse(
            localStorage.getItem("janja-collapsed-categories") ?? "[]",
          ) as string[],
        );
      } catch {
        return new Set();
      }
    },
  );
  const channels = useAppStore((state) => state.channels);
  const servers = useAppStore((state) => state.servers);
  const profiles = useAppStore((state) => state.profiles);
  const roles = useAppStore((state) => state.roles);
  const members = useAppStore((state) => state.members);
  const currentUserId = useAppStore((state) => state.currentUserId);
  const notificationSettings = useAppStore(
    (state) => state.notificationSettings,
  );
  const setNotificationSetting = useAppStore(
    (state) => state.setNotificationSetting,
  );
  const serverPrivacy = useAppStore((state) => state.serverPrivacy);
  const permissionOverrides = useAppStore((state) => state.permissionOverrides);
  const contextMenu = useContextMenu();
  /** A contagem é o tamanho da lista: uma fonte só, sem discordar de si. */
  const voiceCount = (channelId: string) =>
    (voiceMembers[channelId] ?? []).length;
  const { ask, confirmDialog } = useConfirm();
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [hideMutedChannels, setHideMutedChannels] = useState(
    () => localStorage.getItem("janja.hideMutedChannels") === "true",
  );
  const [channelSetup, setChannelSetup] = useState<{
    kind: NewChannelKind;
    parentId: string;
  } | null>(null);
  const [channelSettingsId, setChannelSettingsId] = useState("");
  const currentUser =
    profiles.find((profile) => profile.id === currentUserId) ?? profiles[0];
  const server = servers.find((item) => item.id === serverId);
  const serverRoles = roles.filter((role) => role.serverId === serverId);
  const serverMembers = members.filter(
    (member) => member.serverId === serverId,
  );
  const settingsChannel = channels.find(
    (channel) => channel.id === channelSettingsId,
  );
  const permissions = serverPermissionMask(
      server,
      currentUserId,
      roles,
      members,
    ),
    canManageChannels = hasPermission(permissions, Permissions.MANAGE_CHANNELS),
    canOpenAdministration = [
      Permissions.MANAGE_SERVER,
      Permissions.MANAGE_CHANNELS,
      Permissions.MANAGE_ROLES,
      Permissions.MANAGE_NICKNAMES,
      Permissions.MUTE_MEMBERS,
      Permissions.DEAFEN_MEMBERS,
      Permissions.MOVE_MEMBERS,
      Permissions.KICK_MEMBERS,
      Permissions.BAN_MEMBERS,
      Permissions.TIMEOUT_MEMBERS,
      Permissions.CREATE_INVITES,
      Permissions.VIEW_AUDIT_LOG,
    ].some((permission) => hasPermission(permissions, permission));
  const channelIsMuted = (channelId: string) => {
    const setting = notificationSettings.find(
      (item) =>
        item.userId === currentUserId &&
        item.scopeType === "CHANNEL" &&
        item.scopeId === channelId,
    );
    return Boolean(
      setting &&
      (setting.mode === "NONE" ||
        (setting.mutedUntil && new Date(setting.mutedUntil) > new Date())),
    );
  };
  // "Ocultar canais silenciados" nunca esconde o canal aberto — como no
  // Discord, o canal ativo continua visível para você saber onde está.
  const visibleChannel = (channel: Channel) =>
    !hideMutedChannels ||
    channel.id === activeChannelId ||
    !channelIsMuted(channel.id);
  const textChannels = channels
    .filter(
      (channel) =>
        channel.serverId === serverId &&
        channel.kind === "text" &&
        !channel.category,
    )
    .filter(visibleChannel)
    .sort((a, b) => a.position - b.position);
  const voiceChannels = channels
    .filter(
      (channel) =>
        channel.serverId === serverId &&
        channel.kind === "voice" &&
        !channel.category,
    )
    .filter(visibleChannel)
    .sort((a, b) => a.position - b.position);
  const refreshWorkspace = () => hydrateOnlineWorkspace(currentUserId);
  const serverNotification = notificationSettings.find(
    (item) =>
      item.userId === currentUserId &&
      item.scopeType === "SERVER" &&
      item.scopeId === serverId,
  );
  const serverMuted = Boolean(
    serverNotification?.mutedUntil &&
    new Date(serverNotification.mutedUntil) > new Date(),
  );
  const saveServerNotification = (
    changes: Partial<Omit<NotificationSetting, "id" | "userId">>,
  ) =>
    setNotificationSetting({
      scopeType: "SERVER",
      scopeId: serverId,
      mode: serverNotification?.mode ?? "ALL",
      suppressEveryone: serverNotification?.suppressEveryone ?? false,
      suppressRoles: serverNotification?.suppressRoles ?? false,
      mutedUntil: serverNotification?.mutedUntil,
      ...changes,
    });
  const openServerMenu = (event: ReactMouseEvent) =>
    contextMenu.open(event, [
      {
        id: "mute-server",
        label: serverMuted ? "Dessilenciar servidor" : "Silenciar servidor",
        ...(serverMuted
          ? {
              onSelect: () => saveServerNotification({ mutedUntil: undefined }),
            }
          : {
              submenu: [
                { label: "Por 15 minutos", minutes: 15 },
                { label: "Por 1 hora", minutes: 60 },
                { label: "Por 3 horas", minutes: 180 },
                { label: "Por 8 horas", minutes: 480 },
                { label: "Por 24 horas", minutes: 1440 },
                { label: "Até eu ligá-lo de novo", minutes: null },
              ].map((option) => ({
                id: `mute-server-${option.minutes ?? "forever"}`,
                label: option.label,
                onSelect: () =>
                  saveServerNotification({
                    mutedUntil: new Date(
                      Date.now() +
                        (option.minutes ?? 100 * 365 * 24 * 60) * 60_000,
                    ).toISOString(),
                  }),
              })),
            }),
      },
      {
        id: "notification-config",
        label: "Config. de notificação",
        hint:
          serverNotification?.mode === "MENTIONS"
            ? "Apenas @menções"
            : serverNotification?.mode === "NONE"
              ? "Nada"
              : "Todas as mensagens",
        submenu: [
          {
            id: "mode-all",
            label: "Todas as mensagens",
            checkStyle: "radio" as const,
            checked: (serverNotification?.mode ?? "ALL") === "ALL",
            onSelect: () => saveServerNotification({ mode: "ALL" }),
          },
          {
            id: "mode-mentions",
            label: "Apenas @menções",
            checkStyle: "radio" as const,
            checked: serverNotification?.mode === "MENTIONS",
            onSelect: () => saveServerNotification({ mode: "MENTIONS" }),
          },
          {
            id: "mode-none",
            label: "Nada",
            checkStyle: "radio" as const,
            checked: serverNotification?.mode === "NONE",
            onSelect: () => saveServerNotification({ mode: "NONE" }),
          },
          {
            id: "suppress-everyone",
            label: "Silenciar @everyone e @here",
            separatorBefore: true,
            checkStyle: "checkbox" as const,
            checked: Boolean(serverNotification?.suppressEveryone),
            onSelect: () =>
              saveServerNotification({
                suppressEveryone: !serverNotification?.suppressEveryone,
              }),
          },
          {
            id: "suppress-roles",
            label: "Silenciar todas as @menções de cargos",
            checkStyle: "checkbox" as const,
            checked: Boolean(serverNotification?.suppressRoles),
            onSelect: () =>
              saveServerNotification({
                suppressRoles: !serverNotification?.suppressRoles,
              }),
          },
        ],
      },
      {
        id: "hide-muted",
        label: "Ocultar canais silenciados",
        separatorBefore: true,
        checkStyle: "checkbox" as const,
        checked: hideMutedChannels,
        onSelect: () => {
          const next = !hideMutedChannels;
          setHideMutedChannels(next);
          localStorage.setItem("janja.hideMutedChannels", String(next));
        },
      },
      {
        id: "server-settings",
        label: "Config. do servidor",
        separatorBefore: true,
        disabled: !canOpenAdministration,
        onSelect: onSettings,
      },
      {
        id: "server-privacy",
        label: "Config. de privacidade",
        onSelect: () => setPrivacyOpen(true),
      },
      ...(canManageChannels
        ? [
            {
              id: "create-channel",
              label: "Criar canal",
              separatorBefore: true,
              onSelect: () => void addChannel("text"),
            },
            {
              id: "create-category",
              label: "Criar categoria",
              onSelect: () => void addChannel("category"),
            },
          ]
        : []),
      {
        id: "copy-server-id",
        label: "Copiar ID do servidor",
        separatorBefore: true,
        onSelect: () =>
          void navigator.clipboard.writeText(serverId).catch(() => {}),
      },
    ]);
  const categories = channels
    .filter(
      (channel) => channel.serverId === serverId && channel.kind === "category",
    )
    .sort((a, b) => a.position - b.position);
  /** Abre o modal de criação já no tipo e na categoria de onde veio o clique. */
  const addChannel = (kind: NewChannelKind, parentId?: string) =>
    setChannelSetup({ kind, parentId: parentId ?? "" });
  const openChannelMenu = (event: ReactMouseEvent, channel: Channel) => {
    const isCategory = channel.kind === "category";
    contextMenu.open(event, [
      ...(isCategory
        ? [
            {
              id: "create-text-here",
              label: "Criar canal de texto",
              onSelect: () => addChannel("text", channel.id),
            },
            {
              id: "create-voice-here",
              label: "Criar canal de voz",
              onSelect: () => addChannel("voice", channel.id),
            },
          ]
        : [
            {
              id: "open-channel",
              label: "Abrir canal",
              onSelect: () => onChannel(channel.id),
            },
          ]),
      {
        id: "edit-channel",
        label: isCategory ? "Editar categoria" : "Editar canal",
        separatorBefore: true,
        disabled: !canManageChannels,
        onSelect: () => setChannelSettingsId(channel.id),
      },
      {
        id: "channel-permissions",
        label: "Permissões do canal",
        disabled: !canManageChannels,
        onSelect: () => setChannelSettingsId(channel.id),
      },
      ...(isCategory
        ? []
        : [
            {
              id: "move-to-category",
              label: "Mover para categoria",
              disabled: !canManageChannels || categories.length === 0,
              submenu: [
                {
                  id: "move-to-none",
                  label: "Sem categoria",
                  checkStyle: "radio" as const,
                  checked: !channel.category,
                  onSelect: () =>
                    void moveOnlineChannelToCategory(channel.id, undefined)
                      .then(refreshWorkspace)
                      .catch((caught) =>
                        reportRuntimeError("Falha ao mover o canal", caught),
                      ),
                },
                ...categories.map((category) => ({
                  id: `move-to-${category.id}`,
                  label: category.name,
                  checkStyle: "radio" as const,
                  checked: channel.category === category.id,
                  onSelect: () =>
                    void moveOnlineChannelToCategory(channel.id, category.id)
                      .then(refreshWorkspace)
                      .catch((caught) =>
                        reportRuntimeError("Falha ao mover o canal", caught),
                      ),
                })),
              ],
            },
            {
              id: "duplicate-channel",
              label: "Duplicar canal",
              disabled: !canManageChannels,
              onSelect: () =>
                void duplicateOnlineChannel(channel.id)
                  .then(refreshWorkspace)
                  .catch((caught) =>
                    reportRuntimeError("Falha ao duplicar o canal", caught),
                  ),
            },
          ]),
      {
        id: "copy-channel-id",
        label: "Copiar ID do canal",
        separatorBefore: true,
        onSelect: () =>
          void navigator.clipboard.writeText(channel.id).catch(() => {}),
      },
      {
        id: "delete-channel",
        label: isCategory ? "Excluir categoria" : "Excluir canal",
        danger: true,
        disabled: !canManageChannels,
        onSelect: () =>
          ask({
            title: isCategory ? "Excluir categoria" : "Excluir canal",
            message: `“${channel.name}” e todas as mensagens dele são apagadas. Não dá para desfazer.`,
            confirmLabel: isCategory ? "Excluir categoria" : "Excluir canal",
            danger: true,
            onConfirm: () => {
              void deleteOnlineChannel(channel.id)
                .then(refreshWorkspace)
                .catch((caught) =>
                  reportRuntimeError("Falha ao excluir o canal", caught),
                );
            },
          }),
      },
    ]);
  };
  const toggleCategory = (categoryId: string) => {
    setCollapsedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      localStorage.setItem(
        "janja-collapsed-categories",
        JSON.stringify([...next]),
      );
      return next;
    });
  };
  return (
    <aside className="channel-sidebar">
      <div
        className="server-heading"
        onContextMenu={(event) => openServerMenu(event)}
      >
        <div className="server-heading-identity">
          {server && <ServerIcon server={server} size={34} />}
          <div>
            <strong>{server?.name ?? "Servidor"}</strong>
            {server?.description ? (
              <span className="server-heading-description">
                {server.description}
              </span>
            ) : (
              <span className="eyebrow">SERVIDOR LOCAL E2EE</span>
            )}
          </div>
        </div>
        <button
          className="icon-button"
          aria-label="Opções do servidor"
          title="Opções do servidor"
          onClick={(event) => openServerMenu(event)}
        >
          <IconChevronDown size={18} />
        </button>
      </div>
      <div className="channel-scroll">
        {canManageChannels && (
          <div className="channel-group category-index">
            <div className="group-title">
              <span>CATEGORIAS</span>
              <button
                className="group-add"
                aria-label="Criar categoria"
                title="Criar categoria"
                onClick={() => addChannel("category")}
              >
                <IconPlus size={16} />
              </button>
            </div>
          </div>
        )}
        {categories.map((category) => {
          const children = channels
            .filter((channel) => channel.category === category.id)
            .filter(visibleChannel)
            .sort((a, b) => a.position - b.position);
          const collapsed = collapsedCategories.has(category.id);
          return (
            <div className="channel-group" key={category.id}>
              <div
                className="group-title"
                onContextMenu={(event) => openChannelMenu(event, category)}
              >
                <button
                  className="category-collapse"
                  aria-expanded={!collapsed}
                  aria-label={`${collapsed ? "Expandir" : "Recolher"} categoria ${category.name}`}
                  onClick={() => toggleCategory(category.id)}
                >
                  {collapsed ? "▸" : "▾"} {category.name.toUpperCase()}
                </button>
                {canManageChannels && (
                  <span className="category-actions">
                    <button
                      className="group-add"
                      aria-label={`Criar canal de texto em ${category.name}`}
                      title="Criar canal de texto"
                      onClick={() => addChannel("text", category.id)}
                    >
                      <IconHash size={15} />
                      <IconPlus size={11} />
                    </button>
                    <button
                      className="group-add"
                      aria-label={`Criar canal de voz em ${category.name}`}
                      title="Criar canal de voz"
                      onClick={() => addChannel("voice", category.id)}
                    >
                      <IconVolume size={15} />
                      <IconPlus size={11} />
                    </button>
                  </span>
                )}
              </div>
              {!collapsed &&
                children.map((channel) => (
                  <button
                    key={channel.id}
                    onClick={() => onChannel(channel.id)}
                    onContextMenu={(event) => openChannelMenu(event, channel)}
                    className={`channel-row ${activeChannelId === channel.id ? "active" : ""}`}
                  >
                    {channel.kind === "voice" ? (
                      <IconVolume size={18} />
                    ) : (
                      <IconHash size={18} />
                    )}
                    <span>{channel.name}</span>
                    {channel.kind === "voice" && (
                      <em
                        className="people-count"
                        aria-label={`${voiceCount(channel.id)} participantes`}
                      >
                        {voiceCount(channel.id)}
                      </em>
                    )}
                  </button>
                ))}
            </div>
          );
        })}
        <div className="channel-group">
          <div className="group-title">
            <span>CANAIS DE TEXTO</span>
            {canManageChannels && (
              <button
                className="group-add"
                aria-label="Criar canal de texto"
                title="Criar canal de texto"
                onClick={() => addChannel("text")}
              >
                <IconPlus size={16} />
              </button>
            )}
          </div>
          {textChannels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => onChannel(channel.id)}
              onContextMenu={(event) => openChannelMenu(event, channel)}
              className={`channel-row ${activeChannelId === channel.id ? "active" : ""}`}
            >
              <IconHash size={18} />
              <span>{channel.name}</span>
            </button>
          ))}
        </div>
        <div className="channel-group">
          <div className="group-title">
            <span>CANAIS DE VOZ</span>
            {canManageChannels && (
              <button
                className="group-add"
                aria-label="Criar canal de voz"
                title="Criar canal de voz"
                onClick={() => addChannel("voice")}
              >
                <IconPlus size={16} />
              </button>
            )}
          </div>
          {voiceChannels.map((channel) => (
            <Fragment key={channel.id}>
              <button
                onClick={() => onChannel(channel.id)}
                onContextMenu={(event) => openChannelMenu(event, channel)}
                className={`channel-row ${activeChannelId === channel.id ? "active voice-active" : ""}`}
              >
                <IconVolume size={18} />
                <span>{channel.name}</span>
                <em
                  className="people-count"
                  aria-label={`${voiceCount(channel.id)} participantes`}
                >
                  {voiceCount(channel.id)}
                </em>
              </button>
              <VoiceChannelMembers
                members={voiceMembers[channel.id] ?? []}
                profiles={profiles}
              />
            </Fragment>
          ))}
        </div>
        {canOpenAdministration && (
          <button className="admin-link" onClick={onSettings}>
            <IconSettings size={18} />
            <span>Administração</span>
          </button>
        )}
      </div>
      <button className="user-panel" onClick={onProfile}>
        <Avatar person={currentUser} size="sm" />
        <div className="user-copy">
          <b>{currentUser.displayName}</b>
          <span>{currentUser.status}</span>
        </div>
        <IconSettings size={18} />
      </button>
      {contextMenu.menu && (
        <ContextMenu state={contextMenu.menu} onClose={contextMenu.close} />
      )}
      {confirmDialog}
      {channelSetup && (
        <ChannelSetupModal
          serverId={serverId}
          categories={categories}
          defaultKind={channelSetup.kind}
          defaultCategoryId={channelSetup.parentId}
          onClose={() => setChannelSetup(null)}
          onCreated={(channelId, kind) => {
            setChannelSetup(null);
            void refreshWorkspace().then(() => {
              if (kind !== "category") onChannel(channelId);
            });
          }}
        />
      )}
      {settingsChannel && (
        <ChannelSettingsModal
          channel={settingsChannel}
          category={channels.find(
            (item) => item.id === settingsChannel.category,
          )}
          roles={[...serverRoles].sort((a, b) => b.position - a.position)}
          members={serverMembers}
          profiles={profiles}
          overrides={permissionOverrides}
          onClose={() => setChannelSettingsId("")}
          actions={{
            save: async (changes) => {
              await updateOnlineChannel({ ...settingsChannel, ...changes });
              await refreshWorkspace();
            },
            setOverride: async (targetType, targetId, allow, deny) => {
              await setOnlineChannelOverride(
                settingsChannel.id,
                targetType,
                targetId,
                allow,
                deny,
              );
              await refreshWorkspace();
            },
            syncWithCategory: async () => {
              await syncOnlineChannelWithCategory(settingsChannel.id);
              await refreshWorkspace();
            },
            remove: async () => {
              await deleteOnlineChannel(settingsChannel.id);
              setChannelSettingsId("");
              await refreshWorkspace();
            },
          }}
        />
      )}
      {privacyOpen && (
        <ServerPrivacyModal
          serverName={server?.name ?? "Servidor"}
          privacy={
            serverPrivacy.find((item) => item.serverId === serverId) ?? {
              allowDirectMessages: true,
              filterMessageRequests: true,
              shareActivity: false,
              allowActivityJoin: true,
            }
          }
          onChange={(changes) =>
            void saveServerPrivacy(currentUserId, serverId, changes).then(
              refreshWorkspace,
            )
          }
          onClose={() => setPrivacyOpen(false)}
        />
      )}
    </aside>
  );
}

function MemberSidebar({
  serverId,
  onChannel,
}: {
  serverId: string;
  onChannel: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const profiles = useAppStore((state) => state.profiles);
  const roles = useAppStore((state) => state.roles);
  const members = useAppStore((state) => state.members);
  const currentUserId = useAppStore((state) => state.currentUserId);
  const openDirectMessage = async (personId: string) => {
    const channelId = await createOnlineDirectChannel([personId]);
    await hydrateOnlineWorkspace(currentUserId);
    onChannel(channelId);
  };
  const people: Person[] = members
    .filter((member) => member.serverId === serverId)
    .map((member) => {
      const profile = profiles.find((item) => item.id === member.userId)!;
      const highestRole = roles
        .filter((role) => member.roleIds.includes(role.id))
        .sort((a, b) => b.position - a.position)[0];
      return { ...profile, role: highestRole?.name ?? "@everyone" };
    })
    .filter(Boolean)
    .filter((person) =>
      `${person.displayName} ${person.username}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const online = people.filter((person) => person.status !== "offline");
  const offline = people.filter((person) => person.status === "offline");
  return (
    <aside className="member-sidebar">
      <div className="member-heading">
        <span>MEMBROS — {people.length}</span>
        <button
          className="icon-button"
          aria-label="Pesquisar membros"
          title="Pesquisar membros"
          onClick={() => {
            const value = window.prompt("Pesquisar membros", query);
            if (value !== null) setQuery(value.trim());
          }}
        >
          <IconSearch size={18} />
        </button>
      </div>
      <MemberGroup
        title={`ONLINE — ${online.length}`}
        people={online}
        onPerson={(personId) => {
          if (personId === currentUserId) return;
          void openDirectMessage(personId);
        }}
      />
      <MemberGroup
        title={`OFFLINE — ${offline.length}`}
        people={offline}
        offline
        onPerson={(personId) => {
          if (personId !== currentUserId) void openDirectMessage(personId);
        }}
      />
    </aside>
  );
}

function MemberGroup({
  title,
  people,
  offline = false,
  onPerson,
}: {
  title: string;
  people: Person[];
  offline?: boolean;
  onPerson: (personId: string) => void;
}) {
  return (
    <div className="member-group">
      <span className="member-group-title">{title}</span>
      {people.map((person) => (
        <button
          className={`member-row ${offline ? "offline" : ""}`}
          key={person.id}
          onClick={() => onPerson(person.id)}
        >
          <Avatar person={person} size="sm" online={!offline} />
          <span>
            <b>{person.displayName}</b>
            <small>{person.role}</small>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Igual ao `max-height` de `.composer textarea`. */
const COMPOSER_MAX_HEIGHT = 120;

function Composer({
  channelId,
  channelName,
  onSend,
  onTyping,
  disabled,
}: {
  channelId: string;
  channelName: string;
  onSend: (text: string, files: File[]) => void;
  onTyping: () => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(""),
    [files, setFiles] = useState<File[]>([]),
    [nextAllowedAt, setNextAllowedAt] = useState(0),
    [, setClock] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Insere o emoji onde o cursor está, não no fim do texto. */
  const insertEmoji = (char: string) => {
    const node = composerRef.current;
    setValue((current) => {
      if (!node) return `${current}${char}`;
      const start = node.selectionStart ?? current.length;
      const end = node.selectionEnd ?? start;
      const next = `${current.slice(0, start)}${char}${current.slice(end)}`;
      window.requestAnimationFrame(() => {
        node.focus();
        const caret = start + char.length;
        node.setSelectionRange(caret, caret);
      });
      return next;
    });
    onTyping();
  };
  useEffect(() => {
    const node = composerRef.current;
    if (!node) return;
    const fit = () => {
      // Uma <textarea> não encolhe sozinha: sem zerar a altura antes de medir,
      // `scrollHeight` devolve sempre o tamanho anterior e a caixa nunca volta
      // a uma linha depois de enviar a mensagem.
      node.style.height = "auto";
      node.style.height = `${Math.min(node.scrollHeight, COMPOSER_MAX_HEIGHT)}px`;
    };
    fit();
    // Medir uma vez só era frágil: se o primeiro cálculo cair antes de a fonte
    // carregar ou de o layout assentar, a altura errada congela até alguém
    // digitar. Aconteceu ao trocar entre o layout estreito e o largo.
    window.addEventListener("resize", fit);
    void document.fonts?.ready.then(fit).catch(() => undefined);
    return () => window.removeEventListener("resize", fit);
  }, [value]);
  const channels = useAppStore((state) => state.channels),
    servers = useAppStore((state) => state.servers),
    roles = useAppStore((state) => state.roles),
    members = useAppStore((state) => state.members),
    channelMembers = useAppStore((state) => state.channelMembers),
    blocks = useAppStore((state) => state.blocks),
    overrides = useAppStore((state) => state.permissionOverrides),
    currentUserId = useAppStore((state) => state.currentUserId);
  const channel = channels.find((item) => item.id === channelId),
    server = servers.find((item) => item.id === channel?.serverId),
    member = members.find(
      (item) =>
        item.serverId === channel?.serverId && item.userId === currentUserId,
    ),
    everyone = roles.find(
      (item) => item.serverId === channel?.serverId && item.isDefault,
    ),
    memberRoles = roles.filter(
      (role) =>
        role.serverId === channel?.serverId &&
        member?.roleIds.includes(role.id),
    );
  const effectivePermissions =
    server && everyone
      ? resolvePermissions({
          userId: currentUserId,
          ownerId: server.ownerId,
          everyoneRole: {
            ...everyone,
            permissions: BigInt(everyone.permissions),
          },
          memberRoles: memberRoles.map((role) => ({
            ...role,
            permissions: BigInt(role.permissions),
          })),
          overwrites: overrides
            .filter((item) => item.channelId === channel?.id)
            .map((item) => ({
              ...item,
              allow: BigInt(item.allow),
              deny: BigInt(item.deny),
            })),
        })
      : 0n;
  const direct = channel?.serverId === "direct",
    directBlocked = Boolean(
      direct &&
      channelMembers
        .filter((channelMember) => channelMember.channelId === channel?.id)
        .some(
          (channelMember) =>
            channelMember.userId !== currentUserId &&
            blocks.some(
              (block) =>
                [block.blockerId, block.blockedId].includes(currentUserId) &&
                [block.blockerId, block.blockedId].includes(
                  channelMember.userId,
                ),
            ),
        ),
    ),
    timedOut = Boolean(
      member?.communicationDisabledUntil &&
      new Date(member.communicationDisabledUntil).getTime() > Date.now(),
    ),
    canSend = direct
      ? !directBlocked
      : hasPermission(
          effectivePermissions,
          Permissions.VIEW_CHANNEL | Permissions.SEND_MESSAGES,
        ),
    canAttach =
      direct || hasPermission(effectivePermissions, Permissions.ATTACH_FILES),
    bypassSlowmode =
      direct ||
      hasPermission(effectivePermissions, Permissions.BYPASS_SLOWMODE);
  const remaining = bypassSlowmode
      ? 0
      : Math.max(0, Math.ceil((nextAllowedAt - Date.now()) / 1_000)),
    blocked = Boolean(disabled || !canSend || timedOut || remaining > 0);
  useEffect(() => {
    if (nextAllowedAt <= Date.now()) return;
    const timer = window.setInterval(() => setClock((value) => value + 1), 500);
    return () => window.clearInterval(timer);
  }, [nextAllowedAt]);
  const submit = () => {
    if (!blocked && (value.trim() || files.length)) {
      onSend(value.trim(), files);
      if (channel?.slowmodeSeconds && !bypassSlowmode)
        setNextAllowedAt(Date.now() + channel.slowmodeSeconds * 1_000);
      setValue("");
      setFiles([]);
    }
  };
  const disabledReason = timedOut
    ? "Você está em timeout neste servidor."
    : directBlocked
      ? "Esta conversa foi bloqueada."
      : !canSend
        ? "Sem permissão para enviar neste canal."
        : remaining > 0
          ? `Slowmode: aguarde ${remaining}s.`
          : "";
  return (
    <div className="composer-wrap">
      {files.length > 0 && (
        <div className="attachment-drafts">
          {files.map((file, index) => (
            <span key={`${file.name}-${index}`}>
              🔒 {file.name}
              <button
                onClick={() =>
                  setFiles((current) =>
                    current.filter((_, fileIndex) => fileIndex !== index),
                  )
                }
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {pickerOpen && (
        <ComposerPicker
          onEmoji={insertEmoji}
          onFile={async (file) => {
            onSend("", [file]);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      <div className="composer">
        <button
          disabled={!canAttach || timedOut}
          aria-label="Anexar arquivo cifrado"
          onClick={() => fileInputRef.current?.click()}
        >
          <IconPlus size={20} />
        </button>
        <input
          ref={fileInputRef}
          className="file-input"
          type="file"
          multiple
          onChange={(event) =>
            setFiles(Array.from(event.target.files ?? []).slice(0, 10))
          }
        />
        <textarea
          ref={composerRef}
          rows={1}
          disabled={blocked}
          maxLength={8000}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            onTyping();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={disabledReason || `Mensagem em ${channelName}`}
        />
        <div className="composer-actions">
          <button
            disabled={blocked}
            aria-label="GIFs e emoji"
            title="GIFs e emoji"
            aria-expanded={pickerOpen}
            className={pickerOpen ? "active" : ""}
            onClick={() => setPickerOpen((open) => !open)}
          >
            <IconSmile size={20} />
          </button>
          <button
            disabled={blocked}
            onClick={submit}
            className="send-button"
            aria-label="Enviar"
            title="Enviar"
          >
            <IconSend size={18} />
          </button>
        </div>
      </div>
      <span
        className={`composer-note ${disabledReason ? "composer-blocked" : ""}`}
      >
        <Icon>{disabledReason ? "!" : "🔒"}</Icon>{" "}
        {disabledReason ||
          `Texto, metadados e anexos persistidos como ciphertext AES-GCM · ${value.length}/8.000`}
      </span>
    </div>
  );
}

const inlineMarkdownPattern =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<]+)/g;

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  return text.split(inlineMarkdownPattern).map((piece, index) => {
    const key = `${keyPrefix}-${index}`;
    if (piece.startsWith("`") && piece.endsWith("`"))
      return <code key={key}>{piece.slice(1, -1)}</code>;
    if (piece.startsWith("**") && piece.endsWith("**"))
      return <strong key={key}>{piece.slice(2, -2)}</strong>;
    if (piece.startsWith("~~") && piece.endsWith("~~"))
      return <del key={key}>{piece.slice(2, -2)}</del>;
    if (piece.startsWith("*") && piece.endsWith("*"))
      return <em key={key}>{piece.slice(1, -1)}</em>;
    const markdownLink = piece.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
    if (markdownLink)
      return (
        <a key={key} href={markdownLink[2]} target="_blank" rel="noreferrer">
          {markdownLink[1]}
        </a>
      );
    if (/^https?:\/\//.test(piece))
      return (
        <a key={key} href={piece} target="_blank" rel="noreferrer">
          {piece}
        </a>
      );
    return piece;
  });
}

function MarkdownTextBlocks({
  text,
  blockKey,
}: {
  text: string;
  blockKey: string;
}) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInlineMarkdown(
        heading[2],
        `${blockKey}-heading-${index}`,
      );
      const Heading = `h${level}` as keyof React.JSX.IntrinsicElements;
      nodes.push(<Heading key={`${blockKey}-${index}`}>{content}</Heading>);
      index += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      nodes.push(
        <blockquote key={`${blockKey}-quote-${index}`}>
          {quoteLines.map((quote, quoteIndex) => (
            <Fragment key={quoteIndex}>
              {renderInlineMarkdown(
                quote,
                `${blockKey}-quote-${index}-${quoteIndex}`,
              )}
              {quoteIndex < quoteLines.length - 1 && <br />}
            </Fragment>
          ))}
        </blockquote>,
      );
      continue;
    }
    const unordered = /^[-*+]\s+/.test(line);
    const ordered = /^\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const items: string[] = [];
      const pattern = unordered ? /^[-*+]\s+/ : /^\d+[.)]\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      nodes.push(
        <List key={`${blockKey}-list-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {renderInlineMarkdown(
                item,
                `${blockKey}-list-${index}-${itemIndex}`,
              )}
            </li>
          ))}
        </List>,
      );
      continue;
    }
    const paragraphs: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index]) &&
      !/^[-*+]\s+/.test(lines[index]) &&
      !/^\d+[.)]\s+/.test(lines[index])
    ) {
      paragraphs.push(lines[index]);
      index += 1;
    }
    nodes.push(
      <p key={`${blockKey}-paragraph-${index}`}>
        {paragraphs.map((paragraph, paragraphIndex) => (
          <Fragment key={paragraphIndex}>
            {renderInlineMarkdown(
              paragraph,
              `${blockKey}-paragraph-${index}-${paragraphIndex}`,
            )}
            {paragraphIndex < paragraphs.length - 1 && <br />}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <>{nodes}</>;
}

function MessageText({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!part) return null;
        if (!part.startsWith("```"))
          return (
            <MarkdownTextBlocks
              key={index}
              text={part}
              blockKey={`markdown-${index}`}
            />
          );
        const fenced = part.slice(3, -3).replace(/^\n/, "");
        const firstNewline = fenced.indexOf("\n");
        const possibleLanguage =
          firstNewline >= 0 ? fenced.slice(0, firstNewline).trim() : "";
        const hasLanguage = /^[a-z0-9_+#.-]{1,24}$/i.test(possibleLanguage);
        const code = (
          hasLanguage ? fenced.slice(firstNewline + 1) : fenced
        ).trimEnd();
        return (
          <pre key={index}>
            <code data-language={hasLanguage ? possibleLanguage : undefined}>
              {code}
            </code>
          </pre>
        );
      })}
    </>
  );
}

function ChatView({
  channel,
  onCall,
  callInProgress = false,
  onSearch,
  onToggleMembers,
  membersVisible,
}: {
  channel: Channel;
  onCall?: (withVideo: boolean) => void;
  /** Já existe alguém na chamada deste canal. */
  callInProgress?: boolean;
  onSearch: () => void;
  onToggleMembers: () => void;
  membersVisible: boolean;
}) {
  const profiles = useAppStore((state) => state.profiles);
  const currentUserId = useAppStore((state) => state.currentUserId);
  const markChannelRead = useAppStore((state) => state.markChannelRead);
  const notificationSettings = useAppStore(
    (state) => state.notificationSettings,
  );
  const readStates = useAppStore((state) => state.readStates);
  const setNotificationSetting = useAppStore(
    (state) => state.setNotificationSetting,
  );
  const [replyToId, setReplyToId] = useState<string | undefined>(),
    [pinsOpen, setPinsOpen] = useState(false),
    [groupSettingsOpen, setGroupSettingsOpen] = useState(false),
    [sendError, setSendError] = useState(""),
    [unreadBoundary, setUnreadBoundary] = useState(() => ({
      channelId: channel.id,
      lastReadAt:
        readStates.find(
          (item) =>
            item.channelId === channel.id && item.userId === currentUserId,
        )?.lastReadAt ?? new Date(0).toISOString(),
    }));
  const {
    data: messages = [],
    isLoading,
    isError: messagesFailed,
    error: messageError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    send,
    edit,
    remove,
    pin,
    react,
  } = useMessages(channel.id);
  const { typingUsers, announceTyping } = useTyping(channel.id, currentUserId);
  const latestMessageId = messages.at(-1)?.id;
  const personFor = (id: string) =>
    profiles.find((profile) => profile.id === id) ?? unknownPerson(id);
  const channelMembers = useAppStore((state) => state.channelMembers);
  const blocks = useAppStore((state) => state.blocks);
  const dmBlocked =
    channel.kind === "dm" &&
    channelMembers
      .filter((member) => member.channelId === channel.id)
      .some(
        (member) =>
          member.userId !== currentUserId &&
          blocks.some(
            (block) =>
              [block.blockerId, block.blockedId].includes(currentUserId) &&
              [block.blockerId, block.blockedId].includes(member.userId),
          ),
      );
  useEffect(() => {
    setUnreadBoundary({
      channelId: channel.id,
      lastReadAt:
        readStates.find(
          (item) =>
            item.channelId === channel.id && item.userId === currentUserId,
        )?.lastReadAt ?? new Date(0).toISOString(),
    });
    // A fronteira deve ser capturada somente ao entrar no canal. Atualizações
    // posteriores do read_state não podem apagar o separador desta visita.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, currentUserId]);
  useEffect(() => {
    const persistVisibleRead = () => {
      if (!latestMessageId || document.visibilityState !== "visible") return;
      markChannelRead(channel.id, latestMessageId);
      void markOnlineChannelRead(channel.id, latestMessageId).catch((caught) =>
        reportRuntimeError("Falha ao persistir estado de leitura", caught),
      );
    };
    persistVisibleRead();
    document.addEventListener("visibilitychange", persistVisibleRead);
    return () =>
      document.removeEventListener("visibilitychange", persistVisibleRead);
  }, [channel.id, latestMessageId, markChannelRead]);
  const firstUnreadMessageId =
    unreadBoundary.channelId === channel.id
      ? messages.find(
          (message) =>
            message.authorId !== currentUserId &&
            message.createdAt > unreadBoundary.lastReadAt,
        )?.id
      : undefined;
  const [resendRequests, setResendRequests] = useState<
    AttachmentResendRequest[]
  >([]);
  const refreshResendRequests = useCallback(() => {
    void listOnlineAttachmentResendRequests(channel.id)
      .then(setResendRequests)
      .catch(() => setResendRequests([]));
  }, [channel.id]);
  useEffect(() => {
    refreshResendRequests();
    return subscribeOnlineAttachmentResendRequests(
      channel.id,
      refreshResendRequests,
    );
  }, [channel.id, refreshResendRequests]);
  useEffect(() => {
    // Não há agendador nesta instância: quem está com o app aberto limpa o
    // que passou das 24 h. Falhar aqui não pode atrapalhar a conversa.
    const sweep = () => void expireOnlineAttachments().catch(() => undefined);
    sweep();
    const timer = window.setInterval(sweep, 10 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);
  const resendStateFor = (messageId: string, attachmentId: string) => {
    const request = resendRequests.find(
      (item) =>
        item.messageId === messageId && item.attachmentId === attachmentId,
    );
    if (!request) return undefined;
    return {
      requestId: request.id,
      requesterName: profiles.find((item) => item.id === request.requesterId)
        ?.displayName,
      mine: request.requesterId === currentUserId,
    };
  };
  const openAttachment = (
    attachment: (typeof messages)[number]["attachments"][number],
  ) => downloadOnlineAttachment(currentUserId, attachment);
  const requestResend = async (
    messageId: string,
    attachment: (typeof messages)[number]["attachments"][number],
  ) => {
    try {
      await requestOnlineAttachmentResend(
        messageId,
        attachment.id,
        attachment.name,
      );
      refreshResendRequests();
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Não foi possível pedir o reenvio.",
      );
    }
  };
  const resolveResend = async (requestId: string) => {
    try {
      await resolveOnlineAttachmentResend(requestId);
      refreshResendRequests();
    } catch (error) {
      setSendError(
        error instanceof Error
          ? error.message
          : "Não foi possível encerrar o pedido.",
      );
    }
  };
  const download = async (
    attachment: (typeof messages)[number]["attachments"][number],
  ) => {
    try {
      const blob = await downloadOnlineAttachment(currentUserId, attachment);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachment.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      setSendError(
        error instanceof Error ? error.message : "Falha ao abrir anexo.",
      );
    }
  };
  const pinnedMessages = messages.filter((message) => message.pinned);
  const channelNotification = notificationSettings.find(
      (item) =>
        item.userId === currentUserId &&
        item.scopeType === "CHANNEL" &&
        item.scopeId === channel.id,
    ),
    notificationMode = channelNotification?.mode ?? "ALL";
  const cycleNotifications = () => {
    const mode =
      notificationMode === "ALL"
        ? "MENTIONS"
        : notificationMode === "MENTIONS"
          ? "NONE"
          : "ALL";
    setNotificationSetting({
      scopeType: "CHANNEL",
      scopeId: channel.id,
      mode,
      suppressEveryone: channelNotification?.suppressEveryone ?? false,
      suppressRoles: channelNotification?.suppressRoles ?? false,
    });
    if (
      mode === "ALL" &&
      !window.janjaDesktop &&
      "Notification" in window &&
      Notification.permission === "default"
    )
      void Notification.requestPermission();
  };
  const chooseReaction = (messageId: string) => {
    const emoji = window
      .prompt(
        "Digite um emoji Unicode ou código de expressão (até 128 caracteres)",
        "👍",
      )
      ?.trim();
    if (!emoji) return;
    if (emoji.length > 128) {
      setSendError("A reação deve ter no máximo 128 caracteres.");
      return;
    }
    react.mutate(
      { messageId, emoji, userId: currentUserId },
      { onError: (error) => setSendError(error.message) },
    );
  };
  return (
    <main className="conversation">
      <div className="conversation-header">
        <div className="conversation-title">
          {channel.kind === "gdm" && channel.iconUrl ? (
            <img
              className="conversation-channel-icon"
              src={channel.iconUrl}
              alt=""
            />
          ) : (
            <span className="channel-symbol">
              {channel.kind === "dm" ? "@" : channel.kind === "gdm" ? "♟" : "#"}
            </span>
          )}
          <div>
            <h1>{channel.name}</h1>
            <span>{messages.length} mensagens E2EE sincronizadas</span>
          </div>
        </div>
        <div className="conversation-tools">
          {onCall && (
            <>
              <button
                className={callInProgress ? "call-live" : ""}
                title={
                  callInProgress
                    ? "Entrar na chamada em andamento"
                    : "Iniciar chamada de voz"
                }
                aria-label={
                  callInProgress
                    ? "Entrar na chamada em andamento"
                    : "Iniciar chamada de voz"
                }
                onClick={() => onCall(false)}
              >
                <IconPhone size={20} />
              </button>
              <button
                className={callInProgress ? "call-live" : ""}
                title={
                  callInProgress
                    ? "Entrar na chamada com vídeo"
                    : "Iniciar chamada de vídeo"
                }
                aria-label={
                  callInProgress
                    ? "Entrar na chamada com vídeo"
                    : "Iniciar chamada de vídeo"
                }
                onClick={() => onCall(true)}
              >
                <IconVideo size={20} />
              </button>
            </>
          )}
          {channel.kind === "gdm" && (
            <button
              title="Configurar grupo"
              aria-label="Configurar grupo"
              onClick={() => setGroupSettingsOpen(true)}
            >
              <IconSettings size={20} />
            </button>
          )}
          <button
            title={`Notificações: ${notificationMode.toLowerCase()}`}
            aria-label={`Notificações do canal: ${notificationMode}`}
            className={notificationMode !== "ALL" ? "active" : ""}
            onClick={cycleNotifications}
          >
            {notificationMode === "NONE" ? (
              <IconBellOff size={20} />
            ) : (
              <IconBell size={20} />
            )}
          </button>
          <button
            title="Mensagens fixadas"
            aria-label="Mensagens fixadas"
            className={pinsOpen ? "active" : ""}
            onClick={() => setPinsOpen(!pinsOpen)}
          >
            <IconPin size={20} />
          </button>
          <button
            title="Membros"
            aria-label="Alternar lista de membros"
            aria-pressed={membersVisible}
            className={membersVisible ? "active" : ""}
            onClick={onToggleMembers}
          >
            <IconUsers size={20} />
          </button>
          <button title="Pesquisar" aria-label="Pesquisar" onClick={onSearch}>
            <IconSearch size={20} />
          </button>
        </div>
      </div>
      {pinsOpen && (
        <aside className="pins-panel">
          <div>
            <b>Mensagens fixadas</b>
            <button
              aria-label="Fechar fixadas"
              onClick={() => setPinsOpen(false)}
            >
              <IconX size={18} />
            </button>
          </div>
          {pinnedMessages.map((message) => (
            <button
              key={message.id}
              onClick={() =>
                document
                  .getElementById(`message-${message.id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            >
              <b>{personFor(message.authorId).displayName}</b>
              <span>
                {message.text || `${message.attachments.length} anexo(s)`}
              </span>
            </button>
          ))}
          {pinnedMessages.length === 0 && <p>Nenhuma mensagem fixada.</p>}
        </aside>
      )}
      <div className="message-list">
        <div className="welcome-message">
          <div className="welcome-icon">
            {channel.kind === "dm" ? "@" : "#"}
          </div>
          <h2>
            {channel.kind === "dm"
              ? `Conversa com ${channel.name}`
              : `Bem-vindo ao #${channel.name}!`}
          </h2>
          <p>
            As mensagens são cifradas neste dispositivo e sincronizadas pelo
            Supabase local.
          </p>
        </div>
        {isLoading && <p className="loading-copy">Decifrando mensagens…</p>}
        {messagesFailed && (
          <p className="composer-error" role="alert">
            Não foi possível sincronizar as mensagens
            {messageError?.message ? `: ${messageError.message}` : "."} Tentando
            novamente…
          </p>
        )}
        {hasNextPage && (
          <button
            className="load-older"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {isFetchingNextPage
              ? "Decifrando histórico…"
              : "Carregar mensagens anteriores"}
          </button>
        )}
        {messages.map((message) => {
          const author = personFor(message.authorId),
            reply = message.replyToId
              ? messages.find((item) => item.id === message.replyToId)
              : undefined;
          return (
            <Fragment key={message.id}>
              {message.id === firstUnreadMessageId && (
                <div className="unread-divider" role="separator">
                  <span>Novas mensagens</span>
                </div>
              )}
              <article className="message" id={`message-${message.id}`}>
                {reply && (
                  <button
                    className="reply-reference"
                    onClick={() =>
                      document
                        .getElementById(`message-${reply.id}`)
                        ?.scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        })
                    }
                  >
                    ↳ {personFor(reply.authorId).displayName}:{" "}
                    {reply.text.slice(0, 70)}
                  </button>
                )}
                <Avatar person={author} size="lg" />
                <div className="message-body">
                  <div className="message-meta">
                    <b>{author.displayName}</b>
                    <span>
                      {new Date(message.createdAt).toLocaleString("pt-BR")}
                      {message.editedAt ? " · editada" : ""}
                      {message.pinned ? " · fixada" : ""}
                    </span>
                  </div>
                  {message.text && (
                    <div className="message-markdown">
                      <MessageText text={message.text} />
                    </div>
                  )}
                  {message.attachments.length > 0 && (
                    <div className="message-attachments">
                      {message.attachments.map((attachment) => (
                        <MessageAttachment
                          key={attachment.id}
                          attachment={attachment}
                          createdAt={message.createdAt}
                          isAuthor={message.authorId === currentUserId}
                          resend={resendStateFor(message.id, attachment.id)}
                          onOpen={openAttachment}
                          onDownload={(item) => void download(item)}
                          onRequestResend={(item) =>
                            void requestResend(message.id, item)
                          }
                          onResolveResend={(requestId) =>
                            void resolveResend(requestId)
                          }
                        />
                      ))}
                    </div>
                  )}
                  {Object.entries(message.reactions).some(
                    ([, users]) => users.length > 0,
                  ) && (
                    <div className="message-reactions">
                      {Object.entries(message.reactions)
                        .filter(([, users]) => users.length > 0)
                        .map(([emoji, users]) => (
                          <button
                            className={
                              users.includes(currentUserId) ? "mine" : ""
                            }
                            key={emoji}
                            onClick={() =>
                              react.mutate(
                                {
                                  messageId: message.id,
                                  emoji,
                                  userId: currentUserId,
                                },
                                {
                                  onError: (error) =>
                                    setSendError(error.message),
                                },
                              )
                            }
                          >
                            {emoji} {users.length}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
                <div className="message-actions">
                  <button
                    title="Responder"
                    aria-label="Responder"
                    onClick={() => setReplyToId(message.id)}
                  >
                    <IconReply size={18} />
                  </button>
                  <button
                    title="Reagir"
                    aria-label="Reagir"
                    onClick={() => chooseReaction(message.id)}
                  >
                    <IconSmile size={18} />
                  </button>
                  <button
                    title={message.pinned ? "Desafixar" : "Fixar"}
                    aria-label={message.pinned ? "Desafixar" : "Fixar"}
                    onClick={() =>
                      pin.mutate(message.id, {
                        onError: (error) => setSendError(error.message),
                      })
                    }
                  >
                    <IconPin size={18} />
                  </button>
                  {message.authorId === currentUserId && (
                    <>
                      <button
                        title="Editar"
                        aria-label="Editar"
                        onClick={() => {
                          const text = window.prompt(
                            "Editar mensagem",
                            message.text,
                          );
                          if (text?.trim())
                            edit.mutate(
                              {
                                messageId: message.id,
                                text: text.trim(),
                              },
                              {
                                onError: (error) => setSendError(error.message),
                              },
                            );
                        }}
                      >
                        <IconPencil size={18} />
                      </button>
                      <button
                        title="Apagar"
                        aria-label="Apagar"
                        onClick={() =>
                          remove.mutate(message.id, {
                            onError: (error) => setSendError(error.message),
                          })
                        }
                      >
                        <IconTrash size={18} />
                      </button>
                    </>
                  )}
                </div>
              </article>
            </Fragment>
          );
        })}
      </div>
      {typingUsers.length > 0 && (
        <div className="typing-indicator">
          <span>•••</span>{" "}
          {typingUsers.map((id) => personFor(id).displayName).join(", ")} está
          digitando
        </div>
      )}
      {replyToId && (
        <div className="replying-bar">
          Respondendo a{" "}
          <b>
            {
              personFor(
                messages.find((message) => message.id === replyToId)
                  ?.authorId ?? currentUserId,
              ).displayName
            }
          </b>
          <button
            aria-label="Cancelar resposta"
            onClick={() => setReplyToId(undefined)}
          >
            <IconX size={16} />
          </button>
        </div>
      )}
      {sendError && (
        <div className="composer-error">
          {sendError}
          <button aria-label="Fechar erro" onClick={() => setSendError("")}>
            <IconX size={16} />
          </button>
        </div>
      )}
      {dmBlocked ? (
        <div className="composer-blocked" role="status">
          <IconBan size={18} />
          <span>
            Vocês não podem trocar mensagens: há um bloqueio entre as contas.
          </span>
        </div>
      ) : (
        <Composer
          channelId={channel.id}
          channelName={
            channel.kind === "text" ? `#${channel.name}` : channel.name
          }
          onTyping={announceTyping}
          disabled={send.isPending}
          onSend={(text, files) =>
            send.mutate(
              { authorId: currentUserId, text, files, replyToId },
              {
                onSuccess: () => setReplyToId(undefined),
                onError: (error) => setSendError(error.message),
              },
            )
          }
        />
      )}
      {groupSettingsOpen && (
        <GroupDmSettingsPanel
          channel={channel}
          onClose={() => setGroupSettingsOpen(false)}
        />
      )}
    </main>
  );
}

function GroupDmSettingsPanel({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const profiles = useAppStore((state) => state.profiles),
    friendships = useAppStore((state) => state.friendships),
    channelMembers = useAppStore((state) => state.channelMembers),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [name, setName] = useState(channel.name),
    [iconFile, setIconFile] = useState<File | null>(null),
    [newMemberId, setNewMemberId] = useState(""),
    [notice, setNotice] = useState("");
  const memberIds = channelMembers
      .filter((member) => member.channelId === channel.id)
      .map((member) => member.userId),
    members = memberIds
      .map((id) => profiles.find((profile) => profile.id === id))
      .filter((profile): profile is Profile => Boolean(profile)),
    friendIds = new Set(
      friendships
        .filter(
          (friendship) =>
            friendship.status === "accepted" &&
            [friendship.requesterId, friendship.addresseeId].includes(
              currentUserId,
            ),
        )
        .map((friendship) =>
          friendship.requesterId === currentUserId
            ? friendship.addresseeId
            : friendship.requesterId,
        ),
    ),
    available = profiles.filter(
      (profile) => friendIds.has(profile.id) && !memberIds.includes(profile.id),
    ),
    isCreator = channel.createdBy === currentUserId;
  const refresh = () => hydrateOnlineWorkspace(currentUserId);
  const save = async (removeIcon = false) => {
    try {
      await saveOnlineGroupDm(channel, name.trim(), iconFile, removeIcon);
      await refresh();
      setIconFile(null);
      setNotice("Grupo atualizado e sincronizado.");
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Falha ao atualizar grupo.",
      );
    }
  };
  const addMember = async () => {
    if (!newMemberId) return;
    try {
      await addOnlineGroupDmMember(channel.id, newMemberId);
      await refresh();
      setNewMemberId("");
      setNotice("Membro adicionado ao grupo E2EE.");
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Falha ao adicionar membro.",
      );
    }
  };
  const removeMember = async (userId: string) => {
    try {
      await removeOnlineGroupDmMember(channel.id, userId);
      await refresh();
      if (userId === currentUserId) onClose();
      else setNotice("Membro removido do grupo.");
    } catch (caught) {
      setNotice(
        caught instanceof Error ? caught.message : "Falha ao remover membro.",
      );
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="account-panel group-dm-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">GRUPO E2EE</span>
            <h2>Configurar grupo</h2>
          </div>
          <button className="close-settings" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="group-dm-identity">
          {channel.iconUrl ? (
            <img src={channel.iconUrl} alt="" />
          ) : (
            <span>{channel.name.slice(0, 2).toUpperCase()}</span>
          )}
          <label>
            Nome do grupo
            <input
              value={name}
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Ícone (até 5 MB)
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(event) => setIconFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="primary-button"
            disabled={!name.trim()}
            onClick={() => void save()}
          >
            Salvar grupo
          </button>
          {channel.iconPath && (
            <button className="outline-button" onClick={() => void save(true)}>
              Remover ícone
            </button>
          )}
        </div>
        <div className="group-dm-add-member">
          <label>
            Adicionar amigo
            <select
              value={newMemberId}
              onChange={(event) => setNewMemberId(event.target.value)}
            >
              <option value="">Escolha uma pessoa</option>
              {available.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName} (@{profile.username})
                </option>
              ))}
            </select>
          </label>
          <button disabled={!newMemberId} onClick={() => void addMember()}>
            Adicionar
          </button>
        </div>
        <span className="eyebrow">MEMBROS — {members.length}/20</span>
        <div className="group-dm-members">
          {members.map((profile) => (
            <div key={profile.id}>
              <Avatar person={profile} size="sm" />
              <span>
                <b>{profile.displayName}</b>
                <small>
                  @{profile.username}
                  {profile.id === channel.createdBy ? " · criador" : ""}
                </small>
              </span>
              {(profile.id === currentUserId || isCreator) && (
                <button
                  className="danger-text"
                  onClick={() => void removeMember(profile.id)}
                >
                  {profile.id === currentUserId ? "Sair" : "Remover"}
                </button>
              )}
            </div>
          ))}
        </div>
        {notice && (
          <p className="profile-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </div>
  );
}

function StreamVideo({
  stream,
  className,
  muted = false,
  volume = 1,
  sinkId,
}: {
  stream: MediaStream;
  className: string;
  muted?: boolean;
  volume?: number;
  sinkId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = stream;
    videoRef.current.volume = volume;
    const mediaElement = videoRef.current as HTMLVideoElement & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (sinkId && mediaElement.setSinkId)
      void mediaElement.setSinkId(sinkId).catch(() => {});
    void videoRef.current.play().catch(() => {});
  }, [sinkId, stream, volume]);
  return (
    <video
      ref={videoRef}
      className={className}
      autoPlay
      muted={muted}
      playsInline
    />
  );
}

const TILE_GAP = 8;
const TILE_ASPECT = 16 / 9;

/**
 * Dois modos, e não uma escada até 4K.
 *
 * Os dois custam quase o mesmo em pixels por segundo, então a escolha é entre
 * movimento fluido e imagem detalhada — não entre gastar pouco e gastar muito.
 * Ver CAMERA_MODES em useLiveKitRtc para o porquê de 1440p e 4K terem saído.
 */
const CAMERA_RESOLUTIONS: Array<{ value: CameraResolution; label: string }> = [
  { value: 720, label: "720p · 60 fps (movimento)" },
  { value: 1080, label: "1080p · 30 fps (detalhe)" },
];

/**
 * Calcula o maior tamanho de card 16:9 que acomoda `count` participantes na
 * área disponível, testando cada número de colunas. CSS sozinho não resolve
 * isto: fixar `aspect-ratio` junto com limites de largura e altura faz o
 * navegador deformar o card em vez de reduzi-lo.
 */
function useCallGridLayout(count: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    // A medida inicial é lida de forma síncrona: esperar apenas pelo
    // ResizeObserver deixaria o grid zerado no primeiro quadro (e há ambientes
    // em que ele não dispara a leitura inicial). O observer e o resize da
    // janela cuidam das mudanças seguintes.
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        Math.abs(current.width - rect.width) < 1 &&
        Math.abs(current.height - rect.height) < 1
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    window.addEventListener("resize", measure);
    // Rede de segurança: um grid de vídeo com tamanho errado é imediatamente
    // visível, e nem todo ambiente entrega ResizeObserver/resize de forma
    // confiável (fullscreen, painéis embutidos). A verificação só troca o
    // estado quando o retângulo realmente muda.
    const poll = window.setInterval(measure, 500);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.clearInterval(poll);
    };
  }, [count]);
  const layout = (() => {
    if (!count || size.width < 1 || size.height < 1)
      return { columns: 1, tileWidth: 0, tileHeight: 0 };
    let best = { columns: 1, tileWidth: 0, tileHeight: 0 };
    for (let columns = 1; columns <= count; columns += 1) {
      const rows = Math.ceil(count / columns);
      const availableWidth = (size.width - TILE_GAP * (columns - 1)) / columns;
      const availableHeight = (size.height - TILE_GAP * (rows - 1)) / rows;
      if (availableWidth <= 0 || availableHeight <= 0) continue;
      const tileWidth = Math.min(availableWidth, availableHeight * TILE_ASPECT);
      const tileHeight = tileWidth / TILE_ASPECT;
      if (tileWidth * tileHeight > best.tileWidth * best.tileHeight)
        best = { columns, tileWidth, tileHeight };
    }
    return best;
  })();
  return { containerRef, ...layout };
}

function CallView({
  channel,
  onLeave,
  startWithVideo = false,
}: {
  channel: Channel;
  onLeave: () => void;
  startWithVideo?: boolean;
}) {
  const [micMuted, setMicMuted] = useState(true),
    [video, setVideo] = useState(false),
    [sharing, setSharing] = useState(false),
    [focused, setFocused] = useState<string | null>(null),
    [mediaRevision, setMediaRevision] = useState(0),
    [chatOpen, setChatOpen] = useState(false),
    [privacyOpen, setPrivacyOpen] = useState(false);
  const [mediaNotice, setMediaNotice] = useState(
    "Preparando a sala e a chave E2EE…",
  );
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [audioInputId, setAudioInputId] = useState(""),
    [videoInputId, setVideoInputId] = useState(""),
    [audioOutputId, setAudioOutputId] = useState(""),
    [inputMode, setInputMode] = useState<"vad" | "ptt">("vad"),
    [deafened, setDeafened] = useState(false),
    [shareQuality, setShareQuality] = useState<ShareQuality>({
      resolution: 1080,
      frameRate: 30,
    }),
    [sharePickerOpen, setSharePickerOpen] = useState(false),
    [cameraQuality, setCameraQualityState] = useState<CameraResolution>(() => {
      // Quem tinha 1440p ou 4K salvo cai em 1080p sem precisar fazer nada:
      // aqueles modos deixaram de existir, e travar numa preferência inválida
      // deixaria a câmera sem qualidade definida.
      const saved = Number(localStorage.getItem("janja.camera.quality"));
      return saved === 720 ? 720 : 1080;
    }),
    [openMenu, setOpenMenu] = useState<"audio" | "video" | "share" | null>(
      null,
    ),
    [peerVolumes, setPeerVolumes] = useState<Record<string, number>>({});
  const localStreamRef = useRef<MediaStream | null>(null),
    displayStreamRef = useRef<MediaStream | null>(null),
    localVideoRef = useRef<HTMLVideoElement | null>(null),
    displayVideoRef = useRef<HTMLVideoElement | null>(null),
    callViewRef = useRef<HTMLElement | null>(null);
  const profiles = useAppStore((state) => state.profiles),
    currentUserId = useAppStore((state) => state.currentUserId),
    currentProfile =
      profiles.find((profile) => profile.id === currentUserId) ?? profiles[0];
  const {
    remotePeers,
    speakingIds,
    publishStreams,
    setScreenQuality,
    setCameraQuality,
    setLocalTrackMuted,
    connectionState,
    connectionError,
    e2eeEpoch,
    leaveRoom,
  } = useRtc(channel.id);
  const stopStream = (stream: MediaStream | null) =>
    stream?.getTracks().forEach((track) => track.stop());
  const errorName = (error: unknown) =>
    error instanceof DOMException ? error.name : "";
  const getMediaDevice = async (
    kind: "audio" | "video",
    requestedDeviceId?: string,
    requestedResolution?: CameraResolution,
  ) => {
    const targetResolution = requestedResolution ?? cameraQuality;
    if (!navigator.mediaDevices?.getUserMedia) {
      setMediaNotice(
        "Este navegador não oferece acesso a dispositivos de mídia.",
      );
      return null;
    }
    try {
      setMediaNotice(
        kind === "audio"
          ? "Solicitando acesso ao microfone…"
          : "Solicitando acesso à câmera…",
      );
      const deviceId =
        requestedDeviceId || (kind === "audio" ? audioInputId : videoInputId);
      const audio =
        kind === "audio"
          ? {
              deviceId: deviceId ? { exact: deviceId } : undefined,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true,
            }
          : false;
      const capture = async (enforceMinimum: boolean) =>
        navigator.mediaDevices.getUserMedia({
          audio,
          video:
            kind === "video"
              ? {
                  deviceId: deviceId ? { exact: deviceId } : undefined,
                  // `ideal` sozinho deixava o Chrome escolher um modo baixo em
                  // câmeras com muitos formatos; o mínimo empurra a negociação
                  // para cima quando o modo existe.
                  width: enforceMinimum
                    ? { min: 1280, ideal: (targetResolution * 16) / 9 }
                    : { ideal: (targetResolution * 16) / 9 },
                  height: enforceMinimum
                    ? { min: 720, ideal: targetResolution }
                    : { ideal: targetResolution },
                  frameRate: { ideal: 30 },
                }
              : false,
        });
      let requestedStream: MediaStream;
      try {
        requestedStream = await capture(true);
      } catch (caught) {
        // Webcams que não alcançam 720p rejeitam o mínimo; nesse caso pedimos
        // o melhor modo disponível em vez de deixar o usuário sem vídeo.
        if (errorName(caught) !== "OverconstrainedError") throw caught;
        requestedStream = await capture(false);
      }
      if (!localStreamRef.current) localStreamRef.current = new MediaStream();
      requestedStream
        .getTracks()
        .forEach((track) => localStreamRef.current?.addTrack(track));
      setMediaRevision((revision) => revision + 1);
      const videoSettings =
        kind === "video"
          ? requestedStream.getVideoTracks()[0]?.getSettings()
          : undefined;
      setMediaNotice(
        kind === "audio"
          ? "Microfone conectado."
          : videoSettings?.width
            ? `Câmera conectada em ${videoSettings.width}×${videoSettings.height}.`
            : "Câmera conectada.",
      );
      return requestedStream.getTracks()[0] ?? null;
    } catch (error) {
      const name = errorName(error);
      // Negar a câmera não pode derrubar a chamada: o áudio continua e a
      // câmera pode ser ligada depois, quando a permissão for concedida.
      setMediaNotice(
        name === "NotAllowedError"
          ? kind === "video"
            ? "Permissão de câmera negada. A chamada continua só com áudio; você pode ligar a câmera depois."
            : "Permissão de microfone negada. Libere o acesso no navegador para falar."
          : name === "NotFoundError"
            ? kind === "video"
              ? "Nenhuma câmera encontrada. A chamada continua só com áudio."
              : "Nenhum microfone encontrado neste dispositivo."
            : kind === "video"
              ? "Não foi possível acessar a câmera. A chamada continua só com áudio."
              : "Não foi possível acessar o microfone.",
      );
      return null;
    }
  };
  const replaceMediaDevice = async (
    kind: "audio" | "video",
    deviceId: string,
  ) => {
    const tracks =
      kind === "audio"
        ? localStreamRef.current?.getAudioTracks()
        : localStreamRef.current?.getVideoTracks();
    tracks?.forEach((track) => {
      localStreamRef.current?.removeTrack(track);
      track.stop();
    });
    if (kind === "audio") setAudioInputId(deviceId);
    else setVideoInputId(deviceId);
    // A câmera desligada não deve ser reacendida só por trocar o dispositivo
    // preferido; a nova escolha vale na próxima ativação.
    if (kind === "video" && !video) {
      setMediaRevision((revision) => revision + 1);
      return;
    }
    const track = await getMediaDevice(kind, deviceId);
    if (track) {
      if (kind === "audio") track.enabled = !micMuted;
      setMediaRevision((revision) => revision + 1);
    }
  };
  const toggleMic = async () => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) {
      const nextMuted = !micMuted;
      track.enabled = !nextMuted;
      setMicMuted(nextMuted);
      // Sinaliza o mute pela publicação LiveKit para o outro lado exibir o
      // indicador correto (track.enabled sozinho não gera evento remoto).
      void setLocalTrackMuted("mic", nextMuted).catch(() => {});
      setMediaNotice(
        nextMuted ? "Microfone silenciado." : "Microfone ativado.",
      );
      if (!nextMuted && deafened) setDeafened(false);
      return;
    }
    if (await getMediaDevice("audio")) {
      setMicMuted(false);
      if (deafened) setDeafened(false);
    }
  };
  const toggleDeafen = () => {
    const nextDeafened = !deafened;
    setDeafened(nextDeafened);
    // Como no Discord, ensurdecer também silencia o microfone.
    if (nextDeafened && !micMuted) {
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (track) track.enabled = false;
      setMicMuted(true);
      void setLocalTrackMuted("mic", true).catch(() => {});
    }
  };
  const toggleVideo = async () => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    if (video && tracks.length) {
      // Desligar a câmera libera o dispositivo e despublica a track; o outro
      // lado volta a exibir o avatar em vez de um quadro congelado.
      tracks.forEach((track) => {
        localStreamRef.current?.removeTrack(track);
        track.stop();
      });
      setVideo(false);
      setMediaRevision((revision) => revision + 1);
      setMediaNotice("Câmera desativada.");
      return;
    }
    if (await getMediaDevice("video")) setVideo(true);
  };
  const stopSharing = () => {
    stopStream(displayStreamRef.current);
    displayStreamRef.current = null;
    if (displayVideoRef.current) displayVideoRef.current.srcObject = null;
    setSharing(false);
    setMediaNotice("Compartilhamento encerrado.");
  };
  const applyCameraQuality = async (resolution: CameraResolution) => {
    setCameraQualityState(resolution);
    localStorage.setItem("janja.camera.quality", String(resolution));
    setCameraQuality(resolution);
    if (!video) return;
    // A resolução é fixada no momento da captura: para valer agora, a track
    // precisa ser recriada e republicada com o novo orçamento de bits.
    const tracks = localStreamRef.current?.getVideoTracks() ?? [];
    tracks.forEach((track) => {
      localStreamRef.current?.removeTrack(track);
      track.stop();
    });
    setMediaRevision((revision) => revision + 1);
    const track = await getMediaDevice("video", videoInputId, resolution);
    if (track) {
      const settings = track.getSettings();
      setMediaNotice(
        `Câmera em ${settings.width ?? "?"}×${settings.height ?? "?"}.`,
      );
    }
  };
  const toggleSharing = () => {
    setOpenMenu(null);
    if (sharing) return stopSharing();
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMediaNotice("Compartilhamento não suportado neste dispositivo.");
      return;
    }
    // No desktop temos as miniaturas das janelas e mostramos o nosso seletor.
    // No navegador o Chrome já faz essa escolha; abrir um modal antes dele
    // seria uma etapa a mais para o mesmo resultado.
    if (window.janjaDesktop) setSharePickerOpen(true);
    else void startSharing({ ...shareQuality });
  };
  const startSharing = async (selection: ShareSelection) => {
    setSharePickerOpen(false);
    const quality = {
      resolution: selection.resolution,
      frameRate: selection.frameRate,
    };
    setShareQuality(quality);
    // O encoder precisa da qualidade antes da publicação da track.
    setScreenQuality(quality);
    const width = Math.round((selection.resolution * 16) / 9);
    const height = selection.resolution;
    // O diálogo do Chrome é desenhado pelo navegador e não pode ser estilizado
    // pela página — é justamente o que impede um site de falsificar o seletor.
    // Estas dicas são o que ele aceita: abrir já na aba de janelas, esconder a
    // própria aba do Janja e permitir trocar de fonte sem reiniciar.
    const captureViaBrowserPicker = () =>
      navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: "window",
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: selection.frameRate },
        },
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
        systemAudio: "include",
      } as DisplayMediaStreamOptions);
    try {
      let stream: MediaStream;
      if (selection.sourceId) {
        // No desktop a fonte já foi escolhida no nosso seletor e capturamos
        // direto pelo id do desktopCapturer.
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: {
              // @ts-expect-error restrições específicas do Chromium/Electron
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: selection.sourceId,
                maxWidth: width,
                maxHeight: height,
                maxFrameRate: selection.frameRate,
              },
            },
          });
        } catch (caught) {
          // Se o Chromium embutido recusar a captura por id, é melhor cair no
          // seletor nativo do que deixar o usuário sem compartilhamento.
          console.warn(
            "Captura direta da fonte indisponível; usando o seletor do sistema",
            caught,
          );
          stream = await captureViaBrowserPicker();
        }
      } else {
        stream = await captureViaBrowserPicker();
      }
      displayStreamRef.current = stream;
      stream
        .getVideoTracks()[0]
        // Cobre também o "parar de compartilhar" do próprio navegador.
        ?.addEventListener("ended", stopSharing, { once: true });
      setSharing(true);
      setMediaNotice(
        `Compartilhando ${selection.sourceName ?? "sua tela"} em ${selection.resolution}p · ${selection.frameRate} fps.`,
      );
    } catch (error) {
      setMediaNotice(
        errorName(error) === "NotAllowedError"
          ? "Compartilhamento cancelado."
          : "Não foi possível iniciar o compartilhamento.",
      );
    }
  };
  const leaveCall = async () => {
    try {
      await leaveRoom();
      stopStream(localStreamRef.current);
      stopStream(displayStreamRef.current);
      onLeave();
    } catch (caught) {
      setMediaNotice(
        `Falha ao encerrar a chamada: ${caught instanceof Error ? caught.message : "tente novamente."}`,
      );
    }
  };
  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await callViewRef.current?.requestFullscreen();
  };
  const togglePictureInPicture = async () => {
    const candidate =
      (document.querySelector(
        ".remote-screen-video",
      ) as HTMLVideoElement | null) ??
      (document.querySelector(".remote-video") as HTMLVideoElement | null) ??
      displayVideoRef.current ??
      localVideoRef.current;
    if (!candidate || !document.pictureInPictureEnabled) {
      setMediaNotice("Picture-in-Picture não está disponível.");
      return;
    }
    if (document.pictureInPictureElement) await document.exitPictureInPicture();
    else await candidate.requestPictureInPicture();
  };
  useEffect(() => {
    // O elemento pode remontar quando o tile muda entre grid, foco e faixa
    // inferior; `focused` nas dependências reata o srcObject após o remount.
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      if (video) void localVideoRef.current.play().catch(() => {});
    }
  }, [mediaRevision, video, focused]);
  useEffect(() => {
    if (displayVideoRef.current && displayStreamRef.current) {
      displayVideoRef.current.srcObject = displayStreamRef.current;
      void displayVideoRef.current.play().catch(() => {});
    }
  }, [sharing, focused]);
  useEffect(() => {
    publishStreams(
      [
        localStreamRef.current
          ? { stream: localStreamRef.current, source: "camera" as const }
          : undefined,
        displayStreamRef.current
          ? { stream: displayStreamRef.current, source: "screen" as const }
          : undefined,
      ].filter(
        (
          item,
        ): item is {
          stream: MediaStream;
          source: "camera" | "screen";
        } => Boolean(item),
      ),
    );
  }, [mediaRevision, publishStreams, sharing]);
  useEffect(() => {
    if (!focused) return;
    const localScreenFocused = focused === `${currentUserId}:screen` && sharing;
    const localCameraFocused = focused === currentUserId;
    const remoteStreamFocused = remotePeers.some(
      (peer) =>
        peer.peerId === focused ||
        (`${peer.peerId}:screen` === focused && peer.hasScreen),
    );
    if (!localScreenFocused && !localCameraFocused && !remoteStreamFocused)
      setFocused(null);
  }, [currentUserId, focused, remotePeers, sharing]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFocused(null);
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, []);
  useEffect(() => {
    if (connectionError)
      setMediaNotice(`Problema na chamada: ${connectionError}`);
    else if (connectionState === "preparing-encryption")
      setMediaNotice("Sincronizando o grupo OpenMLS e a chave da chamada…");
    else if (connectionState === "connecting")
      setMediaNotice("Conectando ao servidor LiveKit…");
    else if (connectionState === "connected")
      setMediaNotice(
        `Sala conectada com mídia E2EE${e2eeEpoch === null ? "" : ` · epoch ${e2eeEpoch}`}.`,
      );
    else if (connectionState === "reconnecting")
      setMediaNotice("Conexão interrompida; reconectando à chamada…");
    else if (connectionState === "disconnected")
      setMediaNotice("A chamada foi desconectada.");
    else if (connectionState === "error")
      setMediaNotice(
        `Falha ao entrar na chamada: ${connectionError || "verifique Supabase e LiveKit."}`,
      );
  }, [connectionError, connectionState, e2eeEpoch]);
  useEffect(() => {
    const refresh = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      setDevices(await navigator.mediaDevices.enumerateDevices());
    };
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [mediaRevision]);
  useEffect(() => {
    if (inputMode !== "ptt") return;
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (track) track.enabled = false;
    setMicMuted(true);
    const editable = (target: EventTarget | null) =>
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement;
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || editable(event.target))
        return;
      event.preventDefault();
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
        setMicMuted(false);
        void setLocalTrackMuted("mic", false).catch(() => {});
      }
    };
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const audioTrack = localStreamRef.current?.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = false;
        setMicMuted(true);
        void setLocalTrackMuted("mic", true).catch(() => {});
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [inputMode, mediaRevision, setLocalTrackMuted]);
  useEffect(() => {
    // Mantém o encoder alinhado com a resolução escolhida desde a conexão.
    setCameraQuality(cameraQuality);
  }, [cameraQuality, setCameraQuality]);
  const autoVideoStartedRef = useRef(false);
  useEffect(() => {
    if (!startWithVideo || autoVideoStartedRef.current) return;
    autoVideoStartedRef.current = true;
    void getMediaDevice("video").then((track) => {
      if (track) setVideo(true);
    });
    // Executa apenas na entrada da chamada de vídeo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startWithVideo]);
  useEffect(
    () => () => {
      stopStream(localStreamRef.current);
      stopStream(displayStreamRef.current);
    },
    [],
  );
  const localSpeaking = !micMuted && speakingIds.includes(currentUserId ?? "");
  interface CallTile {
    id: string;
    type: "camera" | "screen";
    peerId: string;
    name: string;
    self: boolean;
    hasVideo: boolean;
    micMuted: boolean;
    speaking: boolean;
    peer?: RemotePeer;
  }
  const cameraTiles: CallTile[] = [
    {
      id: currentUserId,
      type: "camera",
      peerId: currentUserId,
      name: currentProfile.displayName,
      self: true,
      hasVideo: video,
      micMuted,
      speaking: localSpeaking,
    },
    ...remotePeers.map((peer) => ({
      id: peer.peerId,
      type: "camera" as const,
      peerId: peer.peerId,
      name: peer.displayName,
      self: false,
      hasVideo: peer.hasCamera && peer.stream.getVideoTracks().length > 0,
      micMuted: peer.micMuted,
      speaking: peer.speaking,
      peer,
    })),
  ];
  const screenTiles: CallTile[] = [
    ...(sharing
      ? [
          {
            id: `${currentUserId}:screen`,
            type: "screen" as const,
            peerId: currentUserId,
            name: currentProfile.displayName,
            self: true,
            hasVideo: true,
            micMuted: false,
            speaking: false,
          },
        ]
      : []),
    ...remotePeers
      .filter((peer) => peer.hasScreen)
      .map((peer) => ({
        id: `${peer.peerId}:screen`,
        type: "screen" as const,
        peerId: peer.peerId,
        name: peer.displayName,
        self: false,
        hasVideo: true,
        micMuted: false,
        speaking: false,
        peer,
      })),
  ];
  // Webcams ligadas têm prioridade no grid; compartilhamentos entram como
  // tiles adicionais e só ganham destaque quando o usuário clica.
  const orderedTiles: CallTile[] = [
    ...cameraTiles.filter((tile) => tile.hasVideo),
    ...screenTiles,
    ...cameraTiles.filter((tile) => !tile.hasVideo),
  ];
  const focusedTile = orderedTiles.find((tile) => tile.id === focused);
  const stripTiles = focusedTile
    ? orderedTiles.filter((tile) => tile.id !== focusedTile.id)
    : [];
  const gridLayout = useCallGridLayout(focusedTile ? 0 : orderedTiles.length);
  const toggleFocus = (id: string) =>
    setFocused((current) => (current === id ? null : id));
  const profileForPeer = (peerId: string) =>
    profiles.find((item) => item.id === peerId);
  const renderTile = (tile: CallTile, compact = false) => {
    const isFocused = focused === tile.id;
    const tileProfile = profileForPeer(tile.peerId);
    return (
      <div
        key={tile.id}
        role="button"
        tabIndex={0}
        aria-label={
          tile.type === "screen"
            ? `${isFocused ? "Desfocar" : "Focar"} tela de ${tile.self ? "você" : tile.name}`
            : `${isFocused ? "Desfocar" : "Focar"} câmera de ${tile.self ? "você" : tile.name}`
        }
        aria-pressed={isFocused}
        onClick={() => toggleFocus(tile.id)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          toggleFocus(tile.id);
        }}
        className={[
          "participant-tile",
          tile.type === "screen" ? "screen-tile" : "camera-tile",
          tile.speaking ? "speaking" : "",
          isFocused ? "focused" : "",
          compact ? "compact" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {tile.type === "camera" && tile.self && (
          <video
            ref={localVideoRef}
            className={`tile-video local-video ${video ? "visible" : ""}`}
            autoPlay
            muted
            playsInline
          />
        )}
        {tile.type === "camera" && !tile.self && tile.peer && (
          <StreamVideo
            stream={tile.peer.stream}
            className={`tile-video ${tile.hasVideo ? "remote-video" : "remote-audio"}`}
            muted={deafened}
            volume={peerVolumes[tile.peerId] ?? 1}
            sinkId={audioOutputId}
          />
        )}
        {tile.type === "screen" && tile.self && (
          <video
            ref={displayVideoRef}
            className="tile-video screen-video shared-screen-video"
            autoPlay
            muted
            playsInline
          />
        )}
        {tile.type === "screen" && !tile.self && tile.peer && (
          <StreamVideo
            stream={tile.peer.screenStream}
            className="tile-video screen-video remote-screen-video"
            muted={deafened}
            volume={peerVolumes[tile.peerId] ?? 1}
            sinkId={audioOutputId}
          />
        )}
        {tile.type === "camera" && !tile.hasVideo && (
          <div className="tile-avatar">
            <Avatar
              person={
                tileProfile ?? {
                  avatar: tile.name.slice(0, 2).toUpperCase(),
                  avatarUrl: undefined,
                  color: "#f00c14",
                  status: "online",
                }
              }
              size={compact ? "lg" : "xl"}
              online={false}
            />
          </div>
        )}
        <div className="tile-overlay">
          {tile.type === "screen" ? (
            <span className="tile-badge live">AO VIVO</span>
          ) : (
            tile.micMuted && (
              <span className="tile-mute" aria-label="Microfone silenciado">
                <IconMicOff size={14} />
              </span>
            )
          )}
          <span className="tile-name">
            {tile.type === "screen"
              ? tile.self
                ? "Sua tela"
                : `Tela de ${tile.name}`
              : tile.self
                ? `${tile.name} (você)`
                : tile.name}
          </span>
        </div>
        {tile.type === "camera" && !tile.self && !compact && (
          <label
            className="peer-volume"
            onClick={(event) => event.stopPropagation()}
          >
            <IconVolume size={14} />
            <input
              aria-label={`Volume de ${tile.name}`}
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={peerVolumes[tile.peerId] ?? 1}
              onChange={(event) =>
                setPeerVolumes((current) => ({
                  ...current,
                  [tile.peerId]: Number(event.target.value),
                }))
              }
            />
          </label>
        )}
      </div>
    );
  };
  return (
    <main className="call-view" ref={callViewRef}>
      <div className="call-header">
        <div className="conversation-title">
          <span className="channel-symbol voice">
            <IconVolume size={20} />
          </span>
          <div>
            <h1>{channel.name}</h1>
            <span>
              {remotePeers.length + 1} participante
              {remotePeers.length ? "s" : ""}
            </span>
          </div>
        </div>
        <div
          className={`encryption-badge ${
            connectionError || connectionState === "error"
              ? "pending"
              : connectionState === "connected"
                ? "connected"
                : "pending"
          }`}
          data-rtc-state={connectionError ? "error" : connectionState}
        >
          <span>●</span>{" "}
          {connectionError
            ? connectionState === "error"
              ? "Falha na conexão da chamada"
              : "Chamada conectada com falha"
            : connectionState === "connected"
              ? `LiveKit conectado · E2EE epoch ${e2eeEpoch ?? "—"}`
              : connectionState === "error"
                ? "Falha na conexão da chamada"
                : "Conectando LiveKit · E2EE OpenMLS"}{" "}
          <button
            aria-label="Detalhes de privacidade da chamada"
            aria-expanded={privacyOpen}
            onClick={() => setPrivacyOpen((open) => !open)}
          >
            {privacyOpen ? (
              <IconChevronUp size={16} />
            ) : (
              <IconChevronDown size={16} />
            )}
          </button>
        </div>
        <button
          className={`call-more ${chatOpen ? "active" : ""}`}
          aria-label="Chat da chamada"
          title="Chat da chamada"
          onClick={() => setChatOpen(!chatOpen)}
        >
          <IconMessage size={22} />
        </button>
      </div>
      {privacyOpen && (
        <section
          className="call-privacy-panel"
          aria-label="Privacidade da chamada"
        >
          <div>
            <span className="eyebrow">VOICE &amp; VIDEO DETAILS</span>
            <b>Privacidade</b>
          </div>
          <dl>
            <div>
              <dt>Transporte</dt>
              <dd>LiveKit SFU / WebRTC</dd>
            </div>
            <div>
              <dt>Criptografia</dt>
              <dd>E2EE · chave exportada do grupo OpenMLS</dd>
            </div>
            <div>
              <dt>Epoch atual</dt>
              <dd>{e2eeEpoch ?? "sincronizando"}</dd>
            </div>
            <div>
              <dt>Estado</dt>
              <dd>{connectionState}</dd>
            </div>
          </dl>
          <div className="call-privacy-participants">
            <b>Participantes verificados na sala</b>
            <span>{currentProfile.displayName} · este dispositivo</span>
            {remotePeers.map((peer) => (
              <span key={peer.peerId}>{peer.displayName}</span>
            ))}
          </div>
          <small>
            Compare os códigos dos dispositivos em Configurações de perfil antes
            de uma conversa sensível.
          </small>
        </section>
      )}
      {mediaNotice && (
        <div className="media-notice" role="status">
          <span className="live-dot" />
          {mediaNotice}
          <button aria-label="Fechar aviso" onClick={() => setMediaNotice("")}>
            <IconX size={16} />
          </button>
        </div>
      )}
      <div className={`call-stage ${focusedTile ? "has-focus" : ""}`}>
        {focusedTile ? (
          <>
            <div className="focused-area">{renderTile(focusedTile)}</div>
            {stripTiles.length > 0 && (
              <div className="tile-strip">
                {stripTiles.map((tile) => renderTile(tile, true))}
              </div>
            )}
          </>
        ) : (
          <div className="tile-grid-measure" ref={gridLayout.containerRef}>
            <div
              className="tile-grid"
              style={
                {
                  "--grid-columns": gridLayout.columns,
                  "--tile-width": `${gridLayout.tileWidth}px`,
                  "--tile-height": `${gridLayout.tileHeight}px`,
                } as CSSProperties
              }
            >
              {orderedTiles.map((tile) => renderTile(tile))}
            </div>
          </div>
        )}
        {remotePeers.length === 0 && (
          <div className="call-waiting">
            <b>Esperando outro participante…</b>
            <span>Convide alguém ou abra outro cliente neste canal.</span>
          </div>
        )}
      </div>
      {chatOpen && (
        <VoiceTextPanel channel={channel} onClose={() => setChatOpen(false)} />
      )}
      <div className="call-controls">
        <div className="control-cluster">
          <div className="control-split">
            <button
              aria-pressed={!micMuted}
              aria-label={micMuted ? "Ativar microfone" : "Silenciar microfone"}
              title={micMuted ? "Ativar microfone" : "Silenciar microfone"}
              className={`call-control ${micMuted ? "danger-state" : ""}`}
              onClick={() => void toggleMic()}
            >
              {micMuted ? <IconMicOff size={22} /> : <IconMic size={22} />}
            </button>
            <button
              className="control-chevron"
              aria-label="Dispositivos de áudio"
              aria-expanded={openMenu === "audio"}
              title="Dispositivos de áudio"
              onClick={() =>
                setOpenMenu((current) => (current === "audio" ? null : "audio"))
              }
            >
              <IconChevronDown size={14} />
            </button>
            {openMenu === "audio" && (
              <DeviceMenu
                onClose={() => setOpenMenu(null)}
                groups={[
                  {
                    label: "MICROFONE",
                    kind: "audioinput",
                    devices: devices.filter(
                      (device) => device.kind === "audioinput",
                    ),
                    selectedId: audioInputId,
                    fallbackLabel: "Microfone",
                    onSelect: (id) => void replaceMediaDevice("audio", id),
                  },
                  {
                    label: "SAÍDA DE ÁUDIO",
                    kind: "audiooutput",
                    devices: devices.filter(
                      (device) => device.kind === "audiooutput",
                    ),
                    selectedId: audioOutputId,
                    fallbackLabel: "Saída",
                    onSelect: setAudioOutputId,
                  },
                ]}
                footer={
                  <div className="device-menu-group">
                    <span className="device-menu-label">MODO DE ENTRADA</span>
                    <button
                      role="menuitemradio"
                      aria-checked={inputMode === "vad"}
                      className={inputMode === "vad" ? "selected" : ""}
                      onClick={() => setInputMode("vad")}
                    >
                      <span className="device-check">
                        {inputMode === "vad" && <IconCheck size={15} />}
                      </span>
                      <span>Atividade de voz</span>
                    </button>
                    <button
                      role="menuitemradio"
                      aria-checked={inputMode === "ptt"}
                      className={inputMode === "ptt" ? "selected" : ""}
                      onClick={() => setInputMode("ptt")}
                    >
                      <span className="device-check">
                        {inputMode === "ptt" && <IconCheck size={15} />}
                      </span>
                      <span>Apertar para falar (Espaço)</span>
                    </button>
                  </div>
                }
              />
            )}
          </div>
          <div className="control-split">
            <button
              aria-pressed={video}
              aria-label={video ? "Desligar câmera" : "Ligar câmera"}
              title={video ? "Desligar câmera" : "Ligar câmera"}
              className={`call-control ${video ? "active-control" : ""}`}
              onClick={() => void toggleVideo()}
            >
              {video ? <IconVideo size={22} /> : <IconVideoOff size={22} />}
            </button>
            <button
              className="control-chevron"
              aria-label="Selecionar câmera"
              aria-expanded={openMenu === "video"}
              title="Selecionar câmera"
              onClick={() =>
                setOpenMenu((current) => (current === "video" ? null : "video"))
              }
            >
              <IconChevronDown size={14} />
            </button>
            {openMenu === "video" && (
              <DeviceMenu
                onClose={() => setOpenMenu(null)}
                groups={[
                  {
                    label: "CÂMERA",
                    kind: "videoinput",
                    devices: devices.filter(
                      (device) => device.kind === "videoinput",
                    ),
                    selectedId: videoInputId,
                    fallbackLabel: "Câmera",
                    onSelect: (id) => void replaceMediaDevice("video", id),
                  },
                ]}
                footer={
                  <div className="device-menu-group">
                    <span className="device-menu-label">
                      QUALIDADE DA CÂMERA
                    </span>
                    {CAMERA_RESOLUTIONS.map((option) => (
                      <button
                        key={option.value}
                        role="menuitemradio"
                        aria-checked={cameraQuality === option.value}
                        className={
                          cameraQuality === option.value ? "selected" : ""
                        }
                        onClick={() => void applyCameraQuality(option.value)}
                      >
                        <span className="device-check">
                          {cameraQuality === option.value && (
                            <IconCheck size={15} />
                          )}
                        </span>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                }
              />
            )}
          </div>
        </div>

        <div className="control-cluster">
          <button
            aria-pressed={deafened}
            aria-label={deafened ? "Voltar a ouvir" : "Ensurdecer"}
            title={deafened ? "Voltar a ouvir" : "Ensurdecer"}
            className={`call-control ${deafened ? "danger-state" : ""}`}
            onClick={toggleDeafen}
          >
            {deafened ? (
              <IconHeadphonesOff size={22} />
            ) : (
              <IconHeadphones size={22} />
            )}
          </button>
          <div className="control-split">
            <button
              aria-pressed={sharing}
              aria-label={
                sharing ? "Parar compartilhamento" : "Compartilhar sua tela"
              }
              title={
                sharing ? "Parar compartilhamento" : "Compartilhar sua tela"
              }
              className={`call-control ${sharing ? "share-active" : ""}`}
              onClick={toggleSharing}
            >
              {sharing ? (
                <IconScreenShareOff size={22} />
              ) : (
                <IconScreenShare size={22} />
              )}
            </button>
            <button
              className="control-chevron"
              aria-label="Qualidade do compartilhamento"
              aria-expanded={openMenu === "share"}
              title="Qualidade do compartilhamento"
              onClick={() =>
                setOpenMenu((current) => (current === "share" ? null : "share"))
              }
            >
              <IconChevronDown size={14} />
            </button>
            {openMenu === "share" && (
              <DeviceMenu
                groups={[]}
                onClose={() => setOpenMenu(null)}
                footer={
                  <>
                    <div className="device-menu-group">
                      <span className="device-menu-label">RESOLUÇÃO</span>
                      {([720, 1080, 1440] as const).map((resolution) => (
                        <button
                          key={resolution}
                          role="menuitemradio"
                          aria-checked={shareQuality.resolution === resolution}
                          className={
                            shareQuality.resolution === resolution
                              ? "selected"
                              : ""
                          }
                          onClick={() =>
                            setShareQuality((current) => ({
                              ...current,
                              resolution,
                            }))
                          }
                        >
                          <span className="device-check">
                            {shareQuality.resolution === resolution && (
                              <IconCheck size={15} />
                            )}
                          </span>
                          <span>{resolution}p</span>
                        </button>
                      ))}
                    </div>
                    <div className="device-menu-group">
                      <span className="device-menu-label">TAXA DE QUADROS</span>
                      {([15, 30, 60] as const).map((frameRate) => (
                        <button
                          key={frameRate}
                          role="menuitemradio"
                          aria-checked={shareQuality.frameRate === frameRate}
                          className={
                            shareQuality.frameRate === frameRate
                              ? "selected"
                              : ""
                          }
                          onClick={() =>
                            setShareQuality((current) => ({
                              ...current,
                              frameRate,
                            }))
                          }
                        >
                          <span className="device-check">
                            {shareQuality.frameRate === frameRate && (
                              <IconCheck size={15} />
                            )}
                          </span>
                          <span>{frameRate} fps</span>
                        </button>
                      ))}
                    </div>
                  </>
                }
              />
            )}
          </div>
          <button
            className="call-control"
            aria-label="Picture-in-Picture"
            title="Picture-in-Picture"
            onClick={() => void togglePictureInPicture()}
          >
            <IconPictureInPicture size={22} />
          </button>
          <button
            className="call-control"
            aria-label="Alternar tela cheia"
            title="Tela cheia"
            onClick={() => void toggleFullscreen()}
          >
            <IconMaximize size={22} />
          </button>
        </div>

        <button
          className="leave-control"
          aria-label="Desconectar da chamada"
          title="Desconectar"
          onClick={() => void leaveCall()}
        >
          <IconPhoneOff size={22} />
        </button>
      </div>
      {sharePickerOpen && (
        <ScreenSharePicker
          quality={shareQuality}
          onQualityChange={setShareQuality}
          onCancel={() => setSharePickerOpen(false)}
          onShare={(selection) => void startSharing(selection)}
        />
      )}
    </main>
  );
}

function VoiceTextPanel({
  channel,
  onClose,
}: {
  channel: Channel;
  onClose: () => void;
}) {
  const profiles = useAppStore((state) => state.profiles),
    currentUserId = useAppStore((state) => state.currentUserId),
    { data: messages = [], send } = useMessages(channel.id),
    { typingUsers, announceTyping } = useTyping(channel.id, currentUserId);
  const personFor = (id: string) =>
    profiles.find((profile) => profile.id === id) ?? unknownPerson(id);
  return (
    <aside className="voice-text-panel">
      <header>
        <div>
          <span className="eyebrow">CHAT ASSOCIADO</span>
          <b>{channel.name}</b>
        </div>
        <button aria-label="Fechar chat" onClick={onClose}>
          <IconX size={18} />
        </button>
      </header>
      <div className="voice-message-list">
        {messages.slice(-50).map((message) => {
          const author = personFor(message.authorId);
          return (
            <article key={message.id}>
              <Avatar person={author} size="sm" />
              <div>
                <b>{author.displayName}</b>
                <p>{message.text}</p>
              </div>
            </article>
          );
        })}
        {messages.length === 0 && (
          <p className="empty-copy">Inicie a conversa desta sala.</p>
        )}
      </div>
      {typingUsers.length > 0 && (
        <div className="typing-indicator">Alguém está digitando…</div>
      )}
      <Composer
        channelId={channel.id}
        channelName={channel.name}
        onTyping={announceTyping}
        disabled={send.isPending}
        onSend={(text, files) =>
          send.mutate({ authorId: currentUserId, text, files })
        }
      />
    </aside>
  );
}

type FriendsTab = "online" | "all" | "pending" | "blocked" | "add";

const statusLabel = (status: Profile["status"]) =>
  status === "online"
    ? "Online"
    : status === "idle"
      ? "Ausente"
      : status === "dnd"
        ? "Não perturbe"
        : "Offline";

function HomeView({
  onChannel,
  onCall,
  onProfilePreview,
}: {
  onChannel: (id: string) => void;
  onCall: (channelId: string, withVideo: boolean) => void;
  onProfilePreview: (userId: string) => void;
}) {
  const [tab, setTab] = useState<FriendsTab>("online"),
    [search, setSearch] = useState(""),
    [friendQuery, setFriendQuery] = useState(""),
    [notice, setNotice] = useState<{
      tone: "success" | "error";
      text: string;
    } | null>(null),
    [busyIds, setBusyIds] = useState<string[]>([]),
    [recentCalls, setRecentCalls] = useState<OnlineCallSession[]>([]),
    [newConversationOpen, setNewConversationOpen] = useState(false);
  const profiles = useAppStore((state) => state.profiles),
    friendships = useAppStore((state) => state.friendships),
    blocks = useAppStore((state) => state.blocks),
    channels = useAppStore((state) => state.channels),
    currentUserId = useAppStore((state) => state.currentUserId);
  const refresh = () => hydrateOnlineWorkspace(currentUserId);
  useEffect(() => {
    let active = true;
    const loadCalls = () =>
      void listRecentOnlineCalls()
        .then((calls) => active && setRecentCalls(calls))
        .catch(
          (caught) =>
            active &&
            setNotice({
              tone: "error",
              text:
                caught instanceof Error
                  ? caught.message
                  : "Falha ao carregar chamadas recentes.",
            }),
        );
    loadCalls();
    const realtime = supabase
      .channel(`recent-calls:${currentUserId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_sessions" },
        loadCalls,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "call_session_participants" },
        loadCalls,
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(realtime);
    };
  }, [currentUserId]);
  const accepted = friendships.filter(
    (item) =>
      item.status === "accepted" &&
      [item.requesterId, item.addresseeId].includes(currentUserId),
  );
  const blockedIds = new Set(
    blocks
      .filter((item) => item.blockerId === currentUserId)
      .map((item) => item.blockedId),
  );
  const friends = accepted
    .map((item) => ({
      friendship: item,
      profile: profiles.find(
        (profile) =>
          profile.id ===
          (item.requesterId === currentUserId
            ? item.addresseeId
            : item.requesterId),
      ),
    }))
    .filter(
      (
        item,
      ): item is { friendship: (typeof accepted)[number]; profile: Profile } =>
        Boolean(item.profile) && !blockedIds.has(item.profile!.id),
    )
    .sort((left, right) =>
      left.profile.displayName.localeCompare(right.profile.displayName),
    );
  const incoming = friendships
    .filter(
      (item) => item.status === "pending" && item.addresseeId === currentUserId,
    )
    .map((request) => ({
      request,
      profile: profiles.find((item) => item.id === request.requesterId),
    }))
    .filter((item): item is { request: Friendship; profile: Profile } =>
      Boolean(item.profile),
    );
  const outgoing = friendships
    .filter(
      (item) => item.status === "pending" && item.requesterId === currentUserId,
    )
    .map((request) => ({
      request,
      profile: profiles.find((item) => item.id === request.addresseeId),
    }))
    .filter((item): item is { request: Friendship; profile: Profile } =>
      Boolean(item.profile),
    );
  const blocked = blocks
    .filter((item) => item.blockerId === currentUserId)
    .map((item) => profiles.find((profile) => profile.id === item.blockedId))
    .filter((profile): profile is Profile => Boolean(profile));
  const onlineFriends = friends.filter(
    ({ profile }) => profile.status !== "offline",
  );
  const normalizedSearch = search.trim().toLowerCase();
  const matchesSearch = (profile: Profile) =>
    !normalizedSearch ||
    `${profile.displayName} ${profile.username}`
      .toLowerCase()
      .includes(normalizedSearch);
  const withBusy = async (id: string, action: () => Promise<void>) => {
    if (busyIds.includes(id)) return;
    setBusyIds((current) => [...current, id]);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "A ação não pôde ser concluída.",
      });
    } finally {
      setBusyIds((current) => current.filter((item) => item !== id));
    }
  };
  const openDm = (profileId: string, andCall?: "voice" | "video") =>
    withBusy(`dm:${profileId}`, async () => {
      const channelId = await createOnlineDirectChannel([profileId]);
      await refresh();
      if (andCall) onCall(channelId, andCall === "video");
      else onChannel(channelId);
    });
  const sendRequest = async () => {
    const username = friendQuery.trim().replace(/^@/, "").toLowerCase();
    if (!username) return;
    const profile = profiles.find(
      (item) => item.username.toLowerCase() === username,
    );
    if (!profile || profile.id === currentUserId) {
      setNotice({
        tone: "error",
        text: `Não encontramos ninguém com o username "${username}". Confira a grafia.`,
      });
      return;
    }
    try {
      await requestOnlineFriend(profile.id);
      await refresh();
      setFriendQuery("");
      setNotice({
        tone: "success",
        text: `Pedido de amizade enviado para @${profile.username}.`,
      });
    } catch (caught) {
      setNotice({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "Não foi possível enviar o pedido.",
      });
    }
  };
  const friendRow = ({
    friendship,
    profile,
  }: {
    friendship: Friendship;
    profile: Profile;
  }) => (
    <div className="friend-row" key={profile.id}>
      <button
        className="friend-row-main"
        onClick={() => onProfilePreview(profile.id)}
        aria-label={`Abrir perfil de ${profile.displayName}`}
      >
        <Avatar person={profile} size="lg" />
        <span className="friend-row-names">
          <b>{profile.displayName}</b>
          <small>
            @{profile.username} · {statusLabel(profile.status)}
            {profile.customStatus ? ` · ${profile.customStatus}` : ""}
          </small>
        </span>
      </button>
      <div className="friend-row-actions">
        <button
          className="icon-button"
          aria-label={`Mensagem para ${profile.displayName}`}
          title="Mensagem"
          disabled={busyIds.includes(`dm:${profile.id}`)}
          onClick={() => void openDm(profile.id)}
        >
          <IconMessage size={20} />
        </button>
        <button
          className="icon-button"
          aria-label={`Chamada de voz com ${profile.displayName}`}
          title="Chamada de voz"
          disabled={busyIds.includes(`dm:${profile.id}`)}
          onClick={() => void openDm(profile.id, "voice")}
        >
          <IconPhone size={20} />
        </button>
        <button
          className="icon-button"
          aria-label={`Chamada de vídeo com ${profile.displayName}`}
          title="Chamada de vídeo"
          disabled={busyIds.includes(`dm:${profile.id}`)}
          onClick={() => void openDm(profile.id, "video")}
        >
          <IconVideo size={20} />
        </button>
        <button
          className="icon-button"
          aria-label={`Remover amizade com ${profile.displayName}`}
          title="Remover amigo"
          disabled={busyIds.includes(friendship.id)}
          onClick={() =>
            void withBusy(friendship.id, () =>
              removeOnlineFriend(friendship.id),
            )
          }
        >
          <IconUserX size={20} />
        </button>
        <button
          className="icon-button danger-text"
          aria-label={`Bloquear ${profile.displayName}`}
          title="Bloquear"
          disabled={busyIds.includes(`block:${profile.id}`)}
          onClick={() =>
            void withBusy(`block:${profile.id}`, () =>
              blockOnlineUser(currentUserId, profile.id),
            )
          }
        >
          <IconBan size={20} />
        </button>
      </div>
    </div>
  );
  const visibleFriends = (tab === "online" ? onlineFriends : friends).filter(
    ({ profile }) => matchesSearch(profile),
  );
  return (
    <main className="conversation home-view">
      <div className="conversation-header friends-header">
        <div className="conversation-title">
          <span className="channel-symbol">
            <IconUsers size={20} />
          </span>
          <h1>Amigos</h1>
        </div>
        <nav className="friends-tabs" aria-label="Filtros de amigos">
          <button
            className={tab === "online" ? "active" : ""}
            onClick={() => setTab("online")}
          >
            Online
          </button>
          <button
            className={tab === "all" ? "active" : ""}
            onClick={() => setTab("all")}
          >
            Todos
          </button>
          <button
            className={tab === "pending" ? "active" : ""}
            onClick={() => setTab("pending")}
          >
            Pendentes
            {incoming.length > 0 && (
              <span className="tab-badge">{incoming.length}</span>
            )}
          </button>
          <button
            className={tab === "blocked" ? "active" : ""}
            onClick={() => setTab("blocked")}
          >
            Bloqueados
          </button>
          <button
            className={`add-friend-tab ${tab === "add" ? "active" : ""}`}
            onClick={() => setTab("add")}
          >
            Adicionar amigo
          </button>
        </nav>
        <button
          className="outline-button"
          onClick={() => setNewConversationOpen(true)}
        >
          Nova conversa
        </button>
      </div>
      <div className="home-content">
        {notice && (
          <p
            className={`home-notice ${notice.tone}`}
            role={notice.tone === "error" ? "alert" : "status"}
          >
            {notice.text}
          </p>
        )}
        {tab === "add" ? (
          <section className="add-friend-section">
            <h2>Adicionar amigo</h2>
            <p>
              Você pode adicionar amigos pelo username Janja (sem espaços,
              letras minúsculas).
            </p>
            <div className="friend-search">
              <input
                value={friendQuery}
                onChange={(event) => setFriendQuery(event.target.value)}
                onKeyDown={(event) =>
                  event.key === "Enter" && void sendRequest()
                }
                placeholder="Digite um username, por exemplo: maria.silva"
              />
              <button
                className="primary-button"
                disabled={!friendQuery.trim()}
                onClick={() => void sendRequest()}
              >
                Enviar pedido de amizade
              </button>
            </div>
            {outgoing.length > 0 && (
              <section className="social-section">
                <span className="eyebrow">
                  PEDIDOS ENVIADOS — {outgoing.length}
                </span>
                {outgoing.map(({ request, profile }) => (
                  <div className="friend-row" key={request.id}>
                    <div className="friend-row-main static">
                      <Avatar person={profile} size="lg" online={false} />
                      <span className="friend-row-names">
                        <b>{profile.displayName}</b>
                        <small>@{profile.username} · pedido enviado</small>
                      </span>
                    </div>
                    <div className="friend-row-actions">
                      <button
                        className="icon-button"
                        aria-label={`Cancelar pedido para ${profile.displayName}`}
                        title="Cancelar pedido"
                        disabled={busyIds.includes(request.id)}
                        onClick={() =>
                          void withBusy(request.id, () =>
                            cancelOnlineFriendRequest(request.id),
                          )
                        }
                      >
                        <IconX size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              </section>
            )}
          </section>
        ) : tab === "pending" ? (
          <>
            <div className="friend-filter">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar"
                aria-label="Buscar nos pedidos"
              />
              <IconSearch size={18} />
            </div>
            <section className="social-section">
              <span className="eyebrow">RECEBIDOS — {incoming.length}</span>
              {incoming
                .filter(({ profile }) => matchesSearch(profile))
                .map(({ request, profile }) => (
                  <div className="friend-row" key={request.id}>
                    <div className="friend-row-main static">
                      <Avatar person={profile} size="lg" />
                      <span className="friend-row-names">
                        <b>{profile.displayName}</b>
                        <small>@{profile.username} · quer ser seu amigo</small>
                      </span>
                    </div>
                    <div className="friend-row-actions">
                      <button
                        className="icon-button accept"
                        aria-label={`Aceitar ${profile.displayName}`}
                        title="Aceitar"
                        disabled={busyIds.includes(request.id)}
                        onClick={() =>
                          void withBusy(request.id, () =>
                            respondOnlineFriend(request.id, true),
                          )
                        }
                      >
                        <IconCheck size={20} />
                      </button>
                      <button
                        className="icon-button danger-text"
                        aria-label={`Recusar ${profile.displayName}`}
                        title="Recusar"
                        disabled={busyIds.includes(request.id)}
                        onClick={() =>
                          void withBusy(request.id, () =>
                            respondOnlineFriend(request.id, false),
                          )
                        }
                      >
                        <IconX size={20} />
                      </button>
                    </div>
                  </div>
                ))}
              {incoming.length === 0 && (
                <p className="empty-copy">Nenhum pedido recebido.</p>
              )}
            </section>
            {outgoing.length > 0 && (
              <section className="social-section">
                <span className="eyebrow">ENVIADOS — {outgoing.length}</span>
                {outgoing
                  .filter(({ profile }) => matchesSearch(profile))
                  .map(({ request, profile }) => (
                    <div className="friend-row" key={request.id}>
                      <div className="friend-row-main static">
                        <Avatar person={profile} size="lg" online={false} />
                        <span className="friend-row-names">
                          <b>{profile.displayName}</b>
                          <small>@{profile.username} · pedido enviado</small>
                        </span>
                      </div>
                      <div className="friend-row-actions">
                        <button
                          className="icon-button"
                          aria-label={`Cancelar pedido para ${profile.displayName}`}
                          title="Cancelar pedido"
                          disabled={busyIds.includes(request.id)}
                          onClick={() =>
                            void withBusy(request.id, () =>
                              cancelOnlineFriendRequest(request.id),
                            )
                          }
                        >
                          <IconX size={20} />
                        </button>
                      </div>
                    </div>
                  ))}
              </section>
            )}
          </>
        ) : tab === "blocked" ? (
          <section className="social-section">
            <span className="eyebrow">BLOQUEADOS — {blocked.length}</span>
            {blocked.map((profile) => (
              <div className="friend-row" key={profile.id}>
                <div className="friend-row-main static">
                  <Avatar person={profile} size="lg" online={false} />
                  <span className="friend-row-names">
                    <b>{profile.displayName}</b>
                    <small>@{profile.username} · bloqueado</small>
                  </span>
                </div>
                <div className="friend-row-actions">
                  <button
                    className="icon-button"
                    aria-label={`Desbloquear ${profile.displayName}`}
                    title="Desbloquear"
                    disabled={busyIds.includes(`unblock:${profile.id}`)}
                    onClick={() =>
                      void withBusy(`unblock:${profile.id}`, () =>
                        unblockOnlineUser(currentUserId, profile.id),
                      )
                    }
                  >
                    <IconUserPlus size={20} />
                  </button>
                </div>
              </div>
            ))}
            {blocked.length === 0 && (
              <p className="empty-copy">Você não bloqueou ninguém.</p>
            )}
          </section>
        ) : (
          <>
            <div className="friend-filter">
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar"
                aria-label="Buscar amigos"
              />
              <IconSearch size={18} />
            </div>
            <section className="social-section">
              <span className="eyebrow">
                {tab === "online"
                  ? `ONLINE — ${visibleFriends.length}`
                  : `TODOS OS AMIGOS — ${visibleFriends.length}`}
              </span>
              {visibleFriends.map(friendRow)}
              {visibleFriends.length === 0 && (
                <p className="empty-copy">
                  {normalizedSearch
                    ? "Nenhum amigo corresponde à busca."
                    : tab === "online"
                      ? "Ninguém online no momento."
                      : "Adicione amigos pelo username na aba “Adicionar amigo”."}
                </p>
              )}
            </section>
            {recentCalls.length > 0 && (
              <section className="social-section recent-calls">
                <span className="eyebrow">CHAMADAS RECENTES</span>
                {recentCalls.map((call) => {
                  const channel = channels.find(
                    (item) => item.id === call.channelId,
                  );
                  const participantNames = [
                    ...new Set(
                      call.participants.map(
                        (participant) =>
                          profiles.find(
                            (profile) => profile.id === participant.userId,
                          )?.displayName ?? "Participante",
                      ),
                    ),
                  ];
                  return (
                    <button
                      key={call.id}
                      disabled={!channel}
                      onClick={() => channel && onChannel(channel.id)}
                    >
                      <span className="recent-call-icon">
                        <IconPhone size={16} />
                      </span>
                      <span>
                        <b>{channel?.name ?? "Canal indisponível"}</b>
                        <small>
                          {participantNames.join(", ") ||
                            "Sem participantes registrados"}
                        </small>
                      </span>
                      <time>
                        {new Date(call.createdAt).toLocaleString("pt-BR")}
                      </time>
                    </button>
                  );
                })}
              </section>
            )}
          </>
        )}
      </div>
      {newConversationOpen && (
        <NewDirectMessageModal
          onClose={() => setNewConversationOpen(false)}
          onCreated={(channelId) => {
            setNewConversationOpen(false);
            onChannel(channelId);
          }}
        />
      )}
    </main>
  );
}

function SearchModal({
  onClose,
  onChannel,
  onServer,
}: {
  onClose: () => void;
  onChannel: (id: string) => void;
  onServer: (id: string) => void;
}) {
  const [query, setQuery] = useState(""),
    [messageMatches, setMessageMatches] = useState<MessageView[]>([]),
    [searchError, setSearchError] = useState(""),
    currentUserId = useAppStore((state) => state.currentUserId),
    servers = useAppStore((state) => state.servers),
    channels = useAppStore((state) => state.channels),
    profiles = useAppStore((state) => state.profiles),
    normalized = query.trim().toLowerCase();
  const matches: Array<{
    id: string;
    label: string;
    type: "server" | "channel" | "profile";
  }> = normalized
    ? [
        ...servers
          .filter((item) => item.name.toLowerCase().includes(normalized))
          .map((item) => ({
            id: item.id,
            label: item.name,
            type: "server" as const,
          })),
        ...channels
          .filter(
            (item) =>
              item.kind !== "category" &&
              item.name.toLowerCase().includes(normalized),
          )
          .map((item) => ({
            id: item.id,
            label: item.name,
            type: "channel" as const,
          })),
        ...profiles
          .filter(
            (item) =>
              item.id !== currentUserId &&
              `${item.displayName} ${item.username}`
                .toLowerCase()
                .includes(normalized),
          )
          .map((item) => ({
            id: item.id,
            label: `${item.displayName} (@${item.username})`,
            type: "profile" as const,
          })),
      ]
    : [];
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!normalized) {
        setMessageMatches([]);
        return;
      }
      void listDecryptedOnlineMessages(
        currentUserId,
        channels.map((channel) => channel.id),
      ).then((results) => {
        if (active)
          setMessageMatches(
            results
              .filter((message) =>
                message.text.toLowerCase().includes(normalized),
              )
              .slice(0, 20),
          );
      });
    }, 150);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [channels, currentUserId, normalized]);
  const openMessage = (message: MessageView) => {
    onChannel(message.channelId);
    onClose();
    window.setTimeout(
      () =>
        document
          .getElementById(`message-${message.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      250,
    );
  };
  const openMatch = async (match: (typeof matches)[number]) => {
    setSearchError("");
    try {
      if (match.type === "server") onServer(match.id);
      if (match.type === "channel") onChannel(match.id);
      if (match.type === "profile") {
        const channelId = await createOnlineDirectChannel([match.id]);
        await hydrateOnlineWorkspace(currentUserId);
        onChannel(channelId);
      }
      onClose();
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "Não foi possível abrir o resultado.",
      );
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="search-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="search-input-wrap">
          <IconSearch size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchError("");
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowDown") return;
              event.preventDefault();
              document
                .querySelector<HTMLButtonElement>(".search-suggestions button")
                ?.focus();
            }}
            placeholder="Pesquisar servidores, canais, pessoas e mensagens decifradas"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="search-suggestions">
          <span className="eyebrow">
            {normalized ? "RESULTADOS DECIFRADOS" : "DIGITE PARA PESQUISAR"}
          </span>
          {matches.map((match) => (
            <button
              key={`${match.type}-${match.id}`}
              onClick={() => void openMatch(match)}
            >
              <b>
                {match.type === "server"
                  ? "◉"
                  : match.type === "channel"
                    ? "#"
                    : "@"}
              </b>
              <span>{match.label}</span>
            </button>
          ))}
          {messageMatches.map((message) => (
            <button
              key={`message-${message.id}`}
              onClick={() => openMessage(message)}
            >
              <b>↳</b>
              <span>
                {message.text.slice(0, 100)}
                <small>
                  {channels.find((channel) => channel.id === message.channelId)
                    ?.name ?? "canal"}
                </small>
              </span>
            </button>
          ))}
          {normalized &&
            matches.length === 0 &&
            messageMatches.length === 0 && (
              <p className="empty-copy">Nenhum resultado.</p>
            )}
          {searchError && <p role="alert">{searchError}</p>}
        </div>
      </div>
    </div>
  );
}

function InboxPanel({
  onClose,
  onChannel,
}: {
  onClose: () => void;
  onChannel: (id: string) => void;
}) {
  const [messages, setMessages] = useState<MessageView[]>([]),
    [tab, setTab] = useState<"unread" | "mentions">("unread");
  const channels = useAppStore((state) => state.channels),
    profiles = useAppStore((state) => state.profiles),
    readStates = useAppStore((state) => state.readStates),
    currentUserId = useAppStore((state) => state.currentUserId),
    currentProfile =
      profiles.find((profile) => profile.id === currentUserId) ?? profiles[0];
  useEffect(() => {
    void listDecryptedOnlineMessages(
      currentUserId,
      channels.map((channel) => channel.id),
    ).then(setMessages);
  }, [channels, currentUserId]);
  const unread = messages.filter((message) => {
    const read = readStates.find(
      (item) =>
        item.channelId === message.channelId && item.userId === currentUserId,
    );
    return (
      message.authorId !== currentUserId &&
      (!read || message.createdAt > read.lastReadAt)
    );
  });
  const visible =
    tab === "mentions"
      ? unread.filter((message) => message.mentions.includes(currentUserId))
      : unread;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="inbox-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <span className="eyebrow">ATIVIDADE</span>
            <h2>Inbox</h2>
          </div>
          <button onClick={onClose}>×</button>
        </header>
        <nav>
          <button
            className={tab === "unread" ? "active" : ""}
            onClick={() => setTab("unread")}
          >
            Não lidas ({unread.length})
          </button>
          <button
            className={tab === "mentions" ? "active" : ""}
            onClick={() => setTab("mentions")}
          >
            Menções
          </button>
        </nav>
        <div className="inbox-list">
          {visible.map((message) => {
            const author =
                profiles.find((profile) => profile.id === message.authorId) ??
                profiles[0],
              channel = channels.find((item) => item.id === message.channelId);
            return (
              <button
                key={message.id}
                onClick={() => {
                  onChannel(message.channelId);
                  onClose();
                }}
              >
                <Avatar person={author} size="sm" />
                <span>
                  <b>
                    {author.displayName}{" "}
                    <small>em #{channel?.name ?? "canal"}</small>
                  </b>
                  <em>
                    {message.text || `${message.attachments.length} anexo(s)`}
                  </em>
                </span>
                <time>
                  {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </button>
            );
          })}
          {visible.length === 0 && <p className="empty-copy">Tudo em dia.</p>}
        </div>
      </section>
    </div>
  );
}

const editablePermissionNames = [
  "VIEW_CHANNEL",
  "SEND_MESSAGES",
  "ADD_REACTIONS",
  "ATTACH_FILES",
  "READ_HISTORY",
  "MANAGE_MESSAGES",
  "PIN_MESSAGES",
  "BYPASS_SLOWMODE",
  "CONNECT",
  "SPEAK",
  "STREAM",
  "USE_VAD",
  "MUTE_MEMBERS",
  "DEAFEN_MEMBERS",
  "MOVE_MEMBERS",
  "KICK_MEMBERS",
  "BAN_MEMBERS",
  "TIMEOUT_MEMBERS",
  "MANAGE_CHANNELS",
  "MANAGE_ROLES",
  "MANAGE_SERVER",
  "VIEW_AUDIT_LOG",
  "CREATE_INVITES",
  "ADMINISTRATOR",
] as const;
const dangerousPermissions = new Set<keyof typeof Permissions>([
  "ADMINISTRATOR",
  "MANAGE_SERVER",
  "MANAGE_ROLES",
  "BAN_MEMBERS",
  "KICK_MEMBERS",
]);

/**
 * Um erro vindo do PostgREST chega como objeto simples, e o `raise exception`
 * do Postgres vira uma mensagem de uma palavra só (`forbidden`). Nenhuma das
 * duas coisas serve para mostrar na tela sem tradução.
 */
function describeRoleFailure(reason: unknown) {
  const raw =
    typeof reason === "string"
      ? reason
      : reason && typeof reason === "object"
        ? ([
            (reason as { message?: unknown }).message,
            (reason as { details?: unknown }).details,
            (reason as { hint?: unknown }).hint,
          ].find(
            (field): field is string =>
              typeof field === "string" && field.trim() !== "",
          ) ?? "")
        : "";
  if (raw.includes("cannot grant unowned permissions"))
    return "Você não pode conceder uma permissão que não possui.";
  if (raw.includes("forbidden"))
    return "Você não tem permissão para editar este cargo.";
  if (raw.includes("role icon is too long"))
    return "O ícone do cargo é longo demais.";
  if (raw.includes("invalid role name")) return "Escolha um nome para o cargo.";
  return raw || "Não foi possível salvar o cargo.";
}

function SettingsPanel({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<
      | "server"
      | "channels"
      | "roles"
      | "permissions"
      | "members"
      | "invites"
      | "bans"
      | "quota"
      | "audit"
    >("server"),
    [viewAsRole, setViewAsRole] = useState(false),
    [roleQuery, setRoleQuery] = useState(""),
    [simulatedRoleIds, setSimulatedRoleIds] = useState<string[]>([]),
    [simulationChannelId, setSimulationChannelId] = useState("");
  const server = useAppStore((state) =>
      state.servers.find((item) => item.id === serverId),
    ),
    roles = useAppStore((state) => state.roles)
      .filter((role) => role.serverId === serverId)
      .sort((a, b) => b.position - a.position),
    channels = useAppStore((state) => state.channels).filter(
      (channel) => channel.serverId === serverId && channel.kind !== "category",
    ),
    members = useAppStore((state) => state.members),
    permissionOverrides = useAppStore((state) => state.permissionOverrides),
    currentUserId = useAppStore((state) => state.currentUserId);
  const currentPermissions = serverPermissionMask(
      server,
      currentUserId,
      roles,
      members,
    ),
    hasAnyPermission = (...permissions: bigint[]) =>
      permissions.some((permission) =>
        hasPermission(currentPermissions, permission),
      ),
    visibleRoles = roles.filter((role) =>
      role.name.toLowerCase().includes(roleQuery.trim().toLowerCase()),
    ),
    availableTabs = (
      [
        { id: "server", label: "Servidor", visible: true },
        {
          id: "channels",
          label: "Canais",
          visible: hasAnyPermission(Permissions.MANAGE_CHANNELS),
        },
        {
          id: "roles",
          label: "Cargos",
          visible: hasAnyPermission(Permissions.MANAGE_ROLES),
        },
        {
          id: "permissions",
          label: "Overrides",
          visible: hasAnyPermission(Permissions.MANAGE_CHANNELS),
        },
        {
          id: "members",
          label: "Membros",
          visible: hasAnyPermission(
            Permissions.MANAGE_ROLES,
            Permissions.MANAGE_NICKNAMES,
            Permissions.MUTE_MEMBERS,
            Permissions.DEAFEN_MEMBERS,
            Permissions.MOVE_MEMBERS,
            Permissions.KICK_MEMBERS,
            Permissions.BAN_MEMBERS,
            Permissions.TIMEOUT_MEMBERS,
          ),
        },
        {
          id: "invites",
          label: "Convites",
          visible: hasAnyPermission(Permissions.CREATE_INVITES),
        },
        {
          id: "bans",
          label: "Banimentos",
          visible: hasAnyPermission(Permissions.BAN_MEMBERS),
        },
        {
          id: "quota",
          label: "Quota",
          visible: server?.ownerId === currentUserId,
        },
        {
          id: "audit",
          label: "Audit log",
          visible: hasAnyPermission(Permissions.VIEW_AUDIT_LOG),
        },
      ] as const
    ).filter((item) => item.visible),
    availableTabKey = availableTabs.map((item) => item.id).join(",");
  useEffect(() => {
    if (!availableTabs.some((item) => item.id === tab)) setTab("server");
  }, [availableTabKey, tab]);
  const [selectedRoleId, setSelectedRoleId] = useState(roles[0]?.id ?? ""),
    selectedRole = roles.find((role) => role.id === selectedRoleId) ?? roles[0],
    [draft, setDraft] = useState<Role | null>(selectedRole ?? null),
    [roleNotice, setRoleNotice] = useState(""),
    [roleError, setRoleError] = useState(""),
    [roleBusy, setRoleBusy] = useState(false);
  const { ask, confirmDialog } = useConfirm();
  const [accessBusyId, setAccessBusyId] = useState("");
  // O rascunho só é recarregado quando outro cargo é selecionado. Depender do
  // objeto fazia a reconciliação periódica do workspace (a cada 2,5 s) apagar
  // o que estava sendo digitado antes de dar tempo de salvar.
  useEffect(() => {
    setDraft(
      useAppStore.getState().roles.find((role) => role.id === selectedRole?.id)
        ? { ...selectedRole! }
        : null,
    );
    setRoleNotice("");
    setRoleError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRole?.id]);
  useEffect(() => {
    if (!simulationChannelId && channels[0])
      setSimulationChannelId(channels[0].id);
  }, [channels, simulationChannelId]);
  const simulationEveryone = roles.find((role) => role.isDefault),
    simulationRoles = roles.filter((role) =>
      simulatedRoleIds.includes(role.id),
    ),
    simulationMask = simulationEveryone
      ? resolvePermissions({
          userId: "role-simulation",
          ownerId: server?.ownerId ?? "",
          everyoneRole: {
            ...simulationEveryone,
            permissions: BigInt(simulationEveryone.permissions),
          },
          memberRoles: simulationRoles.map((role) => ({
            ...role,
            permissions: BigInt(role.permissions),
          })),
          overwrites: permissionOverrides
            .filter((item) => item.channelId === simulationChannelId)
            .map((item) => ({
              ...item,
              allow: BigInt(item.allow),
              deny: BigInt(item.deny),
            })),
        })
      : 0n;
  const simulationOrigin = (name: (typeof editablePermissionNames)[number]) => {
    const permission = Permissions[name];
    const relevantOverrides = permissionOverrides.filter(
      (item) =>
        item.channelId === simulationChannelId &&
        item.targetType === "ROLE" &&
        (item.targetId === simulationEveryone?.id ||
          simulatedRoleIds.includes(item.targetId)) &&
        ((BigInt(item.allow) & permission) !== 0n ||
          (BigInt(item.deny) & permission) !== 0n),
    );
    if (relevantOverrides.length)
      return relevantOverrides.some(
        (item) => (BigInt(item.allow) & permission) !== 0n,
      )
        ? "override do canal"
        : "negação do canal";
    const sources = [simulationEveryone, ...simulationRoles]
      .filter(
        (role): role is Role =>
          role !== undefined &&
          hasPermission(BigInt(role.permissions), permission),
      )
      .map((role) => role.name);
    return sources.join(" + ") || "sem concessão";
  };
  const togglePermission = (permission: bigint) => {
    if (!draft) return;
    const current = BigInt(draft.permissions);
    setDraft({
      ...draft,
      permissions: (hasPermission(current, permission)
        ? current & ~permission
        : current | permission
      ).toString(),
    });
  };
  const createRole = async (name: string) => {
    const roleId = await createOnlineRole(serverId, name);
    await hydrateOnlineWorkspace(currentUserId);
    setSelectedRoleId(roleId);
  };
  const storedDraftRole = roles.find((item) => item.id === draft?.id);
  const roleChanged =
    !!draft &&
    !!storedDraftRole &&
    (draft.name !== storedDraftRole.name ||
      draft.color !== storedDraftRole.color ||
      (draft.icon ?? "") !== (storedDraftRole.icon ?? "") ||
      String(draft.permissions) !== String(storedDraftRole.permissions) ||
      draft.hoist !== storedDraftRole.hoist ||
      draft.mentionable !== storedDraftRole.mentionable);
  const persistRole = async (role: Role) => {
    setRoleBusy(true);
    setRoleError("");
    setRoleNotice("");
    try {
      await updateOnlineRole(role);
      await hydrateOnlineWorkspace(currentUserId);
      setRoleNotice("Cargo salvo.");
    } catch (caught) {
      // Sem isto a falha virava um `unhandledrejection` e o usuário só via o
      // aviso genérico do topo da tela, longe do botão que ele apertou.
      setRoleError(describeRoleFailure(caught));
    } finally {
      setRoleBusy(false);
    }
  };
  // --- Acesso a canais privados por cargo -------------------------------
  // Um canal privado nega VIEW_CHANNEL para o @everyone; liberar um cargo é
  // dar a ele um override de permissão nesse canal. Antes isso só existia
  // canal a canal, no editor do canal — daqui dá para montar o cargo inteiro
  // de uma vez.
  const privateChannels = channels
    .filter((channel) => channel.private)
    .sort((a, b) => a.position - b.position);
  const accessMaskFor = (channel: Channel) =>
    channel.kind === "voice"
      ? Permissions.VIEW_CHANNEL | Permissions.CONNECT
      : Permissions.VIEW_CHANNEL;
  const overrideFor = (channelId: string, roleId: string) =>
    permissionOverrides.find(
      (item) =>
        item.channelId === channelId &&
        item.targetType === "ROLE" &&
        item.targetId === roleId,
    );
  const roleSeesChannel = (channelId: string, roleId: string) =>
    hasPermission(
      BigInt(overrideFor(channelId, roleId)?.allow ?? "0"),
      Permissions.VIEW_CHANNEL,
    );
  const toggleChannelAccess = async (channel: Channel, roleId: string) => {
    const current = overrideFor(channel.id, roleId);
    const mask = accessMaskFor(channel);
    const granting = !roleSeesChannel(channel.id, roleId);
    let allow = BigInt(current?.allow ?? "0");
    let deny = BigInt(current?.deny ?? "0");
    // Tirar o acesso é remover a concessão, não negar: negar explicitamente
    // venceria qualquer outro cargo que a pessoa tenha.
    allow = granting ? allow | mask : allow & ~mask;
    deny &= ~mask;
    setAccessBusyId(channel.id);
    setRoleError("");
    setRoleNotice("");
    try {
      await setOnlineChannelOverride(channel.id, "ROLE", roleId, allow, deny);
      await hydrateOnlineWorkspace(currentUserId);
      setRoleNotice(
        granting
          ? `Acesso a “${channel.name}” liberado.`
          : `Acesso a “${channel.name}” removido.`,
      );
    } catch (caught) {
      setRoleError(describeRoleFailure(caught));
    } finally {
      setAccessBusyId("");
    }
  };
  const saveRole = (role: Role) => {
    const previous = roles.find((item) => item.id === role.id);
    const changedDangerousPermissions = [...dangerousPermissions].filter(
      (name) =>
        hasPermission(
          BigInt(previous?.permissions ?? "0"),
          Permissions[name],
        ) !== hasPermission(BigInt(role.permissions), Permissions[name]),
    );
    if (changedDangerousPermissions.length === 0) {
      void persistRole(role);
      return;
    }
    ask({
      title: "Revisão de segurança",
      message: `Você está alterando ${changedDangerousPermissions
        .map((name) => name.replaceAll("_", " "))
        .join(", ")}. Todo mundo com este cargo passa a poder usar isso.`,
      confirmLabel: "Salvar mesmo assim",
      danger: true,
      onConfirm: () => void persistRole(role),
    });
  };
  const removeRole = async (roleId: string) => {
    await deleteOnlineRole(roleId);
    await hydrateOnlineWorkspace(currentUserId);
    setSelectedRoleId(
      useAppStore
        .getState()
        .roles.find((role) => role.serverId === serverId && role.isDefault)
        ?.id ?? "",
    );
  };
  const duplicateRole = async (roleId: string) => {
    const roleIdCopy = await duplicateOnlineRole(roleId);
    await hydrateOnlineWorkspace(currentUserId);
    setSelectedRoleId(roleIdCopy);
  };
  const reorderRole = async (roleId: string, direction: "up" | "down") => {
    await reorderOnlineRole(roleId, direction);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const ChannelPermissionsSettings = () => (
    <ChannelPermissionsSettingsView serverId={serverId} />
  );
  const MembersSettings = () => <MembersSettingsView serverId={serverId} />;
  const InvitesSettings = () => <InvitesSettingsView serverId={serverId} />;
  const BansSettings = () => <BansSettingsView serverId={serverId} />;
  const AuditSettings = () => <AuditSettingsView serverId={serverId} />;
  const QuotaSettings = () => <QuotaSettingsView serverId={serverId} />;
  return (
    <div className="modal-backdrop settings-backdrop">
      <section className="settings-panel">
        <header>
          <div>
            <span className="eyebrow">CONFIGURAÇÕES DO SERVIDOR</span>
            <h2>{server?.name ?? "Servidor local"}</h2>
          </div>
          <button className="close-settings" onClick={onClose}>
            ×
          </button>
        </header>
        <nav className="settings-tabs">
          {availableTabs.map(({ id, label }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        {tab === "server" && (
          <ServerGeneralSettings serverId={serverId} onClose={onClose} />
        )}
        {tab === "channels" && (
          <ChannelManagementSettings serverId={serverId} />
        )}
        {tab === "roles" && draft && (
          <div className="settings-content">
            <div className="roles-list">
              <div className="settings-search">
                ⌕{" "}
                <input
                  aria-label="Pesquisar cargos"
                  value={roleQuery}
                  placeholder="Pesquisar cargos"
                  onChange={(event) => setRoleQuery(event.target.value)}
                />
              </div>
              {visibleRoles.map((role) => (
                <div
                  className={`role-list-row ${draft.id === role.id ? "selected" : ""}`}
                  key={role.id}
                >
                  <button
                    className="role-item"
                    onClick={() => setSelectedRoleId(role.id)}
                  >
                    <span className="drag-handle">⠿</span>
                    <span
                      className="role-dot"
                      style={{ background: role.color }}
                    />
                    {role.icon && (
                      <span className="role-unicode-icon" aria-hidden="true">
                        {role.icon}
                      </span>
                    )}
                    <b>{role.name}</b>
                  </button>
                  {!role.isDefault && (
                    <span className="admin-inline-actions">
                      <button
                        aria-label={`Subir ${role.name}`}
                        title="Subir cargo"
                        onClick={() => void reorderRole(role.id, "up")}
                      >
                        ↑
                      </button>
                      <button
                        aria-label={`Descer ${role.name}`}
                        title="Descer cargo"
                        onClick={() => void reorderRole(role.id, "down")}
                      >
                        ↓
                      </button>
                      <button
                        aria-label={`Duplicar ${role.name}`}
                        title="Duplicar cargo"
                        onClick={() => void duplicateRole(role.id)}
                      >
                        ⧉
                      </button>
                    </span>
                  )}
                </div>
              ))}
              {visibleRoles.length === 0 && (
                <p className="empty-copy">Nenhum cargo encontrado.</p>
              )}
              <button
                className="create-role"
                onClick={() => {
                  void createRole(`Novo cargo ${roles.length}`);
                }}
              >
                ＋ Criar cargo
              </button>
            </div>
            <div className="role-editor">
              <div className="editor-top">
                <div>
                  <span className="eyebrow">
                    {draft.isDefault ? "CARGO PADRÃO" : "EDITAR CARGO"}
                  </span>
                  <h3 className="role-editor-title">
                    {draft.icon && (
                      <span className="role-unicode-icon" aria-hidden="true">
                        {draft.icon}
                      </span>
                    )}
                    <span style={{ color: draft.color }}>{draft.name}</span>
                  </h3>
                </div>
                <button
                  className="outline-button"
                  onClick={() => {
                    const opening = !viewAsRole;
                    setViewAsRole(opening);
                    if (opening && draft && !draft.isDefault)
                      setSimulatedRoleIds([draft.id]);
                  }}
                >
                  {viewAsRole ? "Fechar simulação" : "Ver como cargo"}
                </button>
              </div>
              {viewAsRole ? (
                <div className="role-simulation">
                  <h3>Simulação efetiva</h3>
                  <p>
                    Combine cargos e escolha um canal para aplicar heranças e
                    overrides.
                  </p>
                  <label>
                    Canal
                    <select
                      value={simulationChannelId}
                      onChange={(event) =>
                        setSimulationChannelId(event.target.value)
                      }
                    >
                      {channels.map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.kind === "voice" ? "◉" : "#"} {channel.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="simulation-role-picker">
                    {roles
                      .filter((role) => !role.isDefault)
                      .map((role) => (
                        <label key={role.id}>
                          <input
                            type="checkbox"
                            checked={simulatedRoleIds.includes(role.id)}
                            onChange={() =>
                              setSimulatedRoleIds((current) =>
                                current.includes(role.id)
                                  ? current.filter((id) => id !== role.id)
                                  : [...current, role.id],
                              )
                            }
                          />
                          <span
                            className="role-dot"
                            style={{ background: role.color }}
                          />
                          {role.name}
                        </label>
                      ))}
                  </div>
                  <div className="simulation-permissions">
                    {editablePermissionNames.map((name) => {
                      const allowed = hasPermission(
                        simulationMask,
                        Permissions[name],
                      );
                      return (
                        <div
                          key={name}
                          className={allowed ? "allowed" : "denied"}
                        >
                          <b>
                            {allowed ? "✓" : "×"} {name.replaceAll("_", " ")}
                          </b>
                          <small>{simulationOrigin(name)}</small>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <label>
                    Nome do cargo
                    <input
                      value={draft.name}
                      disabled={draft.isDefault}
                      onChange={(event) =>
                        setDraft({ ...draft, name: event.target.value })
                      }
                    />
                    {draft.isDefault && (
                      <small className="field-hint">
                        Todo membro do servidor tem este cargo, então o nome
                        dele é fixo. Cor, ícone e permissões podem ser
                        alterados.
                      </small>
                    )}
                  </label>
                  <div className="role-toolbar">
                    <label>
                      Cor
                      <input
                        type="color"
                        value={draft.color}
                        onChange={(event) =>
                          setDraft({ ...draft, color: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Ícone Unicode
                      <input
                        aria-label="Ícone Unicode do cargo"
                        value={draft.icon ?? ""}
                        maxLength={32}
                        placeholder="🛡️"
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            icon: event.target.value || undefined,
                          })
                        }
                      />
                    </label>
                    {!draft.isDefault && (
                      <>
                        <button
                          className="outline-button danger-text"
                          onClick={() => {
                            void removeRole(draft.id);
                          }}
                        >
                          Excluir
                        </button>
                      </>
                    )}
                  </div>
                  <div className="permission-grid">
                    {editablePermissionNames.map((name) => (
                      <button
                        key={name}
                        className={`${hasPermission(BigInt(draft.permissions), Permissions[name]) ? "permission-on" : ""} ${dangerousPermissions.has(name) ? "permission-danger" : ""}`}
                        onClick={() => togglePermission(Permissions[name])}
                      >
                        <span>{name.replaceAll("_", " ")}</span>
                        <b>
                          {hasPermission(
                            BigInt(draft.permissions),
                            Permissions[name],
                          )
                            ? "Permitir"
                            : "Herdar"}
                        </b>
                      </button>
                    ))}
                  </div>
                  <div className="role-channel-access">
                    <div className="role-channel-access-head">
                      <b>Canais privados</b>
                      <small>
                        {draft.isDefault
                          ? "É o @everyone que torna um canal privado: liberar aqui deixaria o canal aberto para todo mundo."
                          : "Marque os canais que este cargo enxerga. Vale na hora, sem passar pelo botão de salvar."}
                      </small>
                    </div>
                    {draft.isDefault ? null : privateChannels.length === 0 ? (
                      <p className="empty-copy">
                        Nenhum canal privado neste servidor.
                      </p>
                    ) : (
                      <ul>
                        {privateChannels.map((channel) => (
                          <li key={channel.id}>
                            <span>
                              <i aria-hidden="true">
                                {channel.kind === "voice"
                                  ? "◉"
                                  : channel.kind === "category"
                                    ? "▾"
                                    : "#"}
                              </i>
                              {channel.name}
                              {channel.kind === "category" && (
                                <em>categoria</em>
                              )}
                            </span>
                            <button
                              className={`toggle ${roleSeesChannel(channel.id, draft.id) ? "on" : ""}`}
                              disabled={accessBusyId === channel.id}
                              aria-pressed={roleSeesChannel(
                                channel.id,
                                draft.id,
                              )}
                              aria-label={`Acesso de ${draft.name} a ${channel.name}`}
                              onClick={() => {
                                void toggleChannelAccess(channel, draft.id);
                              }}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {/* Separar "todo mundo" do resto da lista não significa
                      nada, e o banco força `hoist = false` no cargo padrão. */}
                  {!draft.isDefault && (
                    <label className="toggle-row">
                      <span>
                        <b>Exibir separadamente</b>
                        <small>Mostra membros com este cargo no topo.</small>
                      </span>
                      <button
                        className={`toggle ${draft.hoist ? "on" : ""}`}
                        onClick={() =>
                          setDraft({ ...draft, hoist: !draft.hoist })
                        }
                      />
                    </label>
                  )}
                  <label className="toggle-row">
                    <span>
                      <b>Mencionável</b>
                      <small>Permite mencionar este cargo.</small>
                    </span>
                    <button
                      className={`toggle ${draft.mentionable ? "on" : ""}`}
                      onClick={() =>
                        setDraft({ ...draft, mentionable: !draft.mentionable })
                      }
                    />
                  </label>
                  <div className="permission-warning">
                    <span>!</span>
                    <div>
                      <b>Alterações auditadas</b>
                      <small>
                        Permissões perigosas exigem revisão explícita antes de
                        guardar.
                      </small>
                    </div>
                  </div>
                  {roleError && (
                    <div className="auth-error" role="alert">
                      {roleError}
                    </div>
                  )}
                  <div className="editor-actions">
                    <span
                      className={`action-bar-hint ${roleNotice ? "success" : ""}`}
                      role="status"
                    >
                      {roleNotice ||
                        (roleChanged ? "Alterações não salvas." : "")}
                    </span>
                    <button
                      className="outline-button"
                      disabled={roleBusy || !roleChanged}
                      onClick={() => {
                        const stored = roles.find(
                          (item) => item.id === draft.id,
                        );
                        if (stored) setDraft({ ...stored });
                        setRoleNotice("");
                        setRoleError("");
                      }}
                    >
                      Descartar
                    </button>
                    <button
                      className="primary-button"
                      disabled={roleBusy || !roleChanged}
                      onClick={() => void saveRole(draft)}
                    >
                      {roleBusy ? "Salvando…" : "Salvar alterações"}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {tab === "permissions" && <ChannelPermissionsSettings />}
        {tab === "members" && <MembersSettings />}
        {tab === "invites" && <InvitesSettings />}
        {tab === "bans" && <BansSettings />}
        {tab === "quota" && <QuotaSettings />}
        {tab === "audit" && <AuditSettings />}
      </section>
      {confirmDialog}
    </div>
  );
}

function ServerGeneralSettings({
  serverId,
  onClose,
}: {
  serverId: string;
  onClose: () => void;
}) {
  const server = useAppStore((state) =>
      state.servers.find((item) => item.id === serverId),
    ),
    members = useAppStore((state) => state.members).filter(
      (member) => member.serverId === serverId,
    ),
    serverRoles = useAppStore((state) => state.roles).filter(
      (role) => role.serverId === serverId,
    ),
    profiles = useAppStore((state) => state.profiles),
    currentUserId = useAppStore((state) => state.currentUserId),
    notificationSettings = useAppStore((state) => state.notificationSettings),
    setNotificationSetting = useAppStore(
      (state) => state.setNotificationSetting,
    ),
    clearNotificationSetting = useAppStore(
      (state) => state.clearNotificationSetting,
    );
  const [draft, setDraft] = useState<ServerProfileDraft>(() =>
      emptyServerProfileDraft({
        name: server?.name ?? "",
        description: server?.description ?? "",
        iconPreview: server?.iconUrl ?? "",
      }),
    ),
    [savingProfile, setSavingProfile] = useState(false),
    [profileError, setProfileError] = useState(""),
    [profileNotice, setProfileNotice] = useState(""),
    [nameError, setNameError] = useState(""),
    [newOwnerId, setNewOwnerId] = useState("");
  const { ask, confirmDialog } = useConfirm();
  // O rascunho acompanha o servidor: outra sessão pode ter salvo o perfil
  // enquanto esta tela estava aberta.
  // Depende do que o servidor realmente é, não da URL assinada do ícone —
  // ela é renovada de tempos em tempos e descartaria a edição em curso.
  useEffect(
    () =>
      setDraft(
        emptyServerProfileDraft({
          name: server?.name ?? "",
          description: server?.description ?? "",
          iconPreview: server?.iconUrl ?? "",
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [server?.name, server?.description, server?.iconPath],
  );
  if (!server) return <p className="empty-copy">Servidor não encontrado.</p>;
  const profileChanged =
    draft.name.trim() !== server.name ||
    draft.description.trim() !== server.description ||
    Boolean(draft.icon) ||
    (draft.removeIcon && Boolean(server.iconPath));
  const saveProfile = async () => {
    if (!draft.name.trim()) {
      setNameError("Informe um nome para o servidor.");
      return;
    }
    setNameError("");
    setSavingProfile(true);
    setProfileError("");
    setProfileNotice("");
    try {
      await updateOnlineServerProfile({
        serverId,
        name: draft.name,
        description: draft.description,
        icon: draft.icon,
        clearIcon: draft.removeIcon && !draft.icon,
        previousIconPath: server.iconPath,
      });
      await hydrateOnlineWorkspace(currentUserId);
      setProfileNotice("Perfil do servidor atualizado.");
    } catch (caught) {
      setProfileError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar o perfil do servidor.",
      );
    } finally {
      setSavingProfile(false);
    }
  };
  const owner = server.ownerId === currentUserId;
  const currentPermissions = serverPermissionMask(
      server,
      currentUserId,
      serverRoles,
      members,
    ),
    canManageServer = hasPermission(
      currentPermissions,
      Permissions.MANAGE_SERVER,
    );
  const globalNotifications = notificationSettings.find(
      (item) => item.userId === currentUserId && item.scopeType === "GLOBAL",
    ) ?? {
      mode: "ALL" as const,
      suppressEveryone: false,
      suppressRoles: false,
      mutedUntil: undefined,
    },
    serverNotifications = notificationSettings.find(
      (item) =>
        item.userId === currentUserId &&
        item.scopeType === "SERVER" &&
        item.scopeId === serverId,
    ),
    effectiveNotifications = serverNotifications ?? globalNotifications,
    serverMuted = Boolean(
      serverNotifications?.mutedUntil &&
      new Date(serverNotifications.mutedUntil).getTime() > Date.now(),
    );
  const saveServerNotifications = (
    changes: Partial<{
      mode: "ALL" | "MENTIONS" | "NONE";
      suppressEveryone: boolean;
      suppressRoles: boolean;
      mutedUntil: string;
    }>,
  ) => {
    const next = { ...effectiveNotifications, ...changes };
    setNotificationSetting({
      scopeType: "SERVER",
      scopeId: serverId,
      mode: next.mode,
      suppressEveryone: next.suppressEveryone,
      suppressRoles: next.suppressRoles,
      mutedUntil: next.mutedUntil,
    });
    if (next.mode !== "NONE") requestNotificationAccess();
  };
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">IDENTIDADE E PROPRIEDADE</span>
          <h3>Visão geral do servidor</h3>
          <p>
            {canManageServer
              ? "Edite as configurações disponíveis para a sua permissão."
              : "Ajuste suas notificações ou saia deste servidor."}
          </p>
        </div>
      </div>
      {canManageServer && (
        <div className="server-settings-grid">
          <ServerProfileFields
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setProfileNotice("");
              if (next.name.trim()) setNameError("");
            }}
            disabled={savingProfile}
            nameError={
              nameError ||
              (draft.name.length > 0 && !draft.name.trim()
                ? "O nome não pode conter apenas espaços."
                : "")
            }
          />
          {profileError && (
            <div className="auth-error" role="alert">
              {profileError}
            </div>
          )}
        </div>
      )}
      <section className="notification-settings-card">
        <div>
          <span className="eyebrow">NOTIFICAÇÕES DESTE SERVIDOR</span>
          <p>
            {serverNotifications
              ? "Esta configuração substitui a preferência global."
              : "Herdando a preferência global da conta."}
          </p>
        </div>
        <label>
          Modo
          <select
            aria-label="Notificações do servidor"
            value={serverNotifications?.mode ?? "INHERIT"}
            onChange={(event) => {
              if (event.target.value === "INHERIT")
                clearNotificationSetting("SERVER", serverId);
              else
                saveServerNotifications({
                  mode: event.target.value as "ALL" | "MENTIONS" | "NONE",
                });
            }}
          >
            <option value="INHERIT">
              Herdar global ({globalNotifications.mode})
            </option>
            <option value="ALL">Todas as mensagens</option>
            <option value="MENTIONS">Somente menções</option>
            <option value="NONE">Silenciado</option>
          </select>
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={effectiveNotifications.suppressEveryone}
            onChange={(event) =>
              saveServerNotifications({
                suppressEveryone: event.target.checked,
              })
            }
          />
          Suprimir @everyone/@here
        </label>
        <label className="check-setting">
          <input
            type="checkbox"
            checked={effectiveNotifications.suppressRoles}
            onChange={(event) =>
              saveServerNotifications({ suppressRoles: event.target.checked })
            }
          />
          Suprimir menções de cargo
        </label>
        <div className="notification-mute-actions">
          {serverMuted ? (
            <>
              <span>
                Silenciado até{" "}
                {new Date(serverNotifications!.mutedUntil!).toLocaleString(
                  "pt-BR",
                )}
              </span>
              <button
                onClick={() =>
                  saveServerNotifications({ mutedUntil: undefined })
                }
              >
                Remover silêncio
              </button>
            </>
          ) : (
            <>
              <span>Silenciar temporariamente:</span>
              {[1, 8, 24].map((hours) => (
                <button
                  key={hours}
                  onClick={() =>
                    saveServerNotifications({
                      mutedUntil: notificationMuteUntil(hours),
                    })
                  }
                >
                  {hours}h
                </button>
              ))}
            </>
          )}
        </div>
      </section>
      {owner ? (
        <div className="server-danger-zone">
          <h4>Transferir propriedade</h4>
          <select
            value={newOwnerId}
            onChange={(event) => setNewOwnerId(event.target.value)}
          >
            <option value="">Escolha um membro</option>
            {members
              .filter((member) => member.userId !== currentUserId)
              .map((member) => (
                <option key={member.userId} value={member.userId}>
                  {profiles.find((profile) => profile.id === member.userId)
                    ?.displayName ?? member.userId}
                </option>
              ))}
          </select>
          <button
            className="outline-button"
            disabled={!newOwnerId}
            onClick={() =>
              void transferOnlineServer(serverId, newOwnerId).then(() =>
                hydrateOnlineWorkspace(currentUserId),
              )
            }
          >
            Transferir
          </button>
          <h4>Zona de perigo</h4>
          <button
            className="outline-button danger-text"
            onClick={() =>
              ask({
                title: "Excluir servidor",
                message: `Canais, cargos, mensagens e convites de “${server.name}” são apagados para todos os membros. Não dá para desfazer.`,
                confirmLabel: "Excluir servidor",
                danger: true,
                requireText: server.name,
                onConfirm: () => {
                  void deleteOnlineServer(serverId).then(() => {
                    void hydrateOnlineWorkspace(currentUserId);
                    onClose();
                  });
                },
              })
            }
          >
            Excluir servidor
          </button>
        </div>
      ) : (
        <button
          className="outline-button danger-text"
          onClick={() => {
            void leaveOnlineServer(serverId).then(() => {
              void hydrateOnlineWorkspace(currentUserId);
              onClose();
            });
          }}
        >
          Sair do servidor
        </button>
      )}
      {canManageServer && (
        <div className="settings-action-bar">
          <div className="settings-action-bar-inner">
            <span
              className={`action-bar-hint ${profileNotice ? "success" : ""}`}
              role="status"
            >
              {profileNotice ||
                (profileChanged
                  ? "Você tem alterações não salvas no perfil."
                  : "")}
            </span>
            <button
              className="outline-button"
              disabled={savingProfile || !profileChanged}
              onClick={() =>
                setDraft(
                  emptyServerProfileDraft({
                    name: server.name,
                    description: server.description,
                    iconPreview: server.iconUrl ?? "",
                  }),
                )
              }
            >
              Descartar
            </button>
            <button
              className="primary-button"
              disabled={savingProfile || !profileChanged || !draft.name.trim()}
              onClick={() => void saveProfile()}
            >
              {savingProfile ? "Salvando…" : "Salvar perfil"}
            </button>
          </div>
        </div>
      )}
      {confirmDialog}
    </div>
  );
}

function ChannelManagementSettings({ serverId }: { serverId: string }) {
  const channels = useAppStore((state) => state.channels)
      .filter((channel) => channel.serverId === serverId)
      .sort((a, b) => a.position - b.position),
    roles = useAppStore((state) => state.roles).filter(
      (role) => role.serverId === serverId,
    ),
    members = useAppStore((state) => state.members).filter(
      (member) => member.serverId === serverId,
    ),
    profiles = useAppStore((state) => state.profiles),
    permissionOverrides = useAppStore((state) => state.permissionOverrides),
    currentUserId = useAppStore((state) => state.currentUserId);
  const categories = channels.filter((channel) => channel.kind === "category");
  const [setupKind, setSetupKind] = useState<NewChannelKind | null>(null);
  const [editingId, setEditingId] = useState("");
  const editingChannel = channels.find((channel) => channel.id === editingId);
  const refresh = () => hydrateOnlineWorkspace(currentUserId);
  const saveChannel = async (channel: Channel, changes: Partial<Channel>) => {
    await updateOnlineChannel({ ...channel, ...changes });
    await hydrateOnlineWorkspace(currentUserId);
  };
  const removeChannel = async (channelId: string) => {
    await deleteOnlineChannel(channelId);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const duplicateChannel = async (channelId: string) => {
    await duplicateOnlineChannel(channelId);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const reorderChannel = async (
    channelId: string,
    direction: "up" | "down",
  ) => {
    await reorderOnlineChannel(channelId, direction);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const moveToCategory = async (channelId: string, categoryId: string) => {
    await moveOnlineChannelToCategory(channelId, categoryId || undefined, true);
    await hydrateOnlineWorkspace(currentUserId);
  };
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">ESTRUTURA DO SERVIDOR</span>
          <h3>Canais</h3>
          <p>Nome, privacidade, slowmode, duplicação e ordem.</p>
        </div>
        <div className="editor-top-actions">
          <button
            className="outline-button"
            onClick={() => setSetupKind("category")}
          >
            Criar categoria
          </button>
          <button
            className="primary-button"
            onClick={() => setSetupKind("text")}
          >
            Criar canal
          </button>
        </div>
      </div>
      <div className="channel-admin-list">
        {channels.map((channel) => (
          <div className="channel-admin-row" key={channel.id}>
            <Icon>
              {channel.kind === "voice"
                ? "◉"
                : channel.kind === "category"
                  ? "▾"
                  : "#"}
            </Icon>
            <div>
              <b>{channel.name}</b>
              <small>
                {channel.kind === "category"
                  ? `Categoria · ${channel.private ? "oculta" : "visível"}`
                  : channel.private
                    ? "Privado"
                    : "Público"}
                {channel.slowmodeSeconds
                  ? ` · slowmode ${channel.slowmodeSeconds}s`
                  : ""}
                {channel.kind === "voice" && channel.userLimit
                  ? ` · limite ${channel.userLimit}`
                  : ""}
              </small>
            </div>
            <button
              className="outline-button"
              onClick={() => setEditingId(channel.id)}
            >
              Editar
            </button>
            {channel.kind !== "category" && (
              <select
                className="admin-category-select"
                aria-label={`Categoria de ${channel.name}`}
                value={channel.category}
                onChange={(event) =>
                  void moveToCategory(channel.id, event.target.value)
                }
              >
                <option value="">Sem categoria</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="outline-button"
              onClick={() =>
                void saveChannel(channel, { private: !channel.private })
              }
            >
              {channel.kind === "category"
                ? channel.private
                  ? "Exibir categoria"
                  : "Ocultar categoria"
                : channel.private
                  ? "Tornar público"
                  : "Tornar privado"}
            </button>
            <button
              className="outline-button"
              title="Subir canal"
              onClick={() => void reorderChannel(channel.id, "up")}
            >
              ↑
            </button>
            <button
              className="outline-button"
              title="Descer canal"
              onClick={() => void reorderChannel(channel.id, "down")}
            >
              ↓
            </button>
            <button
              className="outline-button"
              onClick={() => void duplicateChannel(channel.id)}
            >
              Duplicar
            </button>
            <button
              className="outline-button danger-text"
              onClick={() => void removeChannel(channel.id)}
            >
              Excluir
            </button>
          </div>
        ))}
      </div>
      {setupKind && (
        <ChannelSetupModal
          serverId={serverId}
          categories={categories}
          defaultKind={setupKind}
          onClose={() => setSetupKind(null)}
          onCreated={(channelId) => {
            setSetupKind(null);
            void refresh().then(() => setEditingId(channelId));
          }}
        />
      )}
      {editingChannel && (
        <ChannelSettingsModal
          channel={editingChannel}
          category={channels.find(
            (item) => item.id === editingChannel.category,
          )}
          roles={[...roles].sort((a, b) => b.position - a.position)}
          members={members}
          profiles={profiles}
          overrides={permissionOverrides}
          onClose={() => setEditingId("")}
          actions={{
            save: async (changes) => {
              await saveChannel(editingChannel, changes);
            },
            setOverride: async (targetType, targetId, allow, deny) => {
              await setOnlineChannelOverride(
                editingChannel.id,
                targetType,
                targetId,
                allow,
                deny,
              );
              await refresh();
            },
            syncWithCategory: async () => {
              await syncOnlineChannelWithCategory(editingChannel.id);
              await refresh();
            },
            remove: async () => {
              await removeChannel(editingChannel.id);
              setEditingId("");
            },
          }}
        />
      )}
    </div>
  );
}

function ChannelPermissionsSettingsView({ serverId }: { serverId: string }) {
  const channels = useAppStore((state) => state.channels).filter(
      (channel) => channel.serverId === serverId,
    ),
    roles = useAppStore((state) => state.roles).filter(
      (role) => role.serverId === serverId,
    ),
    members = useAppStore((state) => state.members).filter(
      (member) => member.serverId === serverId,
    ),
    profiles = useAppStore((state) => state.profiles),
    overrides = useAppStore((state) => state.permissionOverrides),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? ""),
    [targetType, setTargetType] = useState<"ROLE" | "MEMBER">("ROLE"),
    [targetId, setTargetId] = useState(
      roles.find((role) => role.isDefault)?.id ?? roles[0]?.id ?? "",
    );
  useEffect(() => {
    const valid =
      targetType === "ROLE"
        ? roles.some((role) => role.id === targetId)
        : members.some((member) => member.userId === targetId);
    if (!valid)
      setTargetId(
        targetType === "ROLE"
          ? (roles.find((role) => role.isDefault)?.id ?? roles[0]?.id ?? "")
          : (members[0]?.userId ?? ""),
      );
  }, [members, roles, targetId, targetType]);
  const override = overrides.find(
    (item) =>
      item.channelId === channelId &&
      item.targetType === targetType &&
      item.targetId === targetId,
  );
  const permissionState = (permission: bigint) =>
    hasPermission(BigInt(override?.allow ?? "0"), permission)
      ? "allow"
      : hasPermission(BigInt(override?.deny ?? "0"), permission)
        ? "deny"
        : "inherit";
  const names = editablePermissionNames;
  const setChannelPermission = async (
    permission: bigint,
    nextState: "inherit" | "allow" | "deny",
  ) => {
    let allow = BigInt(override?.allow ?? "0") & ~permission;
    let deny = BigInt(override?.deny ?? "0") & ~permission;
    if (nextState === "allow") allow |= permission;
    if (nextState === "deny") deny |= permission;
    await setOnlineChannelOverride(
      channelId,
      targetType,
      targetId,
      allow,
      deny,
    );
    await hydrateOnlineWorkspace(currentUserId);
  };
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">ALLOW · DENY · INHERIT</span>
          <h3>Overrides de canal</h3>
          <p>
            Overrides de cargo e membro são aplicados depois das permissões
            base.
          </p>
        </div>
      </div>
      <div className="override-selectors">
        <label>
          Canal
          <select
            value={channelId}
            onChange={(event) => setChannelId(event.target.value)}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.kind === "voice" ? "◉" : "#"} {channel.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Alvo
          <select
            value={targetType}
            onChange={(event) =>
              setTargetType(event.target.value as "ROLE" | "MEMBER")
            }
          >
            <option value="ROLE">Cargo</option>
            <option value="MEMBER">Membro</option>
          </select>
        </label>
        <label>
          {targetType === "ROLE" ? "Cargo" : "Membro"}
          <select
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
          >
            {targetType === "ROLE"
              ? roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))
              : members.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {profiles.find((profile) => profile.id === member.userId)
                      ?.displayName ?? member.userId}
                  </option>
                ))}
          </select>
        </label>
      </div>
      <div className="override-grid">
        {names.map((name) => {
          const state = permissionState(Permissions[name]);
          return (
            <div className="override-row" key={name}>
              <span>{name.replaceAll("_", " ")}</span>
              <div>
                <button
                  className={state === "inherit" ? "selected inherit" : ""}
                  onClick={() =>
                    void setChannelPermission(Permissions[name], "inherit")
                  }
                >
                  / Herdar
                </button>
                <button
                  className={state === "allow" ? "selected allow" : ""}
                  onClick={() =>
                    void setChannelPermission(Permissions[name], "allow")
                  }
                >
                  ✓ Permitir
                </button>
                <button
                  className={state === "deny" ? "selected deny" : ""}
                  onClick={() =>
                    void setChannelPermission(Permissions[name], "deny")
                  }
                >
                  × Negar
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MembersSettingsView({ serverId }: { serverId: string }) {
  const [query, setQuery] = useState(""),
    [roleFilter, setRoleFilter] = useState(""),
    [voiceChannelId, setVoiceChannelId] = useState(""),
    [actionError, setActionError] = useState("");
  const profiles = useAppStore((state) => state.profiles),
    members = useAppStore((state) => state.members),
    roles = useAppStore((state) => state.roles),
    channels = useAppStore((state) => state.channels),
    server = useAppStore((state) =>
      state.servers.find((item) => item.id === serverId),
    ),
    currentUserId = useAppStore((state) => state.currentUserId);
  const currentPermissions = serverPermissionMask(
      server,
      currentUserId,
      roles,
      members,
    ),
    can = (permission: bigint) => hasPermission(currentPermissions, permission),
    canManageRoles = can(Permissions.MANAGE_ROLES),
    canManageNicknames = can(Permissions.MANAGE_NICKNAMES),
    canChangeNickname = can(Permissions.CHANGE_NICKNAME),
    canMuteMembers = can(Permissions.MUTE_MEMBERS),
    canDeafenMembers = can(Permissions.DEAFEN_MEMBERS),
    canMoveMembers = can(Permissions.MOVE_MEMBERS),
    canTimeoutMembers = can(Permissions.TIMEOUT_MEMBERS),
    canKickMembers = can(Permissions.KICK_MEMBERS),
    canBanMembers = can(Permissions.BAN_MEMBERS),
    canModerateVoice = canMuteMembers || canDeafenMembers || canMoveMembers;
  const voiceChannels = channels.filter(
    (channel) => channel.serverId === serverId && channel.kind === "voice",
  );
  useEffect(() => {
    if (!voiceChannels.some((channel) => channel.id === voiceChannelId))
      setVoiceChannelId(voiceChannels[0]?.id ?? "");
  }, [voiceChannelId, voiceChannels]);
  const setMemberRole = async (
    userId: string,
    roleId: string,
    assign: boolean,
  ) => {
    await setOnlineMemberRole(serverId, userId, roleId, assign);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const updateNickname = async (userId: string, currentNickname = "") => {
    const nickname = window.prompt(
      "Nickname no servidor (vazio remove)",
      currentNickname,
    );
    if (nickname === null) return;
    await updateOnlineMemberNickname(serverId, userId, nickname);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const moderate = async (
    userId: string,
    action: "kick" | "ban" | "timeout",
    reason?: string,
  ) => {
    await moderateOnlineMember(serverId, userId, action, reason, 10);
    await hydrateOnlineWorkspace(currentUserId);
  };
  const moderateVoice = async (
    userId: string,
    action: "mute" | "unmute" | "deafen" | "undeafen" | "disconnect" | "move",
    destinationChannelId?: string,
  ) => {
    setActionError("");
    try {
      await moderateOnlineVoice(
        voiceChannelId,
        userId,
        action,
        destinationChannelId,
      );
      await hydrateOnlineWorkspace(currentUserId);
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível moderar a chamada.",
      );
    }
  };
  const serverRoles = roles
    .filter((role) => role.serverId === serverId)
    .sort((a, b) => b.position - a.position);
  const visibleMembers = members
    .filter((member) => member.serverId === serverId)
    .filter((member) => !roleFilter || member.roleIds.includes(roleFilter))
    .filter((member) => {
      const profile = profiles.find((item) => item.id === member.userId);
      return (
        !query ||
        `${profile?.displayName} ${profile?.username}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    });
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">GESTÃO SINCRONIZADA</span>
          <h3>Membros</h3>
          <p>Ações privilegiadas geram entradas estruturadas no audit log.</p>
        </div>
        <input
          className="admin-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pesquisar membro"
        />
        <select
          className="admin-search"
          value={roleFilter}
          onChange={(event) => setRoleFilter(event.target.value)}
        >
          <option value="">Todos os cargos</option>
          {serverRoles
            .filter((role) => !role.isDefault)
            .map((role) => (
              <option value={role.id} key={role.id}>
                {role.name}
              </option>
            ))}
        </select>
        {canModerateVoice && (
          <select
            className="admin-search"
            aria-label="Canal de voz para moderação"
            value={voiceChannelId}
            onChange={(event) => setVoiceChannelId(event.target.value)}
          >
            {voiceChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                ◉ {channel.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {actionError && (
        <div className="auth-error" role="alert">
          {actionError}
        </div>
      )}
      {visibleMembers.map((member) => {
        const profile = profiles.find((item) => item.id === member.userId)!;
        const assignedRoles = serverRoles.filter((item) =>
          member.roleIds.includes(item.id),
        );
        const self = member.userId === currentUserId;
        return (
          <div className="member-admin-row" key={member.userId}>
            <Avatar person={profile} size="md" />
            <div className="member-admin-identity">
              <b>{member.nickname || profile.displayName}</b>
              <small>
                @{profile.username} · entrou{" "}
                {new Date(member.joinedAt).toLocaleDateString("pt-BR")}
                {member.joinSource ? ` · ${member.joinSource}` : ""}
                {member.communicationDisabledUntil
                  ? ` · timeout até ${new Date(member.communicationDisabledUntil).toLocaleTimeString("pt-BR")}`
                  : ""}
                {member.serverMuted ? " · mute do servidor" : ""}
                {member.serverDeafened ? " · surdez do servidor" : ""}
              </small>
              {canManageRoles && (
                <span className="member-role-actions">
                  {assignedRoles.map((role) => (
                    <button
                      key={role.id}
                      style={{ color: role.color }}
                      title={`Remover ${role.name}`}
                      onClick={() =>
                        void setMemberRole(member.userId, role.id, false)
                      }
                    >
                      {role.name} ×
                    </button>
                  ))}
                </span>
              )}
            </div>
            <div className="member-admin-actions">
              {canManageRoles && (
                <select
                  className="admin-role-select"
                  value=""
                  aria-label={`Adicionar cargo a ${profile.displayName}`}
                  onChange={(event) => {
                    if (event.target.value)
                      void setMemberRole(
                        member.userId,
                        event.target.value,
                        true,
                      );
                  }}
                >
                  <option value="">+ Cargo</option>
                  {serverRoles
                    .filter(
                      (role) =>
                        !role.isDefault && !member.roleIds.includes(role.id),
                    )
                    .map((role) => (
                      <option value={role.id} key={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              )}
              {(canManageNicknames || (self && canChangeNickname)) && (
                <button
                  className="outline-button"
                  onClick={() =>
                    void updateNickname(member.userId, member.nickname)
                  }
                >
                  Nickname
                </button>
              )}
              {canMuteMembers && (
                <button
                  className="outline-button"
                  disabled={self || !voiceChannelId}
                  onClick={() =>
                    void moderateVoice(
                      member.userId,
                      member.serverMuted ? "unmute" : "mute",
                    )
                  }
                >
                  {member.serverMuted ? "Desmutar" : "Mutar voz"}
                </button>
              )}
              {canDeafenMembers && (
                <button
                  className="outline-button"
                  disabled={self || !voiceChannelId}
                  onClick={() =>
                    void moderateVoice(
                      member.userId,
                      member.serverDeafened ? "undeafen" : "deafen",
                    )
                  }
                >
                  {member.serverDeafened ? "Ouvir" : "Ensurdecer"}
                </button>
              )}
              {canMoveMembers && (
                <>
                  <select
                    className="admin-role-select"
                    value=""
                    disabled={self || !voiceChannelId}
                    aria-label={`Mover ${profile.displayName} para outro canal de voz`}
                    onChange={(event) => {
                      if (event.target.value)
                        void moderateVoice(
                          member.userId,
                          "move",
                          event.target.value,
                        );
                    }}
                  >
                    <option value="">Mover para…</option>
                    {voiceChannels
                      .filter((channel) => channel.id !== voiceChannelId)
                      .map((channel) => (
                        <option key={channel.id} value={channel.id}>
                          {channel.name}
                        </option>
                      ))}
                  </select>
                  <button
                    className="outline-button"
                    disabled={self || !voiceChannelId}
                    onClick={() =>
                      void moderateVoice(member.userId, "disconnect")
                    }
                  >
                    Desconectar voz
                  </button>
                </>
              )}
              {canTimeoutMembers && (
                <button
                  className="outline-button"
                  disabled={self}
                  onClick={() => {
                    const reason =
                      window.prompt("Motivo do timeout") ?? undefined;
                    void moderate(member.userId, "timeout", reason);
                  }}
                >
                  Timeout
                </button>
              )}
              {canKickMembers && (
                <button
                  className="outline-button"
                  disabled={self}
                  onClick={() => {
                    const reason =
                      window.prompt("Motivo da remoção") ?? undefined;
                    void moderate(member.userId, "kick", reason);
                  }}
                >
                  Kick
                </button>
              )}
              {canBanMembers && (
                <button
                  className="outline-button danger-text"
                  disabled={self}
                  onClick={() => {
                    const reason =
                      window.prompt("Motivo do banimento") ?? undefined;
                    void moderate(member.userId, "ban", reason);
                  }}
                >
                  Ban
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function InvitesSettingsView({ serverId }: { serverId: string }) {
  const invites = useAppStore((state) => state.invites).filter(
      (item) => item.serverId === serverId,
    ),
    channels = useAppStore((state) => state.channels).filter(
      (item) => item.serverId === serverId,
    ),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const createInvite = async (
    channelId: string,
    minutes?: number,
    maxUses?: number,
  ) => {
    setBusy(true);
    setError("");
    try {
      await createOnlineInvite(serverId, channelId, minutes, maxUses);
      await hydrateOnlineWorkspace(currentUserId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao criar convite.",
      );
    } finally {
      setBusy(false);
    }
  };
  const revokeInvite = async (inviteId: string) => {
    setBusy(true);
    setError("");
    try {
      await revokeOnlineInvite(inviteId);
      await hydrateOnlineWorkspace(currentUserId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Falha ao revogar convite.",
      );
    } finally {
      setBusy(false);
    }
  };
  const [channelId, setChannelId] = useState(
      channels.find((item) => item.kind === "text")?.id ??
        channels[0]?.id ??
        "",
    ),
    [minutes, setMinutes] = useState(60),
    [maxUses, setMaxUses] = useState(10),
    [copiedCode, setCopiedCode] = useState("");

  const copyInvite = async (code: string) => {
    try {
      await navigator.clipboard.writeText(inviteUrl(code));
      setCopiedCode(code);
      window.setTimeout(() => setCopiedCode(""), 2_000);
    } catch {
      // Área de transferência negada: o link está visível na tela e pode ser
      // selecionado à mão, então não vale interromper nada por isso.
    }
  };
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">ACESSO AO SERVIDOR</span>
          <h3>Convites</h3>
          <p>
            Expiração, limite de usos e revogação sincronizados pelo servidor
            local.
          </p>
        </div>
        <button
          className="primary-button"
          disabled={busy || !channelId}
          onClick={() => void createInvite(channelId, minutes, maxUses)}
        >
          Criar convite
        </button>
      </div>
      {error && (
        <div className="auth-error" role="alert">
          {error}
        </div>
      )}
      <div className="invite-controls">
        <select
          value={channelId}
          onChange={(event) => setChannelId(event.target.value)}
        >
          {channels.map((channel) => (
            <option value={channel.id} key={channel.id}>
              #{channel.name}
            </option>
          ))}
        </select>
        <label>
          Expira em
          <input
            type="number"
            min="1"
            value={minutes}
            onChange={(event) => setMinutes(Number(event.target.value))}
          />{" "}
          min
        </label>
        <label>
          Máx. usos
          <input
            type="number"
            min="1"
            value={maxUses}
            onChange={(event) => setMaxUses(Number(event.target.value))}
          />
        </label>
      </div>
      {invites.map((invite) => (
        <div
          className={`invite-row ${invite.revokedAt ? "revoked" : ""}`}
          key={invite.id}
        >
          <code>{inviteUrl(invite.code)}</code>
          <span>
            {invite.uses}/{invite.maxUses ?? "∞"} usos ·{" "}
            {invite.expiresAt
              ? `expira ${new Date(invite.expiresAt).toLocaleString("pt-BR")}`
              : "sem expiração"}
          </span>
          <button
            className="outline-button"
            disabled={Boolean(invite.revokedAt)}
            onClick={() => void copyInvite(invite.code)}
          >
            {copiedCode === invite.code ? "Copiado" : "Copiar link"}
          </button>
          <button
            className="outline-button"
            disabled={Boolean(invite.revokedAt)}
            onClick={() => void revokeInvite(invite.id)}
          >
            {invite.revokedAt ? "Revogado" : "Revogar"}
          </button>
        </div>
      ))}
    </div>
  );
}

function BansSettingsView({ serverId }: { serverId: string }) {
  const bans = useAppStore((state) => state.bans).filter(
      (item) => item.serverId === serverId,
    ),
    profiles = useAppStore((state) => state.profiles),
    currentUserId = useAppStore((state) => state.currentUserId);
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">MODERAÇÃO</span>
          <h3>Banimentos</h3>
          <p>{bans.length} utilizador(es) impedido(s) de entrar.</p>
        </div>
      </div>
      {bans.map((ban) => {
        const profile = profiles.find((item) => item.id === ban.userId);
        return (
          <div className="member-admin-row" key={ban.id}>
            <Avatar
              person={profile ?? unknownPerson(ban.userId)}
              size="md"
              online={false}
            />
            <div>
              <b>{profile?.displayName ?? ban.userId}</b>
              <small>
                {ban.reason ?? "Sem motivo"} ·{" "}
                {new Date(ban.createdAt).toLocaleString("pt-BR")}
              </small>
            </div>
            <button
              className="outline-button"
              onClick={() =>
                void unbanOnlineMember(ban.serverId, ban.userId).then(() =>
                  hydrateOnlineWorkspace(currentUserId),
                )
              }
            >
              Revogar ban
            </button>
          </div>
        );
      })}
      {bans.length === 0 && <p className="empty-copy">Nenhum banimento.</p>}
    </div>
  );
}

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
};

function QuotaSettingsView({ serverId }: { serverId: string }) {
  const server = useAppStore((state) =>
      state.servers.find((item) => item.id === serverId),
    ),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [quota, setQuota] = useState<OnlineQuotaStatus | null>(null),
    [serverQuota, setServerQuota] = useState<ServerQuotaStatus | null>(null),
    [error, setError] = useState(""),
    [pruning, setPruning] = useState(false),
    [pruneResult, setPruneResult] = useState(""),
    [loading, setLoading] = useState(false);
  const confirm = useConfirm();
  const owner = server?.ownerId === currentUserId;
  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const [instance, ofServer] = await Promise.all([
        getOnlineQuotaStatus(),
        getServerQuotaStatus(serverId),
      ]);
      setQuota(instance);
      setServerQuota(ofServer);
      return;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Falha ao medir a instância.",
      );
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    if (owner) void load();
    // A medição é explícita e não precisa de polling permanente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  if (!owner)
    return (
      <div className="settings-content single-content">
        <p className="empty-copy">
          Apenas proprietários de servidor podem ver o uso total desta
          instância.
        </p>
      </div>
    );
  const metrics = quota
    ? [
        {
          id: "database",
          label: "Banco PostgreSQL",
          used: quota.databaseUsedBytes,
          limit: quota.databaseLimitBytes,
          percent: quota.databasePercent,
          level: quota.databaseLevel,
        },
        {
          id: "storage",
          label: "Arquivos no Storage",
          used: quota.storageUsedBytes,
          limit: quota.storageLimitBytes,
          percent: quota.storagePercent,
          level: quota.storageLevel,
        },
      ]
    : [];
  return (
    <div className="settings-content single-content quota-dashboard">
      <div className="editor-top">
        <div>
          <span className="eyebrow">CAPACIDADE REAL DA INSTÂNCIA</span>
          <h3>Banco e armazenamento</h3>
          <p>
            Avisos mudam em 70%, 85% e 95%. Os limites são configurados pelo
            operador da implantação, não estimados pelo cliente.
          </p>
        </div>
        <button
          className="outline-button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Medindo…" : "Atualizar"}
        </button>
      </div>
      {error && (
        <p className="profile-notice" role="alert">
          {error}
        </p>
      )}
      <div className="quota-cards">
        {metrics.map((metric) => (
          <article
            key={metric.id}
            className={`quota-card quota-${metric.level.toLowerCase()}`}
          >
            <header>
              <b>{metric.label}</b>
              <span>{metric.level}</span>
            </header>
            <strong>{metric.percent.toFixed(2)}%</strong>
            <div
              className="quota-progress"
              role="progressbar"
              aria-label={`Uso de ${metric.label}`}
              aria-valuenow={metric.percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i style={{ width: `${Math.min(100, metric.percent)}%` }} />
            </div>
            <small>
              {formatBytes(metric.used)} de {formatBytes(metric.limit)}
            </small>
          </article>
        ))}
      </div>
      {serverQuota && (
        <div
          className={`server-quota quota-${serverQuota.level.toLowerCase()}`}
        >
          <div className="editor-top">
            <div>
              <span className="eyebrow">FATIA DESTE SERVIDOR</span>
              <h3>
                {formatBytes(serverQuota.usedBytes)} de{" "}
                {formatBytes(serverQuota.shareBytes)} ·{" "}
                {serverQuota.percent.toFixed(1)}%
              </h3>
              <p>
                A fatia é o teto da instância dividido pelo número de
                servidores, então ela encolhe quando alguém cria um servidor
                novo. São {serverQuota.messageCount.toLocaleString("pt-BR")}{" "}
                mensagens
                {serverQuota.oldestMessageAt
                  ? `, a mais antiga de ${new Date(serverQuota.oldestMessageAt).toLocaleDateString("pt-BR")}`
                  : ""}
                .
              </p>
            </div>
          </div>
          <div
            className="quota-progress"
            role="progressbar"
            aria-label="Uso deste servidor"
            aria-valuenow={serverQuota.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <i style={{ width: `${Math.min(100, serverQuota.percent)}%` }} />
          </div>
          {serverQuota.level !== "OK" && (
            <p className="quota-warning" role="alert">
              {serverQuota.level === "CRITICAL"
                ? "Este servidor passou de 95% da fatia dele. Libere espaço antes que envios comecem a ser recusados."
                : "Este servidor está consumindo mais que o esperado. Vale liberar espaço."}
            </p>
          )}
          <button
            className="outline-button"
            disabled={pruning || serverQuota.usedBytes === 0}
            onClick={() =>
              confirm.ask({
                title: "Limpar mensagens antigas",
                message:
                  "As mensagens mais antigas deste servidor serão apagadas até ele voltar a 70% da fatia. Mensagens fixadas são preservadas, e o que sair não volta.",
                confirmLabel: "Limpar",
                danger: true,
                onConfirm: () => {
                  void (async () => {
                    setPruning(true);
                    setPruneResult("");
                    try {
                      const result = await pruneOnlineServerMessages(serverId);
                      setPruneResult(
                        result.deletedCount === 0
                          ? "Nada a limpar: o servidor já cabe na fatia."
                          : `${result.deletedCount.toLocaleString("pt-BR")} mensagens apagadas, ${formatBytes(result.freedBytes)} liberados.`,
                      );
                      await load();
                    } catch (caught) {
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "Falha ao limpar as mensagens.",
                      );
                    } finally {
                      setPruning(false);
                    }
                  })();
                },
              })
            }
          >
            {pruning ? "Limpando…" : "Limpar mensagens antigas"}
          </button>
          {pruneResult && <p className="profile-notice">{pruneResult}</p>}
        </div>
      )}
      {quota && (
        <small className="quota-measured-at">
          Medido em {new Date(quota.measuredAt).toLocaleString("pt-BR")}
        </small>
      )}
      {confirm.confirmDialog}
    </div>
  );
}

function AuditSettingsView({ serverId }: { serverId: string }) {
  const [query, setQuery] = useState("");
  const auditLogs = useAppStore((state) => state.auditLogs),
    profiles = useAppStore((state) => state.profiles);
  const entries = auditLogs
    .filter((entry) => entry.serverId === serverId)
    .filter((entry) => {
      const actor = profiles.find((profile) => profile.id === entry.actorId);
      return `${entry.action} ${entry.targetType} ${entry.targetId} ${entry.reason ?? ""} ${actor?.displayName ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase());
    });
  return (
    <div className="settings-content single-content">
      <div className="editor-top">
        <div>
          <span className="eyebrow">SEGURANÇA LOCAL</span>
          <h3>Audit log</h3>
          <p>{entries.length} operações administrativas registradas.</p>
        </div>
        <input
          className="admin-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar ação, alvo, autor ou motivo"
        />
      </div>
      {entries.map((entry) => {
        const actor =
          profiles.find((profile) => profile.id === entry.actorId) ??
          profiles[0];
        return (
          <div className="audit-row" key={entry.id}>
            <Avatar person={actor} size="sm" online={false} />
            <div>
              <b>{actor.displayName}</b>
              <span>
                {entry.action} · {entry.targetType}
              </span>
              {entry.reason && <small>Motivo: {entry.reason}</small>}
              {Object.keys(entry.changes ?? {}).length > 0 && (
                <details className="audit-changes">
                  <summary>Antes/depois e metadados</summary>
                  <pre>{JSON.stringify(entry.changes, null, 2)}</pre>
                </details>
              )}
            </div>
            <small>{new Date(entry.createdAt).toLocaleString("pt-BR")}</small>
          </div>
        );
      })}
    </div>
  );
}

function ProfilePanel({
  account,
  onClose,
  onLogout,
}: {
  account: AppAccount;
  onClose: () => void;
  onLogout: () => void;
}) {
  const profiles = useAppStore((state) => state.profiles),
    currentUserId = useAppStore((state) => state.currentUserId),
    notificationSettings = useAppStore((state) => state.notificationSettings),
    privacySettings = useAppStore((state) => state.privacySettings),
    accessibility = useAppStore((state) => state.accessibility),
    setAccessibility = useAppStore((state) => state.setAccessibility),
    setNotificationSetting = useAppStore(
      (state) => state.setNotificationSetting,
    ),
    profile = profiles.find((item) => item.id === currentUserId) ?? profiles[0];
  const globalNotifications = notificationSettings.find(
    (item) => item.userId === currentUserId && item.scopeType === "GLOBAL",
  ) ?? {
    mode: "ALL" as const,
    suppressEveryone: false,
    suppressRoles: false,
    mutedUntil: undefined,
  };
  const globalNotificationsMuted = Boolean(
    globalNotifications.mutedUntil &&
    new Date(globalNotifications.mutedUntil).getTime() > Date.now(),
  );
  const privacy = privacySettings.find(
    (setting) => setting.userId === currentUserId,
  ) ?? {
    dmPolicy: "FRIENDS" as const,
    friendRequestPolicy: "EVERYONE" as const,
    profileVisible: true,
  };
  const [name, setName] = useState(profile.displayName),
    [username, setUsername] = useState(profile.username),
    [bio, setBio] = useState(profile.bio),
    [pronouns, setPronouns] = useState(profile.pronouns),
    [customStatus, setCustomStatus] = useState(profile.customStatus),
    [presence, setPresence] = useState<Profile["status"]>(
      profile.preferredStatus,
    ),
    [cropTarget, setCropTarget] = useState<{
      kind: "avatar" | "banner";
      file: File;
    } | null>(null),
    [mediaBusy, setMediaBusy] = useState(false),
    [mediaNotice, setMediaNoticeState] = useState<{
      tone: "success" | "error";
      text: string;
    } | null>(null),
    [devices, setDevices] = useState<OnlineDevice[]>([]),
    [authSessions, setAuthSessions] = useState<OnlineAuthSession[]>([]),
    [currentDeviceId, setCurrentDeviceId] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [securityNotice, setSecurityNotice] = useState(""),
    [updateState, setUpdateState] = useState<JanjaUpdateState | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        const engine = await getMlsEngine(account.profileId);
        const [nextDevices, nextSessions] = await Promise.all([
          listOnlineDevices(account.profileId),
          listOnlineAccountSessions(),
        ]);
        setCurrentDeviceId(engine.deviceId);
        setDevices(nextDevices);
        setAuthSessions(nextSessions);
        const current = nextDevices.find(
          (device) => device.id === engine.deviceId,
        );
        if (current)
          setSecurityNotice(
            `Fingerprint deste dispositivo: ${current.fingerprint.slice(0, 16)}`,
          );
      } catch (caught) {
        setSecurityNotice(
          caught instanceof Error
            ? caught.message
            : "Falha ao carregar dispositivos.",
        );
      }
    })();
  }, [account.profileId]);
  useEffect(() => {
    if (!window.janjaDesktop) return;
    void window.janjaDesktop.updateStatus().then(setUpdateState);
    return window.janjaDesktop.onUpdateState(setUpdateState);
  }, []);
  const changePassword = async () => {
    try {
      await updateOnlinePassword(newPassword);
      setNewPassword("");
      setSecurityNotice("Senha alterada; outras sessões foram encerradas.");
    } catch (error) {
      setSecurityNotice(
        error instanceof Error ? error.message : "Falha ao alterar senha.",
      );
    }
  };
  const revoke = async (deviceId: string) => {
    try {
      if (deviceId === currentDeviceId)
        throw new Error("Não é possível revogar o dispositivo em uso.");
      await revokeOnlineDevice(deviceId);
      setDevices(await listOnlineDevices(account.profileId));
      setSecurityNotice(
        "Dispositivo revogado. Os grupos OpenMLS removem a identidade na próxima sincronização do fundador.",
      );
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error
          ? caught.message
          : "Falha ao revogar dispositivo.",
      );
    }
  };
  const revokeSession = async (sessionId: string) => {
    try {
      await revokeOnlineAccountSession(sessionId);
      setAuthSessions(await listOnlineAccountSessions());
      setSecurityNotice("Sessão da conta encerrada.");
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error ? caught.message : "Falha ao encerrar sessão.",
      );
    }
  };
  const revokeOtherSessions = async () => {
    try {
      const count = await revokeOtherOnlineAccountSessions();
      setAuthSessions(await listOnlineAccountSessions());
      setSecurityNotice(
        `${count} ${count === 1 ? "sessão encerrada" : "sessões encerradas"}.`,
      );
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error
          ? caught.message
          : "Falha ao encerrar outras sessões.",
      );
    }
  };
  const verifyDevice = async (deviceId: string) => {
    const code = window.prompt(
      "Digite o código de 20 caracteres mostrado no outro dispositivo",
    );
    if (code === null) return;
    try {
      await verifyOnlineDevice(deviceId, code);
      setDevices(await listOnlineDevices(account.profileId));
      setSecurityNotice("Dispositivo verificado por comparação de código.");
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error
          ? caught.message
          : "O código de verificação não confere.",
      );
    }
  };
  const saveProfile = async () => {
    try {
      await saveOnlineProfile(currentUserId, {
        username,
        displayName: name.trim() || profile.displayName,
        bio,
        pronouns,
        customStatus,
        presence,
      });
      await hydrateOnlineWorkspace(currentUserId);
      setSecurityNotice("Perfil salvo no servidor local.");
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error ? caught.message : "Falha ao salvar perfil.",
      );
    }
  };
  const chooseMedia = (kind: "avatar" | "banner", file: File | null) => {
    if (!file) return;
    setMediaNoticeState(null);
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    if (!allowed.includes(file.type)) {
      setMediaNoticeState({
        tone: "error",
        text: "Formato inválido. Use JPEG, PNG, WebP ou GIF.",
      });
      return;
    }
    const maxBytes = kind === "avatar" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      setMediaNoticeState({
        tone: "error",
        text: `Arquivo grande demais. O limite é ${maxBytes / 1024 / 1024} MB.`,
      });
      return;
    }
    setCropTarget({ kind, file });
  };
  const uploadCroppedMedia = async (blob: Blob) => {
    if (!cropTarget || mediaBusy) return;
    setMediaBusy(true);
    try {
      const extension = blob.type === "image/png" ? "png" : "jpg";
      const upload = new File([blob], `${cropTarget.kind}.${extension}`, {
        type: blob.type,
      });
      await uploadOnlineProfileMedia(currentUserId, cropTarget.kind, upload);
      await hydrateOnlineWorkspace(currentUserId);
      setCropTarget(null);
      setMediaNoticeState({
        tone: "success",
        text:
          cropTarget.kind === "avatar"
            ? "Avatar atualizado."
            : "Banner atualizado.",
      });
    } catch (caught) {
      setMediaNoticeState({
        tone: "error",
        text:
          caught instanceof Error
            ? caught.message
            : "Falha ao enviar a imagem.",
      });
    } finally {
      setMediaBusy(false);
    }
  };
  const savePrivacy = async (
    changes: Parameters<typeof saveOnlinePrivacy>[1],
  ) => {
    try {
      await saveOnlinePrivacy(currentUserId, changes);
      await hydrateOnlineWorkspace(currentUserId);
    } catch (caught) {
      setSecurityNotice(
        caught instanceof Error
          ? caught.message
          : "Falha ao salvar privacidade.",
      );
    }
  };
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="profile-panel account-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="close-settings"
          aria-label="Fechar perfil"
          onClick={onClose}
        >
          <IconX size={20} />
        </button>
        <div
          className="profile-banner-preview"
          style={
            profile.bannerUrl
              ? { backgroundImage: `url(${profile.bannerUrl})` }
              : undefined
          }
        >
          <Avatar person={profile} size="xl" />
        </div>
        <span className="eyebrow">PERFIL SINCRONIZADO</span>
        <h2>{profile.displayName}</h2>
        <div className="profile-media-fields">
          <label className="media-upload-button">
            <IconCamera size={18} />
            <span>Alterar avatar</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={mediaBusy}
              onChange={(event) => {
                chooseMedia("avatar", event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
          <label className="media-upload-button">
            <IconUpload size={18} />
            <span>Alterar banner</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              disabled={mediaBusy}
              onChange={(event) => {
                chooseMedia("banner", event.target.files?.[0] ?? null);
                event.target.value = "";
              }}
            />
          </label>
        </div>
        {mediaNotice && (
          <p
            className={`media-upload-notice ${mediaNotice.tone}`}
            role={mediaNotice.tone === "error" ? "alert" : "status"}
          >
            {mediaNotice.text}
          </p>
        )}
        {cropTarget && (
          <MediaCropModal
            file={cropTarget.file}
            kind={cropTarget.kind}
            busy={mediaBusy}
            onCancel={() => {
              if (!mediaBusy) setCropTarget(null);
            }}
            onConfirm={(blob) => void uploadCroppedMedia(blob)}
          />
        )}
        <label>
          Nome de exibição
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Username
          <input
            value={username}
            maxLength={24}
            onChange={(event) => setUsername(event.target.value.toLowerCase())}
          />
        </label>
        <label>
          Pronomes (opcional)
          <input
            value={pronouns}
            maxLength={50}
            onChange={(event) => setPronouns(event.target.value)}
          />
        </label>
        <label>
          Status personalizado
          <input
            value={customStatus}
            maxLength={128}
            onChange={(event) => setCustomStatus(event.target.value)}
          />
        </label>
        <label>
          Presença
          <select
            value={presence}
            onChange={(event) =>
              setPresence(event.target.value as Profile["status"])
            }
          >
            <option value="online">Online</option>
            <option value="idle">Ausente</option>
            <option value="dnd">Não perturbe</option>
            <option value="invisible">Invisível</option>
          </select>
        </label>
        <label>
          Bio
          <textarea
            value={bio}
            onChange={(event) => setBio(event.target.value)}
          />
        </label>
        <button className="primary-button" onClick={() => void saveProfile()}>
          Salvar perfil
        </button>
        {securityNotice && (
          <p className="profile-notice" role="status">
            {securityNotice}
          </p>
        )}
        <details className="security-details">
          <summary>Privacidade</summary>
          <div>
            <label>
              Quem pode enviar DM
              <select
                value={privacy.dmPolicy}
                onChange={(event) =>
                  void savePrivacy({
                    dmPolicy: event.target.value as
                      "EVERYONE" | "FRIENDS" | "NOBODY",
                  })
                }
              >
                <option value="EVERYONE">Todos</option>
                <option value="FRIENDS">Somente amigos</option>
                <option value="NOBODY">Ninguém</option>
              </select>
            </label>
            <label>
              Pedidos de amizade
              <select
                value={privacy.friendRequestPolicy}
                onChange={(event) =>
                  void savePrivacy({
                    friendRequestPolicy: event.target.value as
                      "EVERYONE" | "SERVER_MEMBERS" | "NOBODY",
                  })
                }
              >
                <option value="EVERYONE">Todos</option>
                <option value="SERVER_MEMBERS">Membros de servidores</option>
                <option value="NOBODY">Ninguém</option>
              </select>
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={privacy.profileVisible}
                onChange={(event) =>
                  void savePrivacy({ profileVisible: event.target.checked })
                }
              />
              Perfil visível fora da lista de amigos
            </label>
          </div>
        </details>
        <details className="security-details">
          <summary>Notificações</summary>
          <div>
            <label>
              Modo global
              <select
                value={globalNotifications.mode}
                onChange={(event) => {
                  setNotificationSetting({
                    scopeType: "GLOBAL",
                    scopeId: "*",
                    mode: event.target.value as "ALL" | "MENTIONS" | "NONE",
                    suppressEveryone: globalNotifications.suppressEveryone,
                    suppressRoles: globalNotifications.suppressRoles,
                    mutedUntil: globalNotifications.mutedUntil,
                  });
                  if (event.target.value !== "NONE")
                    requestNotificationAccess();
                }}
              >
                <option value="ALL">Todas as mensagens</option>
                <option value="MENTIONS">Somente menções</option>
                <option value="NONE">Silenciado</option>
              </select>
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={globalNotifications.suppressEveryone}
                onChange={(event) =>
                  setNotificationSetting({
                    scopeType: "GLOBAL",
                    scopeId: "*",
                    mode: globalNotifications.mode,
                    suppressEveryone: event.target.checked,
                    suppressRoles: globalNotifications.suppressRoles,
                    mutedUntil: globalNotifications.mutedUntil,
                  })
                }
              />
              Suprimir @everyone/@here
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={globalNotifications.suppressRoles}
                onChange={(event) =>
                  setNotificationSetting({
                    scopeType: "GLOBAL",
                    scopeId: "*",
                    mode: globalNotifications.mode,
                    suppressEveryone: globalNotifications.suppressEveryone,
                    suppressRoles: event.target.checked,
                    mutedUntil: globalNotifications.mutedUntil,
                  })
                }
              />
              Suprimir menções de cargo
            </label>
            <div className="notification-mute-actions">
              {globalNotificationsMuted ? (
                <>
                  <span>
                    Silenciado até{" "}
                    {new Date(globalNotifications.mutedUntil!).toLocaleString(
                      "pt-BR",
                    )}
                  </span>
                  <button
                    onClick={() =>
                      setNotificationSetting({
                        scopeType: "GLOBAL",
                        scopeId: "*",
                        mode: globalNotifications.mode,
                        suppressEveryone: globalNotifications.suppressEveryone,
                        suppressRoles: globalNotifications.suppressRoles,
                        mutedUntil: undefined,
                      })
                    }
                  >
                    Remover silêncio
                  </button>
                </>
              ) : (
                <>
                  <span>Silenciar temporariamente:</span>
                  {[1, 8, 24].map((hours) => (
                    <button
                      key={hours}
                      onClick={() =>
                        setNotificationSetting({
                          scopeType: "GLOBAL",
                          scopeId: "*",
                          mode: globalNotifications.mode,
                          suppressEveryone:
                            globalNotifications.suppressEveryone,
                          suppressRoles: globalNotifications.suppressRoles,
                          mutedUntil: notificationMuteUntil(hours),
                        })
                      }
                    >
                      {hours}h
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        </details>
        <details className="security-details">
          <summary>Acessibilidade e aparência</summary>
          <div>
            <label>
              Escala do texto · {Math.round(accessibility.textScale * 100)}%
              <input
                type="range"
                min="0.85"
                max="1.35"
                step="0.05"
                value={accessibility.textScale}
                onChange={(event) =>
                  setAccessibility({ textScale: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Zoom da interface · {Math.round(accessibility.zoom * 100)}%
              <input
                type="range"
                min="0.8"
                max="1.25"
                step="0.05"
                value={accessibility.zoom}
                onChange={(event) =>
                  setAccessibility({ zoom: Number(event.target.value) })
                }
              />
            </label>
            <label className="check-setting">
              <input
                type="checkbox"
                checked={accessibility.reducedMotion}
                onChange={(event) =>
                  setAccessibility({ reducedMotion: event.target.checked })
                }
              />
              Reduzir animações
            </label>
          </div>
        </details>
        {window.janjaDesktop && (
          <details className="security-details">
            <summary>Atualizações do aplicativo</summary>
            <div>
              <span>
                Versão {updateState?.version ?? "…"} · estado{" "}
                {updateState?.status ?? "idle"}
                {updateState?.status === "downloading"
                  ? ` (${updateState.progress}%)`
                  : ""}
              </span>
              {updateState?.error && <small>{updateState.error}</small>}
              {updateState?.status === "ready" ? (
                <button onClick={() => window.janjaDesktop?.installUpdate()}>
                  Reiniciar e instalar
                </button>
              ) : (
                <button
                  onClick={() =>
                    void window.janjaDesktop
                      ?.checkForUpdates()
                      .then(setUpdateState)
                  }
                  disabled={
                    updateState?.status === "checking" ||
                    updateState?.status === "downloading" ||
                    updateState?.status === "unconfigured"
                  }
                >
                  Verificar atualizações
                </button>
              )}
            </div>
          </details>
        )}
        <details className="security-details">
          <summary>Segurança, senha e dispositivos</summary>
          <div>
            <label>
              Nova senha
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <button
              className="outline-button"
              onClick={() => void changePassword()}
            >
              Alterar senha
            </button>
            <div className="account-session-heading">
              <span className="eyebrow">
                SESSÕES DA CONTA — {authSessions.length}
              </span>
              {authSessions.some((session) => !session.isCurrent) && (
                <button onClick={() => void revokeOtherSessions()}>
                  Encerrar outras
                </button>
              )}
            </div>
            {authSessions.map((session) => (
              <div className="device-row account-session-row" key={session.id}>
                <div>
                  <b>
                    {session.isCurrent
                      ? "Esta sessão"
                      : session.userAgent || "Sessão sem identificação"}
                  </b>
                  <small>
                    {session.isCurrent && session.userAgent
                      ? `${session.userAgent} · `
                      : ""}
                    {session.ip ? `IP ${session.ip} · ` : ""}
                    Ativa em{" "}
                    {new Date(session.updatedAt).toLocaleString("pt-BR")}
                  </small>
                </div>
                {!session.isCurrent && (
                  <button onClick={() => void revokeSession(session.id)}>
                    Encerrar
                  </button>
                )}
              </div>
            ))}
            {devices.find((device) => device.id === currentDeviceId) && (
              <div className="device-verification-code">
                <span className="eyebrow">CÓDIGO DESTE DISPOSITIVO</span>
                <code>
                  {deviceVerificationCode(
                    devices.find((device) => device.id === currentDeviceId)!
                      .fingerprint,
                  )}
                </code>
                <small>
                  Compare em outra sessão Janja antes de marcar o dispositivo
                  como confiável.
                </small>
              </div>
            )}
            <span className="eyebrow">DISPOSITIVOS — {devices.length}</span>
            {devices.map((device) => (
              <div
                className={`device-row ${device.revokedAt ? "revoked" : ""}`}
                key={device.id}
              >
                <div>
                  <b>{device.name}</b>
                  <small>
                    Visto {new Date(device.lastSeenAt).toLocaleString("pt-BR")}{" "}
                    ·{" "}
                    {device.verifiedAt
                      ? `verificado em ${new Date(device.verifiedAt).toLocaleDateString("pt-BR")}`
                      : "não verificado"}
                  </small>
                </div>
                <span className="device-actions">
                  {!device.revokedAt &&
                    !device.verifiedAt &&
                    device.id !== currentDeviceId && (
                      <button onClick={() => void verifyDevice(device.id)}>
                        Verificar
                      </button>
                    )}
                  <button
                    disabled={
                      Boolean(device.revokedAt) || device.id === currentDeviceId
                    }
                    onClick={() => void revoke(device.id)}
                  >
                    {device.revokedAt
                      ? "Revogado"
                      : device.id === currentDeviceId
                        ? "Este dispositivo"
                        : "Revogar"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </details>
        <button className="outline-button logout-button" onClick={onLogout}>
          Sair da conta neste dispositivo
        </button>
      </section>
    </div>
  );
}

/** Conecta o cartão de perfil ao estado da aplicação. */
function UserProfilePreview({
  userId,
  onClose,
  onChannel,
  onCall,
}: {
  userId: string;
  onClose: () => void;
  onChannel: (channelId: string) => void;
  onCall: (channelId: string, withVideo: boolean) => void;
}) {
  const profiles = useAppStore((state) => state.profiles),
    contacts = useAppStore((state) => state.contacts),
    friendships = useAppStore((state) => state.friendships),
    blocks = useAppStore((state) => state.blocks),
    servers = useAppStore((state) => state.servers),
    members = useAppStore((state) => state.members),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [busy, setBusy] = useState(false);
  const profile = profiles.find((item) => item.id === userId);
  if (!profile) return null;
  const contact = contacts.find((item) => item.targetUserId === userId);
  const friendship = friendships.find(
    (item) =>
      [item.requesterId, item.addresseeId].includes(currentUserId) &&
      [item.requesterId, item.addresseeId].includes(userId),
  );
  const blockedByMe = blocks.some(
    (item) => item.blockerId === currentUserId && item.blockedId === userId,
  );
  const blockedMe = blocks.some(
    (item) => item.blockerId === userId && item.blockedId === currentUserId,
  );
  const relationship: UserRelationship = blockedByMe
    ? "blocked"
    : blockedMe
      ? "blocked-by"
      : friendship?.status === "accepted"
        ? "friend"
        : friendship?.status === "pending"
          ? friendship.addresseeId === currentUserId
            ? "incoming-request"
            : "outgoing-request"
          : "none";
  const refresh = () => hydrateOnlineWorkspace(currentUserId);
  // Toda ação do cartão segue o mesmo caminho: executar, ressincronizar e só
  // então liberar os botões — é isso que faz os dois lados enxergarem o
  // mesmo estado sem precisar recarregar a página.
  const run = async (action: () => Promise<unknown>, close = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      if (close) onClose();
    } catch (caught) {
      reportRuntimeError(
        caught instanceof Error
          ? caught.message
          : "A ação não pôde ser concluída.",
      );
    } finally {
      setBusy(false);
    }
  };
  const openDm = (withCall: boolean, withVideo = false) =>
    run(async () => {
      const channelId = await createOnlineDirectChannel([userId]);
      await refresh();
      if (withCall) {
        onCall(channelId, withVideo);
      } else {
        onChannel(channelId);
        onClose();
      }
    });
  return (
    <UserProfileModal
      profile={profile}
      nickname={contact?.nickname}
      note={contact?.note}
      relationship={relationship}
      busy={busy}
      mutualServers={servers
        .filter(
          (server) =>
            members.some(
              (member) =>
                member.serverId === server.id && member.userId === userId,
            ) &&
            members.some(
              (member) =>
                member.serverId === server.id &&
                member.userId === currentUserId,
            ),
        )
        .map((server) => server.name)}
      onClose={onClose}
      actions={{
        message: () => void openDm(false),
        callVoice: () => void openDm(true, false),
        callVideo: () => void openDm(true, true),
        addFriend:
          relationship === "none"
            ? () => void run(() => requestOnlineFriend(userId))
            : undefined,
        acceptFriend:
          relationship === "incoming-request" && friendship
            ? () => void run(() => respondOnlineFriend(friendship.id, true))
            : undefined,
        declineFriend:
          relationship === "incoming-request" && friendship
            ? () => void run(() => respondOnlineFriend(friendship.id, false))
            : undefined,
        cancelFriendRequest:
          relationship === "outgoing-request" && friendship
            ? () => void run(() => cancelOnlineFriendRequest(friendship.id))
            : undefined,
        removeFriend:
          relationship === "friend" && friendship
            ? () => void run(() => removeOnlineFriend(friendship.id))
            : undefined,
        block:
          relationship === "blocked"
            ? undefined
            : () =>
                void run(() => blockOnlineUser(currentUserId, userId), true),
        unblock:
          relationship === "blocked"
            ? () => void run(() => unblockOnlineUser(currentUserId, userId))
            : undefined,
        saveNote: (note) =>
          void setContactNote(currentUserId, userId, note).then(refresh),
        saveNickname: (nickname) =>
          void setFriendNickname(currentUserId, userId, nickname).then(refresh),
      }}
    />
  );
}

function HelpPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="help-panel"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="close-settings" onClick={onClose}>
          ×
        </button>
        <Logo />
        <span className="eyebrow">AJUDA LOCAL</span>
        <h2>Janja — Voice Chat</h2>
        <p>
          Chamadas usam LiveKit/TURN e mídia E2EE vinculada ao grupo OpenMLS.
        </p>
        <div className="help-grid">
          <div>
            <b>Ctrl + K</b>
            <span>Busca canais, pessoas e mensagens decifradas.</span>
          </div>
          <div>
            <b>Shift + Enter</b>
            <span>Insere uma nova linha no compositor.</span>
          </div>
          <div>
            <b>Espaço</b>
            <span>Push-to-talk quando o modo PTT está ativo.</span>
          </div>
          <div>
            <b>Ctrl + / − / 0</b>
            <span>Ajusta ou redefine o zoom da interface.</span>
          </div>
        </div>
        <p className="help-security">
          🔒 Mensagens e anexos são persistidos como ciphertext AES-GCM. Áudio,
          vídeo e tela usam E2EE sobre LiveKit/WebRTC, com chaves derivadas do
          grupo OpenMLS.
        </p>
      </section>
    </div>
  );
}

/** Fila de solicitações de mensagem, dentro da Home. */
function MessageRequestsView({
  onChannel,
  onProfilePreview,
}: {
  onChannel: (channelId: string) => void;
  onProfilePreview: (userId: string) => void;
}) {
  const channels = useAppStore((state) => state.channels),
    dmStates = useAppStore((state) => state.dmStates),
    profiles = useAppStore((state) => state.profiles),
    channelMembers = useAppStore((state) => state.channelMembers),
    friendships = useAppStore((state) => state.friendships),
    currentUserId = useAppStore((state) => state.currentUserId);
  const [busyIds, setBusyIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const requests = channels.filter((channel) => {
    if (channel.serverId !== "direct") return false;
    const state = dmStates.find((item) => item.channelId === channel.id);
    return Boolean(state && !state.accepted && !state.closed);
  });
  const incomingFriendRequests = friendships.filter(
    (item) => item.status === "pending" && item.addresseeId === currentUserId,
  ).length;
  const senderOf = (channelId: string) =>
    profiles.find(
      (profile) =>
        profile.id !== currentUserId &&
        channelMembers.some(
          (member) =>
            member.channelId === channelId && member.userId === profile.id,
        ),
    );
  const respond = async (channelId: string, accept: boolean) => {
    setBusyIds((current) => [...current, channelId]);
    setError("");
    try {
      await respondMessageRequest(channelId, accept);
      await hydrateOnlineWorkspace(currentUserId);
      if (accept) onChannel(channelId);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível responder à solicitação.",
      );
    } finally {
      setBusyIds((current) => current.filter((id) => id !== channelId));
    }
  };
  return (
    <main className="conversation home-view">
      <div className="conversation-header friends-header">
        <div className="conversation-title">
          <span className="channel-symbol">
            <IconInbox size={20} />
          </span>
          <h1>Solicitações de mensagem</h1>
        </div>
      </div>
      <div className="home-content">
        {error && (
          <p className="home-notice error" role="alert">
            {error}
          </p>
        )}
        <section className="social-section">
          <span className="eyebrow">PENDENTES — {requests.length}</span>
          {requests.map((channel) => {
            const sender = senderOf(channel.id);
            return (
              <div className="friend-row" key={channel.id}>
                <button
                  className="friend-row-main"
                  onClick={() => sender && onProfilePreview(sender.id)}
                  aria-label={`Ver perfil de ${sender?.displayName ?? "usuário"}`}
                >
                  {sender ? (
                    <Avatar person={sender} size="lg" />
                  ) : (
                    <IconUsers size={24} />
                  )}
                  <span className="friend-row-names">
                    <b>{sender?.displayName ?? channel.name}</b>
                    <small>
                      {sender ? `@${sender.username} · ` : ""}
                      quer conversar com você
                    </small>
                  </span>
                </button>
                <div className="friend-row-actions">
                  <button
                    className="icon-button accept"
                    aria-label="Aceitar solicitação de mensagem"
                    title="Aceitar"
                    disabled={busyIds.includes(channel.id)}
                    onClick={() => void respond(channel.id, true)}
                  >
                    <IconCheck size={20} />
                  </button>
                  <button
                    className="icon-button danger-text"
                    aria-label="Recusar solicitação de mensagem"
                    title="Recusar"
                    disabled={busyIds.includes(channel.id)}
                    onClick={() => void respond(channel.id, false)}
                  >
                    <IconX size={20} />
                  </button>
                </div>
              </div>
            );
          })}
          {requests.length === 0 && (
            <p className="empty-copy">
              Nenhuma solicitação de mensagem pendente.
            </p>
          )}
        </section>
        {incomingFriendRequests > 0 && (
          <p className="empty-copy">
            Você também tem {incomingFriendRequests} pedido
            {incomingFriendRequests === 1 ? "" : "s"} de amizade em Amigos ›
            Pendentes.
          </p>
        )}
      </div>
    </main>
  );
}

function App({
  account,
  onLogout,
}: {
  account: AppAccount;
  onLogout: () => void;
}) {
  const channels = useAppStore((state) => state.channels),
    servers = useAppStore((state) => state.servers),
    channelMembers = useAppStore((state) => state.channelMembers),
    blocks = useAppStore((state) => state.blocks);
  const currentUserId = useAppStore((state) => state.currentUserId);
  const accessibility = useAppStore((state) => state.accessibility),
    setAccessibility = useAppStore((state) => state.setAccessibility);
  const view = useNavigationStore((state) => state.view),
    section = useNavigationStore((state) => state.section),
    navServerId = useNavigationStore((state) => state.serverId),
    navServerChannelId = useNavigationStore((state) => state.serverChannelId),
    navDmChannelId = useNavigationStore((state) => state.dmChannelId),
    openHome = useNavigationStore((state) => state.openHome),
    openDirectChannel = useNavigationStore((state) => state.openDirectChannel),
    openServer = useNavigationStore((state) => state.openServer),
    openServerChannel = useNavigationStore((state) => state.openServerChannel),
    claimNavigation = useNavigationStore((state) => state.claim);
  const [serverSetupOpen, setServerSetupOpen] = useState(false),
    [searchOpen, setSearchOpen] = useState(false),
    [inboxOpen, setInboxOpen] = useState(false),
    [settingsOpen, setSettingsOpen] = useState(false),
    [profileOpen, setProfileOpen] = useState(false),
    [helpOpen, setHelpOpen] = useState(false),
    [membersVisible, setMembersVisible] = useState(true),
    [mobileNavigationOpen, setMobileNavigationOpen] = useState(false),
    [activeCall, setActiveCall] = useState<{
      channelId: string;
      withVideo: boolean;
    } | null>(null),
    [previewUserId, setPreviewUserId] = useState<string | null>(null),
    [directUnreads, setDirectUnreads] = useState<DirectChannelUnread[]>([]),
    [voiceMembers, setVoiceMembers] = useState<OnlineVoiceMembers>({}),
    [workspaceError, setWorkspaceError] = useState(""),
    [runtimeError, setRuntimeError] = useState("");

  // A navegação persistida pertence a uma conta; entrar com outra começa do
  // zero em vez de herdar canais que talvez nem existam para ela.
  useEffect(
    () => claimNavigation(account.profileId),
    [account.profileId, claimNavigation],
  );
  useEffect(primeAudioOnUserGesture, []);

  useEffect(() => {
    return subscribeOnlineWorkspace(
      account.profileId,
      (caught) =>
        setWorkspaceError(`Sincronização interrompida: ${caught.message}`),
      () => setWorkspaceError(""),
    );
  }, [account.profileId]);
  useEffect(
    () =>
      subscribeDirectChannelUnreads(
        account.profileId,
        setDirectUnreads,
        () => undefined,
        () =>
          new Set(
            useAppStore
              .getState()
              .channels.filter((channel) => channel.serverId === "direct")
              .map((channel) => channel.id),
          ),
      ),
    [account.profileId],
  );
  useEffect(
    () =>
      subscribeActiveOnlineVoiceMembers(
        account.profileId,
        setVoiceMembers,
        () => undefined,
      ),
    [account.profileId],
  );
  useEffect(() => {
    // Um erro do PostgREST é objeto simples (não `Error`) e um `Error` de
    // `crypto.subtle` costuma vir com `message` vazio: nos dois casos o texto
    // útil estava sendo descartado e sobrava só o aviso genérico.
    const describe = (reason: unknown) => {
      if (typeof reason === "string" && reason.trim()) return reason;
      if (reason && typeof reason === "object") {
        const found = [
          (reason as { message?: unknown }).message,
          (reason as { details?: unknown }).details,
          (reason as { hint?: unknown }).hint,
          (reason as { code?: unknown }).code,
        ].find(
          (field): field is string =>
            typeof field === "string" && field.trim() !== "",
        );
        if (found) return found;
      }
      return "Uma operação não pôde ser concluída.";
    };
    const rejected = (event: PromiseRejectionEvent) => {
      setRuntimeError(describe(event.reason));
      event.preventDefault();
    };
    const reported = (event: Event) => {
      setRuntimeError(describe((event as CustomEvent<unknown>).detail));
    };
    const offline = () =>
      setWorkspaceError(
        "Sem conexão de rede. As alterações voltarão a sincronizar quando a conexão retornar.",
      );
    const online = () => {
      void hydrateOnlineWorkspace(account.profileId)
        .then(() => setWorkspaceError(""))
        .catch((caught) =>
          setWorkspaceError(
            `Não foi possível restabelecer a sincronização: ${caught instanceof Error ? caught.message : String(caught)}`,
          ),
        );
    };
    window.addEventListener("unhandledrejection", rejected);
    window.addEventListener("janja-runtime-error", reported);
    window.addEventListener("offline", offline);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("unhandledrejection", rejected);
      window.removeEventListener("janja-runtime-error", reported);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
    };
  }, [account.profileId]);
  useEffect(
    () =>
      subscribeVoiceMoveRequests(
        account.profileId,
        async (request) => {
          await hydrateOnlineWorkspace(account.profileId);
          openServerChannel(request.serverId, request.destinationChannelId);
          setActiveCall({
            channelId: request.destinationChannelId,
            withVideo: false,
          });
          setSettingsOpen(false);
        },
        (caught) =>
          reportRuntimeError("Falha ao processar movimentação de voz", caught),
      ),
    [account.profileId, openServerChannel],
  );
  useEffect(() => {
    void registerRemotePush(account.profileId).catch((caught) =>
      console.warn("Push remoto indisponível", caught),
    );
  }, [account.profileId]);

  const activeServer = servers.find((server) => server.id === navServerId);
  const serverChannels = channels
    .filter(
      (channel) =>
        channel.serverId === navServerId && channel.kind !== "category",
    )
    .sort((a, b) => a.position - b.position);
  const activeServerChannel =
    serverChannels.find((channel) => channel.id === navServerChannelId) ??
    serverChannels[0];
  const activeDmChannel = channels.find(
    (channel) => channel.id === navDmChannelId && channel.serverId === "direct",
  );
  const activeChannel =
    view === "server" ? activeServerChannel : activeDmChannel;
  const callChannel = channels.find(
    (channel) => channel.id === activeCall?.channelId,
  );

  const directCallBlocked = (channel?: Channel) =>
    Boolean(
      channel?.kind === "dm" &&
      channelMembers
        .filter((member) => member.channelId === channel.id)
        .some(
          (member) =>
            member.userId !== currentUserId &&
            blocks.some(
              (block) =>
                [block.blockerId, block.blockedId].includes(currentUserId) &&
                [block.blockerId, block.blockedId].includes(member.userId),
            ),
        ),
    );

  const signaling = useCallSignaling(currentUserId, {
    activeCallChannelId: activeCall?.channelId ?? "",
    onAccepted: (channelId, withVideo) => {
      const channel = useAppStore
        .getState()
        .channels.find((item) => item.id === channelId);
      if (channel?.serverId === "direct") openDirectChannel(channelId);
      setActiveCall({ channelId, withVideo });
      setMobileNavigationOpen(false);
    },
    onError: setRuntimeError,
  });
  const incomingCaller = useAppStore((state) =>
    state.profiles.find(
      (profile) => profile.id === signaling.incoming?.callerId,
    ),
  );
  const outgoingChannel = channels.find(
    (channel) => channel.id === signaling.outgoing?.channelId,
  );
  const outgoingPeer = useAppStore((state) =>
    state.profiles.find(
      (profile) =>
        profile.id !== currentUserId &&
        state.channelMembers.some(
          (member) =>
            member.channelId === signaling.outgoing?.channelId &&
            member.userId === profile.id,
        ),
    ),
  );

  useOnlinePresence(currentUserId);
  useForegroundNotifications(
    currentUserId,
    activeCall ? "" : (activeChannel?.id ?? ""),
  );

  // ---------------------------------------------------------------
  // Convite por link. Quem recebe `#/invite/<codigo>` entra no servidor
  // sozinho: antes o convite era um código de um domínio que não existe
  // (`janja.local/...`), e a pessoa precisava descobrir que havia um campo
  // escondido atrás de "adicionar servidor" para colá-lo.
  // ---------------------------------------------------------------
  useEffect(() => {
    const code = inviteCodeFromHash(window.location.hash);
    if (!code) return;
    let active = true;
    // Limpa o endereço antes de trocar o código: recarregar no meio do
    // processo tentaria usar de novo um convite que já foi consumido, e o
    // usuário veria "convite inválido" sem entender por quê.
    history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        const serverId = await redeemOnlineInvite(code);
        await hydrateOnlineWorkspace(account.profileId);
        if (!active) return;
        useNavigationStore.getState().openServer(serverId);
      } catch (caught) {
        if (!active) return;
        reportRuntimeError(
          caught instanceof Error
            ? caught.message
            : "Não foi possível entrar com este convite.",
          "invite",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [account.profileId]);

  // ---------------------------------------------------------------
  // Endereço ↔ navegação. O hash é a fonte de verdade ao carregar a
  // página, o que faz refresh e deep link caírem no mesmo contexto.
  // ---------------------------------------------------------------
  useEffect(() => {
    const applyHash = () => {
      const parsed = parseLocationHash(window.location.hash);
      if (!parsed) return;
      const state = useNavigationStore.getState();
      if (parsed.view === "home") {
        if (parsed.section === "dm" && parsed.channelId) {
          if (state.dmChannelId !== parsed.channelId || state.view !== "home")
            state.openDirectChannel(parsed.channelId);
        } else if (
          state.view !== "home" ||
          state.section !== parsed.section ||
          state.dmChannelId
        )
          state.openHome(
            parsed.section === "requests" ? "requests" : "friends",
          );
        return;
      }
      if (
        state.view !== "server" ||
        state.serverId !== parsed.serverId ||
        (parsed.channelId && state.serverChannelId !== parsed.channelId)
      ) {
        if (parsed.channelId)
          state.openServerChannel(parsed.serverId, parsed.channelId);
        else state.openServer(parsed.serverId);
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);
  const hashWriteArmedRef = useRef(false);
  useEffect(() => {
    const next = locationHash({
      view,
      serverId: navServerId,
      serverChannelId: activeServerChannel?.id ?? navServerChannelId,
      section,
      dmChannelId: navDmChannelId,
    });
    if (!hashWriteArmedRef.current) {
      hashWriteArmedRef.current = true;
      // Na primeira passagem quem manda é o endereço: ele acabou de ser
      // aplicado ao estado e este efeito ainda enxerga o valor anterior.
      // Sem esta guarda, o link direto era sobrescrito pelo último contexto
      // salvo — e o `hashchange` seguinte trazia o usuário de volta para ele.
      if (parseLocationHash(window.location.hash)) return;
      // Um convite pendente ainda não foi trocado; sobrescrever o endereço
      // aqui apagaria o código antes de o efeito acima chegar nele.
      if (inviteCodeFromHash(window.location.hash)) return;
    }
    if (window.location.hash !== next) window.location.hash = next;
  }, [
    activeServerChannel?.id,
    navDmChannelId,
    navServerChannelId,
    navServerId,
    section,
    view,
  ]);

  // Um servidor apagado, um canal removido ou uma conversa que sumiu não
  // podem deixar a interface presa num contexto que não existe mais.
  useEffect(() => {
    if (view !== "server") return;
    if (!navServerId || !servers.some((server) => server.id === navServerId)) {
      openHome();
      return;
    }
    if (activeServerChannel && activeServerChannel.id !== navServerChannelId)
      openServerChannel(navServerId, activeServerChannel.id);
  }, [
    activeServerChannel,
    navServerChannelId,
    navServerId,
    openHome,
    openServerChannel,
    servers,
    view,
  ]);
  const activeDmIsRequest = useAppStore((state) =>
    state.dmStates.some(
      (item) =>
        item.channelId === navDmChannelId && !item.accepted && !item.closed,
    ),
  );
  useEffect(() => {
    if (view !== "home" || section !== "dm") return;
    if (!navDmChannelId) return;
    // A conversa sumiu, ou virou uma solicitação de mensagem: nos dois casos
    // ela deixa de ser um lugar válido para o usuário estar.
    if (!activeDmChannel) openHome();
    else if (activeDmIsRequest) openHome("requests");
  }, [
    activeDmChannel,
    activeDmIsRequest,
    navDmChannelId,
    openHome,
    section,
    view,
  ]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    document.documentElement.style.setProperty(
      "--text-scale",
      String(accessibility.textScale),
    );
    document.body.style.zoom = String(accessibility.zoom);
    document.documentElement.classList.toggle(
      "reduce-motion",
      accessibility.reducedMotion,
    );
  }, [accessibility]);
  useEffect(() => {
    const zoom = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      if (!["+", "=", "-", "0"].includes(event.key)) return;
      event.preventDefault();
      const next =
        event.key === "0"
          ? 1
          : Math.min(
              1.25,
              Math.max(
                0.8,
                accessibility.zoom + (event.key === "-" ? -0.05 : 0.05),
              ),
            );
      setAccessibility({ zoom: Number(next.toFixed(2)) });
    };
    window.addEventListener("keydown", zoom);
    return () => window.removeEventListener("keydown", zoom);
  }, [accessibility.zoom, setAccessibility]);

  const invalidateChannel = (id: string) =>
    void queryClient.invalidateQueries({ queryKey: ["online-messages", id] });
  const goHome = (nextSection: "friends" | "requests" = "friends") => {
    openHome(nextSection);
    setSettingsOpen(false);
    setMobileNavigationOpen(false);
  };
  const selectDirectChannel = (channelId: string) => {
    invalidateChannel(channelId);
    openDirectChannel(channelId);
    setMobileNavigationOpen(false);
  };
  const selectChannel = (channelId: string) => {
    // Lê do store, não do render: esta função costuma ser chamada logo depois
    // de criar um canal, quando a lista capturada no closure ainda é a antiga
    // e o canal novo "não existiria".
    const channel = useAppStore
      .getState()
      .channels.find((item) => item.id === channelId);
    invalidateChannel(channelId);
    if (!channel || channel.serverId === "direct") {
      selectDirectChannel(channelId);
      return;
    }
    openServerChannel(channel.serverId, channelId);
    setMobileNavigationOpen(false);
  };
  const selectServer = (serverId: string) => {
    const firstChannel = channels
      .filter(
        (channel) =>
          channel.serverId === serverId && channel.kind !== "category",
      )
      .sort((a, b) => a.position - b.position)[0];
    openServer(serverId, firstChannel?.id);
    setSettingsOpen(false);
    // No celular a gaveta continua aberta depois de escolher o servidor: o
    // passo seguinte é escolher o canal, e fechá-la obrigaria a reabrir.
  };
  const leaveCall = async () => {
    const channelId = activeCall?.channelId;
    setActiveCall(null);
    if (channelId) await signaling.hangUp(channelId);
  };
  /** Alguém já está na chamada deste canal? Então é entrar, não chamar. */
  const callInProgress = (channelId: string) =>
    (voiceMembers[channelId] ?? []).some(
      (member) => member.userId !== currentUserId,
    );
  /**
   * Voz de servidor entra direto. Conversa direta toca o telefone — a menos
   * que a chamada já esteja rolando, caso em que entrar é o que a pessoa
   * espera (e tocar o telefone de quem já está lá seria absurdo).
   */
  const startCall = (channelId: string, withVideo: boolean) => {
    const channel = channels.find((item) => item.id === channelId);
    if (!channel) return;
    if (channel.serverId !== "direct" || callInProgress(channelId)) {
      setActiveCall({ channelId, withVideo });
      setMobileNavigationOpen(false);
      return;
    }
    void signaling.startCall(channelId, withVideo);
  };
  const finishServerSetup = (serverId: string) => {
    setServerSetupOpen(false);
    selectServer(serverId);
  };
  const unreadDirectCount = directUnreads.reduce(
    (total, item) => total + (item.unreadCount > 0 ? 1 : 0),
    0,
  );
  const pendingRequestCount = useAppStore(
    (state) =>
      state.friendships.filter(
        (item) =>
          item.status === "pending" && item.addresseeId === state.currentUserId,
      ).length +
      state.dmStates.filter((item) => !item.accepted && !item.closed).length,
  );

  return (
    <div
      className={`app-shell ${mobileNavigationOpen ? "mobile-nav-open" : ""}`}
    >
      {(workspaceError || runtimeError) && (
        <div className="runtime-alert" role="alert">
          <span>{workspaceError || runtimeError}</span>
          <button
            aria-label="Fechar aviso de erro"
            onClick={() => {
              setWorkspaceError("");
              setRuntimeError("");
            }}
          >
            ×
          </button>
        </div>
      )}
      <Titlebar
        serverName={
          view === "home" ? "Janja" : (activeServer?.name ?? "Servidor")
        }
        channelName={
          view === "home"
            ? section === "requests"
              ? "Solicitações"
              : section === "dm" && activeDmChannel
                ? activeDmChannel.name
                : "Amigos"
            : !activeChannel
              ? "Escolha ou crie um servidor"
              : activeChannel.kind === "voice"
                ? activeChannel.name
                : `# ${activeChannel.name}`
        }
        navigationOpen={mobileNavigationOpen}
        onToggleNavigation={() =>
          setMobileNavigationOpen((current) => !current)
        }
        onSearch={() => setSearchOpen(true)}
        onInbox={() => setInboxOpen(true)}
        onHelp={() => setHelpOpen(true)}
      />
      <div className="app-body">
        <button
          className="mobile-nav-backdrop"
          aria-label="Fechar navegação"
          onClick={() => setMobileNavigationOpen(false)}
        />
        <ServerRail
          view={view}
          selectedServerId={navServerId}
          unreadDirectCount={unreadDirectCount}
          pendingRequestCount={pendingRequestCount}
          onHome={() => goHome()}
          onServer={selectServer}
          onSearch={() => setSearchOpen(true)}
          onSettings={() => setProfileOpen(true)}
          onAddServer={() => setServerSetupOpen(true)}
        />
        {view === "home" ? (
          <DirectMessageSidebar
            section={section}
            activeChannelId={activeDmChannel?.id ?? ""}
            unreads={directUnreads}
            onFriends={() => goHome("friends")}
            onRequests={() => goHome("requests")}
            onChannel={selectDirectChannel}
            onProfile={() => setProfileOpen(true)}
            onProfilePreview={setPreviewUserId}
            onCall={startCall}
          />
        ) : activeServer ? (
          <ChannelSidebar
            serverId={navServerId}
            activeChannelId={activeChannel?.id ?? ""}
            voiceMembers={voiceMembers}
            onChannel={selectChannel}
            onSettings={() => setSettingsOpen(true)}
            onProfile={() => setProfileOpen(true)}
          />
        ) : (
          <aside className="channel-sidebar empty-sidebar">
            <Logo />
            <p>Crie um servidor ou entre com um convite.</p>
          </aside>
        )}
        {activeCall && callChannel ? (
          <CallView
            channel={callChannel}
            startWithVideo={activeCall.withVideo}
            onLeave={() => void leaveCall()}
          />
        ) : view === "home" ? (
          section === "requests" ? (
            <MessageRequestsView
              onChannel={selectDirectChannel}
              onProfilePreview={setPreviewUserId}
            />
          ) : section === "dm" && activeDmChannel ? (
            <ChatView
              channel={activeDmChannel}
              onSearch={() => setSearchOpen(true)}
              onToggleMembers={() => setMembersVisible((visible) => !visible)}
              membersVisible={membersVisible}
              callInProgress={callInProgress(activeDmChannel.id)}
              onCall={
                directCallBlocked(activeDmChannel)
                  ? undefined
                  : (withVideo: boolean) =>
                      startCall(activeDmChannel.id, withVideo)
              }
            />
          ) : (
            <HomeView
              onChannel={selectChannel}
              onCall={startCall}
              onProfilePreview={setPreviewUserId}
            />
          )
        ) : !activeChannel ? (
          <main className="workspace-empty">
            <Logo />
            <span className="eyebrow">JANJA · LOCAL E2EE</span>
            <h1>Converse com outras pessoas</h1>
            <p>
              Crie um servidor ou use um convite para entrar no mesmo espaço em
              outro navegador.
            </p>
            <button
              className="primary-button"
              onClick={() => setServerSetupOpen(true)}
            >
              Começar
            </button>
          </main>
        ) : activeChannel.kind === "voice" ? (
          <CallView
            channel={activeChannel}
            onLeave={() => {
              const textChannel = serverChannels.find(
                (channel) => channel.kind === "text",
              );
              if (textChannel) selectChannel(textChannel.id);
            }}
          />
        ) : (
          <ChatView
            channel={activeChannel}
            onSearch={() => setSearchOpen(true)}
            onToggleMembers={() => setMembersVisible((visible) => !visible)}
            membersVisible={membersVisible}
            onCall={undefined}
          />
        )}
        {membersVisible && view === "server" && activeChannel && (
          <MemberSidebar serverId={navServerId} onChannel={selectChannel} />
        )}
      </div>
      {signaling.incoming && incomingCaller && (
        <IncomingCallOverlay
          caller={incomingCaller}
          withVideo={signaling.incoming.withVideo}
          busy={signaling.busy}
          onAnswerAudio={() =>
            void signaling.answerCall(signaling.incoming!, false)
          }
          onAnswerVideo={() =>
            void signaling.answerCall(signaling.incoming!, true)
          }
          onDecline={() => void signaling.declineCall(signaling.incoming!)}
        />
      )}
      {signaling.outgoing && (
        <OutgoingCallOverlay
          peer={
            outgoingPeer ?? {
              displayName: outgoingChannel?.name ?? "Chamada",
              avatar: (outgoingChannel?.name ?? "?").slice(0, 2).toUpperCase(),
              avatarUrl: undefined,
              color: "#f00c14",
              status: "online",
            }
          }
          withVideo={signaling.outgoing.withVideo}
          status={signaling.outgoing.status}
          onCancel={() => void signaling.cancelCall()}
          onDismiss={signaling.dismissOutgoing}
        />
      )}
      {searchOpen && (
        <SearchModal
          onClose={() => setSearchOpen(false)}
          onChannel={selectChannel}
          onServer={selectServer}
        />
      )}
      {inboxOpen && (
        <InboxPanel
          onClose={() => setInboxOpen(false)}
          onChannel={selectChannel}
        />
      )}
      {settingsOpen && activeServer && (
        <SettingsPanel
          serverId={navServerId}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {profileOpen && (
        <ProfilePanel
          account={account}
          onClose={() => setProfileOpen(false)}
          onLogout={onLogout}
        />
      )}
      {previewUserId && (
        <UserProfilePreview
          userId={previewUserId}
          onClose={() => setPreviewUserId(null)}
          onChannel={selectDirectChannel}
          onCall={(channelId, withVideo) => {
            setPreviewUserId(null);
            startCall(channelId, withVideo);
          }}
        />
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {(serverSetupOpen || (servers.length === 0 && view === "server")) && (
        <ServerSetupModal
          required={false}
          onClose={() => setServerSetupOpen(false)}
          onReady={finishServerSetup}
        />
      )}
    </div>
  );
}

/**
 * Tela de senha nova, mostrada a quem chegou pelo link de recuperação.
 *
 * Sem ela, o link do e-mail apenas autentica a pessoa e a joga dentro do
 * aplicativo com a senha antiga ainda valendo. Funciona, mas não é o que ela
 * pediu ao clicar em "esqueci a senha": ela sai de lá achando que trocou.
 */
function NewPasswordCard({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState(""),
    [confirmation, setConfirmation] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 8)
      return setError("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation)
      return setError("As duas senhas não são iguais.");
    setBusy(true);
    setError("");
    try {
      // `updateOnlinePassword` também encerra as outras sessões: quem trocou a
      // senha por ter perdido o acesso não quer deixar viva a sessão de quem
      // possa ter entrado.
      await updateOnlinePassword(password);
      clearPasswordRecoveryLink();
      onDone();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível trocar a senha.",
      );
      setBusy(false);
    }
  };

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <Logo />
        <span className="eyebrow">JANJA · ONLINE E2EE</span>
        <h1>Defina uma senha nova</h1>
        <p>
          O link do e-mail já provou que a conta é sua. Escolha a senha nova
          agora — as outras sessões abertas serão encerradas.
        </p>
        <label>
          Senha nova
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label>
          Repita a senha
          <input
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && void submit()}
          />
        </label>
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? "Salvando…" : "Trocar a senha"}
        </button>
      </section>
    </main>
  );
}

function OnlineAuthGate() {
  const [account, setAccount] = useState<OnlineAccount | null>(null),
    [loading, setLoading] = useState(true),
    [mode, setMode] = useState<"login" | "register" | "recover">("login"),
    [email, setEmail] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    // O link de recuperação autentica a pessoa sozinho, então a tela de senha
    // nova precisa se impor antes de o aplicativo abrir.
    [recovering, setRecovering] = useState(isPasswordRecoveryLink),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);

  const activate = async (next: OnlineAccount) => {
    await hydrateOnlineWorkspace(next.profileId);
    setAccount(next);
  };

  useEffect(() => {
    void getCurrentOnlineAccount()
      .then((current) => (current ? activate(current) : undefined))
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Falha na sessão."),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    // A sessão do Supabase vive em localStorage, compartilhado por todas as
    // abas da mesma origem. Se outra aba autenticar outra conta, esta aba
    // passaria a agir com o token da conta nova mas com o estado (workspace,
    // engine MLS, cache) da conta antiga. Detectamos a troca e recarregamos
    // para impedir qualquer contaminação entre contas.
    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAccount((current) => {
          if (!current) return current;
          if (!session || session.user.id !== current.id) {
            queryClient.clear();
            window.location.reload();
          }
          return current;
        });
      },
    );
    return () => subscription.subscription.unsubscribe();
  }, []);

  const submit = async () => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "recover") {
        await requestOnlinePasswordReset(email);
        // A mesma frase para e-mail cadastrado e desconhecido: dizer "não
        // existe conta com esse e-mail" entregaria a lista de quem tem conta.
        setMode("login");
        setNotice(
          "Se existir uma conta com esse e-mail, o link para trocar a senha já está a caminho.",
        );
      } else if (mode === "register") {
        const result = await registerOnlineAccount({
          email,
          username,
          displayName: displayName || username,
          password,
        });
        if (result.status === "pending") {
          // Conta criada com sucesso, faltando só a confirmação. Isto é aviso,
          // não erro: antes aparecia em vermelho, dizendo que deu errado
          // justamente quando deu certo.
          setMode("login");
          setPassword("");
          setNotice(
            `Conta criada. Abra o link que enviamos para ${result.email} e depois entre por aqui.`,
          );
        } else await activate(result.account);
      } else {
        await activate(await loginOnlineAccount(email, password));
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível continuar.",
      );
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await logoutOnlineAccount();
    queryClient.clear();
    setAccount(null);
    setPassword("");
  };

  if (loading)
    return (
      <div className="auth-screen">
        <Logo />
        <p>Conectando ao Janja…</p>
      </div>
    );
  // A ordem importa: o link de recuperação já traz sessão válida, então sem
  // este desvio o aplicativo abriria normalmente e a senha nunca seria trocada.
  if (account && recovering)
    return <NewPasswordCard onDone={() => setRecovering(false)} />;
  if (account) return <App account={account} onLogout={() => void logout()} />;
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <Logo />
        <span className="eyebrow">JANJA · ONLINE E2EE</span>
        <h1>
          {mode === "register"
            ? "Criar conta"
            : mode === "recover"
              ? "Recuperar acesso"
              : "Entrar"}
        </h1>
        <p>
          {mode === "recover"
            ? "Informe o e-mail da conta. Mandamos um link para você definir uma senha nova."
            : "Conta protegida pelo Supabase Auth; o conteúdo das mensagens permanece cifrado no servidor."}
        </p>
        {mode === "register" && (
          <>
            <label>
              Nome de exibição
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Username
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoCapitalize="none"
              />
            </label>
          </>
        )}
        <label>
          E-mail
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoCapitalize="none"
          />
        </label>
        {mode !== "recover" && (
          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void submit()}
            />
          </label>
        )}
        {error && (
          <div className="auth-error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="auth-notice" role="status">
            {notice}
          </div>
        )}
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy
            ? "Conectando…"
            : mode === "register"
              ? "Criar conta"
              : mode === "recover"
                ? "Enviar o link"
                : "Entrar"}
        </button>
        <div className="auth-links">
          <button
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setError("");
            }}
          >
            {mode === "register" ? "Já tenho conta" : "Criar conta"}
          </button>
          <button
            onClick={() => {
              setMode(mode === "recover" ? "login" : "recover");
              setError("");
            }}
          >
            {mode === "recover" ? "Voltar ao login" : "Esqueci a senha"}
          </button>
        </div>
      </section>
    </main>
  );
}

function AuthGate() {
  return <OnlineAuthGate />;
}

const rootElement = document.getElementById("root")!;
const reactRoot = window.__janjaReactRoot ?? createRoot(rootElement);
window.__janjaReactRoot = reactRoot;
reactRoot.render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthGate />
    </QueryClientProvider>
  </StrictMode>,
);
