import type {
  AuditAction,
  AuditEntry,
  Ban,
  Block,
  Channel,
  ChannelMember,
  Friendship,
  Invite,
  NotificationSetting,
  PermissionOverride,
  PrivacySetting,
  Profile,
  ReadState,
  Role,
  Server,
  ServerMember,
} from "../../domain/types";
import { useAppStore } from "../../store/appStore";
import { supabase } from "./client";

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

const colorFor = (id: string) => {
  const colors = ["#f00c14", "#ffb020", "#7c5cff", "#23c483", "#2d9cdb"];
  return colors[id.charCodeAt(id.length - 1) % colors.length];
};

const profileMediaCache = new Map<
  string,
  { signedUrl: string; expiresAt: number }
>();

async function profileMediaUrls(
  bucket: "avatars" | "banners" | "gdm-icons" | "server-icons",
  paths: string[],
) {
  const now = Date.now();
  const uniquePaths = [...new Set(paths.filter(Boolean))];
  const missing = uniquePaths.filter((path) => {
    const cached = profileMediaCache.get(`${bucket}:${path}`);
    return !cached || cached.expiresAt < now + 60_000;
  });
  if (missing.length) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(missing, 3600);
    if (error) throw error;
    for (const item of data ?? []) {
      if (!item.signedUrl) continue;
      profileMediaCache.set(`${bucket}:${item.path}`, {
        signedUrl: item.signedUrl,
        expiresAt: now + 3_600_000,
      });
    }
  }
  return new Map(
    uniquePaths.flatMap((path) => {
      const cached = profileMediaCache.get(`${bucket}:${path}`);
      return cached ? [[path, cached.signedUrl] as const] : [];
    }),
  );
}

