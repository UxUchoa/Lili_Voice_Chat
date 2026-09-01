export type PresenceStatus =
  "online" | "idle" | "dnd" | "invisible" | "offline";
export type ChannelKind = "category" | "text" | "voice" | "dm" | "gdm";
export type AuditAction =
  | "SERVER_CREATE"
  | "SERVER_UPDATE"
  | "SERVER_DELETE"
  | "SERVER_TRANSFER"
  | "CHANNEL_CREATE"
  | "CHANNEL_UPDATE"
  | "CHANNEL_DELETE"
  | "CHANNEL_REORDER"
  | "ROLE_CREATE"
  | "ROLE_UPDATE"
  | "ROLE_REORDER"
  | "ROLE_DELETE"
  | "CHANNEL_OVERRIDE_UPDATE"
  | "MEMBER_ROLE_UPDATE"
  | "MEMBER_NICKNAME_UPDATE"
  | "MEMBER_TIMEOUT"
  | "MEMBER_KICK"
  | "MEMBER_BAN"
  | "MEMBER_UNBAN"
  | "INVITE_CREATE"
  | "INVITE_REVOKE";

export interface Profile {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  avatarUrl?: string;
  bannerUrl?: string;
  color: string;
  bio: string;
  pronouns: string;
  customStatus: string;
  status: PresenceStatus;
  preferredStatus: PresenceStatus;
  createdAt: string;
}

export interface Server {
  id: string;
  name: string;
  ownerId: string;
  description: string;
  /** Caminho no bucket privado `server-icons`. */
  iconPath?: string;
  /** URL assinada do ícone; ausente quando o servidor não tem um. */
  iconUrl?: string;
  createdAt: string;
}

export interface Channel {
  id: string;
  serverId: string;
  name: string;
  kind: ChannelKind;
  position: number;
  category: string;
  /** Assunto do canal, mostrado no cabeçalho da conversa. */
  topic: string;
  slowmodeSeconds: number;
  userLimit: number;
  private: boolean;
  /** As permissões acompanham as da categoria deste canal. */
  permissionsSynced: boolean;
  createdBy: string;
  iconPath?: string;
  iconUrl?: string;
}

export interface Role {
  id: string;
  serverId: string;
  name: string;
  position: number;
  permissions: string;
  color: string;
  icon?: string;
  hoist: boolean;
  mentionable: boolean;
  isDefault: boolean;
}

export interface ServerMember {
  serverId: string;
  userId: string;
  nickname?: string;
  roleIds: string[];
  joinedAt: string;
  joinSource?: string;
  communicationDisabledUntil?: string;
  serverMuted?: boolean;
  serverDeafened?: boolean;
}

export interface PermissionOverride {
  id: string;
  channelId: string;
  targetType: "ROLE" | "MEMBER";
  targetId: string;
  allow: string;
  deny: string;
}

export interface AuditEntry {
  id: string;
  serverId: string;
  actorId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  reason?: string;
  changes: Record<string, unknown>;
  createdAt: string;
}

export interface Friendship {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: string;
}

export interface Block {
  id: string;
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

export interface ChannelMember {
  channelId: string;
  userId: string;
  joinedAt: string;
}

export interface ReadState {
  channelId: string;
  userId: string;
  lastMessageId?: string;
  lastReadAt: string;
  mentionCount: number;
}

export interface Ban {
  id: string;
  serverId: string;
  userId: string;
  actorId: string;
  reason?: string;
  createdAt: string;
}

export interface Invite {
  id: string;
  code: string;
  serverId: string;
  channelId: string;
  creatorId: string;
  maxUses?: number;
  uses: number;
  expiresAt?: string;
  revokedAt?: string;
  createdAt: string;
}

export interface NotificationSetting {
  id: string;
  userId: string;
  scopeType: "GLOBAL" | "SERVER" | "CHANNEL";
  scopeId: string;
  mode: "ALL" | "MENTIONS" | "NONE";
  suppressEveryone: boolean;
  suppressRoles: boolean;
  mutedUntil?: string;
}

export interface PrivacySetting {
  userId: string;
  dmPolicy: "EVERYONE" | "FRIENDS" | "NOBODY";
  friendRequestPolicy: "EVERYONE" | "SERVER_MEMBERS" | "NOBODY";
  profileVisible: boolean;
}

export interface MessagePayload {
  version: 1;
  text: string;
  mentions: string[];
  reactions: Record<string, string[]>;
  attachments: Array<{
    id: string;
    name: string;
    size: number;
    mime: string;
    /** Caminho no bucket `attachments`; o acesso é o do Storage autenticado. */
    storageObject?: string;
    /**
     * Nasce coberto para todo mundo. Quem envia decide; "revelado" é decisão
     * de cada leitor e não sai do cliente dele.
     */
    spoiler?: boolean;
  }>;
}

export interface MessageView extends MessagePayload {
  id: string;
  channelId: string;
  authorId: string;
  /** Sessão que enviou. Só rotula a origem; não tem papel de segurança. */
  senderDeviceId?: string;
  replyToId?: string;
  pinned: boolean;
  createdAt: string;
  editedAt?: string;
}