export async function hydrateOnlineWorkspace(userId: string) {
  const liveStatuses = new Map(
    useAppStore
      .getState()
      .profiles.map((profile) => [profile.id, profile.status] as const),
  );
  const requests = await Promise.all([
    supabase.from("profiles").select("*"),
    supabase.from("servers").select("*"),
    supabase.from("channels").select("*"),
    supabase.from("roles").select("*"),
    supabase.from("server_members").select("*"),
    supabase.from("member_roles").select("*"),
    supabase.from("channel_members").select("*"),
    supabase.from("friendships").select("*"),
    supabase.from("blocks").select("*"),
    supabase.from("read_states").select("*"),
    supabase.from("bans").select("*"),
    supabase.from("invites").select("*"),
    supabase.from("channel_permission_overrides").select("*"),
    supabase.from("notification_settings").select("*"),
    supabase
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("user_contacts").select("*").eq("user_id", userId),
    supabase.from("dm_states").select("*").eq("user_id", userId),
    supabase
      .from("server_privacy_settings")
      .select("*")
      .eq("user_id", userId),
  ]);
  const failed = requests.find((request) => request.error);
  if (failed?.error) throw failed.error;
  const [
    profileRows,
    serverRows,
    channelRows,
    roleRows,
    memberRows,
    memberRoleRows,
    channelMemberRows,
    friendshipRows,
    blockRows,
    readRows,
    banRows,
    inviteRows,
    overrideRows,
    notificationRows,
    auditRows,
    contactRows,
    dmStateRows,
    serverPrivacyRows,
  ] = requests.map((request) => request.data ?? []);

  const [avatarUrls, bannerUrls, groupIconUrls, serverIconUrls] = await Promise.all([
    profileMediaUrls(
      "avatars",
      profileRows.map((row: any) => row.avatar_path ?? ""),
    ),
    profileMediaUrls(
      "banners",
      profileRows.map((row: any) => row.banner_path ?? ""),
    ),
    profileMediaUrls(
      "gdm-icons",
      channelRows.map((row: any) => row.icon_path ?? ""),
    ),
    profileMediaUrls(
      "server-icons",
      serverRows.map((row: any) => row.icon_path ?? ""),
    ),
  ]);

  const profiles: Profile[] = profileRows.map((row: any) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    avatar: initials(row.display_name),
    avatarUrl: row.avatar_path ? avatarUrls.get(row.avatar_path) : undefined,
    bannerUrl: row.banner_path ? bannerUrls.get(row.banner_path) : undefined,
    color: colorFor(row.id),
    bio: row.bio,
    pronouns: row.pronouns ?? "",
    customStatus: row.custom_status ?? "",
    status:
      row.id !== userId
        ? row.presence === "invisible"
          ? "offline"
          : (liveStatuses.get(row.id) ?? row.presence)
        : // O próprio usuário enxerga o estado que os outros enxergam — com
          // a exceção de "invisível", que só faz sentido para ele. Antes esta
          // linha usava a coluna do banco e o painel dizia "offline" enquanto
          // todo mundo via a conta online.
          row.presence === "invisible"
          ? "invisible"
          : (liveStatuses.get(row.id) ??
            (row.presence === "offline" ? "online" : row.presence)),
    preferredStatus: row.presence === "offline" ? "online" : row.presence,
    createdAt: row.created_at,
  }));
  const servers: Server[] = serverRows.map((row: any) => ({
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    description: row.description ?? "",
    iconPath: row.icon_path ?? undefined,
    // Sem ícone o servidor usa o monograma do próprio nome, como no Discord —
    // e nunca o logotipo do produto, que fazia todos parecerem iguais.
    iconUrl: row.icon_path ? serverIconUrls.get(row.icon_path) : undefined,
    createdAt: row.created_at,
  }));
  const directMemberIds = new Map<string, string[]>();
  for (const row of channelMemberRows as any[])
    directMemberIds.set(row.channel_id, [
      ...(directMemberIds.get(row.channel_id) ?? []),
      row.user_id,
    ]);
  const channels: Channel[] = channelRows.map((row: any) => ({
    id: row.id,
    serverId: row.server_id ?? "direct",
    name:
      row.kind === "dm"
        ? (profiles.find(
            (profile) =>
              profile.id ===
              directMemberIds
                .get(row.id)
                ?.find((memberId) => memberId !== userId),
          )?.displayName ?? row.name)
        : row.name,
    kind: row.kind === "thread" ? "text" : row.kind,
    position: row.position,
    category: row.parent_id ?? "",
    topic: row.topic ?? "",
    slowmodeSeconds: row.slowmode_seconds,
    userLimit: row.user_limit,
    private: row.private,
    permissionsSynced: row.permissions_synced ?? true,
    createdBy: row.created_by,
    iconPath: row.icon_path ?? undefined,
    iconUrl: row.icon_path ? groupIconUrls.get(row.icon_path) : undefined,
  }));
  const roles: Role[] = roleRows.map((row: any) => ({
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    position: row.position,
    permissions: String(row.permissions),
    color: row.color,
    icon: row.unicode_emoji ?? row.icon_path ?? undefined,
    hoist: row.hoist,
    mentionable: row.mentionable,
    isDefault: row.is_default,
  }));
  const roleIdsByMember = new Map<string, string[]>();
  for (const row of memberRoleRows as any[]) {
    const key = `${row.server_id}:${row.user_id}`;
    roleIdsByMember.set(key, [
      ...(roleIdsByMember.get(key) ?? []),
      row.role_id,
    ]);
  }
  const members: ServerMember[] = memberRows.map((row: any) => ({
    serverId: row.server_id,
    userId: row.user_id,
    nickname: row.nickname ?? undefined,
    roleIds: roleIdsByMember.get(`${row.server_id}:${row.user_id}`) ?? [],
    joinedAt: row.joined_at,
    joinSource: row.join_source ?? undefined,
    communicationDisabledUntil: row.communication_disabled_until ?? undefined,
    serverMuted: row.server_muted,
    serverDeafened: row.server_deafened,
  }));
  const friendships: Friendship[] = friendshipRows.map((row: any) => ({
    id: row.id,
    requesterId: row.requester_id,
    addresseeId: row.addressee_id,
    status: row.status,
    createdAt: row.created_at,
  }));
  const blocks: Block[] = blockRows.map((row: any) => ({
    id: `${row.blocker_id}:${row.blocked_id}`,
    blockerId: row.blocker_id,
    blockedId: row.blocked_id,
    createdAt: row.created_at,
  }));
  const channelMembers: ChannelMember[] = channelMemberRows.map((row: any) => ({
    channelId: row.channel_id,
    userId: row.user_id,
    joinedAt: row.joined_at,
  }));
  const readStates: ReadState[] = readRows.map((row: any) => ({
    channelId: row.channel_id,
    userId: row.user_id,
    lastMessageId: row.last_message_id ?? undefined,
    lastReadAt: row.last_read_at,
    mentionCount: row.mention_count,
  }));
  const bans: Ban[] = banRows.map((row: any) => ({
    id: `${row.server_id}:${row.user_id}`,
    serverId: row.server_id,
    userId: row.user_id,
    actorId: row.actor_id,
    reason: row.reason ?? undefined,
    createdAt: row.created_at,
  }));
  const invites: Invite[] = inviteRows.map((row: any) => ({
    id: row.id,
    code: row.code,
    serverId: row.server_id,
    channelId: row.channel_id,
    creatorId: row.creator_id,
    maxUses: row.max_uses ?? undefined,
    uses: row.uses,
    expiresAt: row.expires_at ?? undefined,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
  }));
  const permissionOverrides: PermissionOverride[] = overrideRows.map(
    (row: any) => ({
      id: row.id,
      channelId: row.channel_id,
      targetType: row.target_type,
      targetId: row.target_id,
      allow: String(row.allow_mask),
      deny: String(row.deny_mask),
    }),
  );
  const notificationSettings: NotificationSetting[] = notificationRows.map(
    (row: any) => ({
      id: row.id,
      userId: row.user_id,
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      mode: row.mode,
      suppressEveryone: row.suppress_everyone,
      suppressRoles: row.suppress_roles,
      mutedUntil: row.muted_until ?? undefined,
    }),
  );
  const privacySettings: PrivacySetting[] = profileRows
    .filter((row: any) => row.id === userId)
    .map((row: any) => ({
      userId: row.id,
      dmPolicy: row.dm_policy,
      friendRequestPolicy: row.friend_request_policy,
      profileVisible: row.profile_visible,
    }));
  const auditLogs: AuditEntry[] = auditRows.map((row: any) => ({
    id: row.id,
    serverId: row.server_id,
    actorId: row.actor_id,
    action: row.action_type as AuditAction,
    targetType: row.target_type,
    targetId: row.target_id ?? "",
    reason: row.reason ?? undefined,
    changes: row.changes,
    createdAt: row.created_at,
  }));

  const contacts = contactRows.map((row: any) => ({
    targetUserId: row.target_user_id,
    nickname: row.nickname ?? undefined,
    note: row.note ?? undefined,
    ignored: row.ignored,
  }));
  const dmStates = dmStateRows.map((row: any) => ({
    channelId: row.channel_id,
    pinned: row.pinned,
    closed: row.closed,
    accepted: row.accepted ?? true,
  }));
  const serverPrivacy = serverPrivacyRows.map((row: any) => ({
    serverId: row.server_id,
    allowDirectMessages: row.allow_direct_messages,
    filterMessageRequests: row.filter_message_requests,
    shareActivity: row.share_activity,
    allowActivityJoin: row.allow_activity_join,
  }));

  useAppStore.getState().hydrateOnline({
    currentUserId: userId,
    contacts,
    dmStates,
    serverPrivacy,
    profiles,
    servers,
    channels,
    roles,
    members,
    friendships,
    blocks,
    channelMembers,
    readStates,
    bans,
    invites,
    permissionOverrides,
    notificationSettings,
    privacySettings,
    auditLogs,
  });
}

export interface NewChannelOptions {
  serverId: string;
  name: string;
  kind: "text" | "voice" | "category";
  parentId?: string;
  private?: boolean;
  slowmodeSeconds?: number;
  userLimit?: number;
  topic?: string;
}

export async function createOnlineChannel(options: NewChannelOptions) {
  const name = options.name.trim();
  if (!name) throw new Error("Informe o nome do canal.");
  if (name.length > 100)
    throw new Error("O nome do canal deve ter no máximo 100 caracteres.");
  const { data, error } = await supabase.rpc("create_channel", {
    p_server_id: options.serverId,
    p_name: name,
    p_kind: options.kind,
    p_parent_id: options.parentId ?? null,
    p_private: options.private ?? false,
    p_slowmode_seconds: options.slowmodeSeconds ?? 0,
    p_user_limit: options.userLimit ?? 0,
    p_topic: options.topic ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function createOnlineInvite(
  serverId: string,
  channelId: string,
  expiresInMinutes?: number,
  maxUses?: number,
) {
  const { data, error } = await supabase.rpc("create_invite", {
    p_server_id: serverId,
    p_channel_id: channelId,
    p_max_uses: maxUses ?? null,
    p_expires_in_minutes: expiresInMinutes ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function redeemOnlineInvite(code: string) {
  const normalizedCode = code.trim().split("/").filter(Boolean).at(-1) ?? "";
  if (!normalizedCode) throw new Error("Informe um código de convite válido.");
  const { data, error } = await supabase.rpc("redeem_invite", {
    p_code: normalizedCode,
  });
  if (error) throw error;
  return data as string;
}

export async function revokeOnlineInvite(inviteId: string) {
  const { error } = await supabase.rpc("revoke_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw error;
}

export function subscribeOnlineWorkspace(
  userId: string,
  onError: (error: Error) => void = console.error,
  onSuccess: () => void = () => undefined,
) {
  let timer: number | undefined;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void hydrateOnlineWorkspace(userId)
        .then(onSuccess)
        .catch((caught) =>
          onError(caught instanceof Error ? caught : new Error(String(caught))),
        );
    }, 120);
  };
  const channels = [
    "profiles",
    "servers",
    "server_members",
    "roles",
    "member_roles",
    "channels",
    "channel_members",
    "friendships",
    "blocks",
    "read_states",
    "bans",
    "invites",
    "channel_permission_overrides",
    "notification_settings",
    "audit_logs",
    "user_contacts",
    "dm_states",
    "server_privacy_settings",
  ].map((table) => {
    const channel = supabase
      .channel(`workspace:${userId}:${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, refresh);
    channel.subscribe((status) => {
      // A tabela pode estar restrita por RLS para este membro. As demais
      // assinaturas e a reconciliação periódica continuam independentes.
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") refresh();
    });
    return channel;
  });
  // Postgres Changes pode levar alguns segundos para aquecer após o Docker
  // iniciar. Esta reconciliação mantém navegadores diferentes consistentes
  // mesmo se o primeiro evento do slot lógico for perdido.
  const reconcileTimer = window.setInterval(refresh, 2_500);
  return () => {
    window.clearTimeout(timer);
    window.clearInterval(reconcileTimer);
    void Promise.all(
      channels.map((channel) => supabase.removeChannel(channel)),
    );
  };
}
