import { supabase } from "./client";

export interface UserContact {
  targetUserId: string;
  nickname?: string;
  note?: string;
  ignored: boolean;
}

export interface DmState {
  channelId: string;
  pinned: boolean;
  closed: boolean;
  /** `false` enquanto a conversa for uma solicitação de mensagem. */
  accepted: boolean;
}

export interface ServerPrivacy {
  serverId: string;
  allowDirectMessages: boolean;
  filterMessageRequests: boolean;
  shareActivity: boolean;
  allowActivityJoin: boolean;
}

export async function listUserContacts(userId: string) {
  const { data, error } = await supabase
    .from("user_contacts")
    .select("target_user_id, nickname, note, ignored")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    targetUserId: row.target_user_id,
    nickname: row.nickname ?? undefined,
    note: row.note ?? undefined,
    ignored: row.ignored,
  })) satisfies UserContact[];
}

async function upsertContact(
  userId: string,
  targetUserId: string,
  changes: Partial<Omit<UserContact, "targetUserId">>,
) {
  const values: Record<string, unknown> = {
    user_id: userId,
    target_user_id: targetUserId,
    updated_at: new Date().toISOString(),
  };
  if (changes.nickname !== undefined)
    values.nickname = changes.nickname.trim() || null;
  if (changes.note !== undefined) values.note = changes.note.trim() || null;
  if (changes.ignored !== undefined) values.ignored = changes.ignored;
  const { error } = await supabase
    .from("user_contacts")
    .upsert(values, { onConflict: "user_id,target_user_id" });
  if (error) throw error;
}

export const setFriendNickname = (
  userId: string,
  targetUserId: string,
  nickname: string,
) => upsertContact(userId, targetUserId, { nickname });

export const setContactNote = (
  userId: string,
  targetUserId: string,
  note: string,
) => upsertContact(userId, targetUserId, { note });

export const setContactIgnored = (
  userId: string,
  targetUserId: string,
  ignored: boolean,
) => upsertContact(userId, targetUserId, { ignored });

export async function listDmStates(userId: string) {
  const { data, error } = await supabase
    .from("dm_states")
    .select("channel_id, pinned, closed, accepted")
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    channelId: row.channel_id,
    pinned: row.pinned,
    closed: row.closed,
    accepted: row.accepted,
  })) satisfies DmState[];
}

export async function setDmState(
  userId: string,
  channelId: string,
  changes: Partial<Omit<DmState, "channelId">>,
) {
  const values: Record<string, unknown> = {
    user_id: userId,
    channel_id: channelId,
    updated_at: new Date().toISOString(),
  };
  if (changes.pinned !== undefined) values.pinned = changes.pinned;
  if (changes.closed !== undefined) values.closed = changes.closed;
  if (changes.accepted !== undefined) values.accepted = changes.accepted;
  const { error } = await supabase
    .from("dm_states")
    .upsert(values, { onConflict: "user_id,channel_id" });
  if (error) throw error;
}

export async function listServerPrivacy(userId: string) {
  const { data, error } = await supabase
    .from("server_privacy_settings")
    .select(
      "server_id, allow_direct_messages, filter_message_requests, share_activity, allow_activity_join",
    )
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    serverId: row.server_id,
    allowDirectMessages: row.allow_direct_messages,
    filterMessageRequests: row.filter_message_requests,
    shareActivity: row.share_activity,
    allowActivityJoin: row.allow_activity_join,
  })) satisfies ServerPrivacy[];
}

export async function saveServerPrivacy(
  userId: string,
  serverId: string,
  changes: Partial<Omit<ServerPrivacy, "serverId">>,
) {
  const values: Record<string, unknown> = {
    user_id: userId,
    server_id: serverId,
    updated_at: new Date().toISOString(),
  };
  if (changes.allowDirectMessages !== undefined)
    values.allow_direct_messages = changes.allowDirectMessages;
  if (changes.filterMessageRequests !== undefined)
    values.filter_message_requests = changes.filterMessageRequests;
  if (changes.shareActivity !== undefined)
    values.share_activity = changes.shareActivity;
  if (changes.allowActivityJoin !== undefined)
    values.allow_activity_join = changes.allowActivityJoin;
  const { error } = await supabase
    .from("server_privacy_settings")
    .upsert(values, { onConflict: "user_id,server_id" });
  if (error) throw error;
}

/** Aceita ou recusa uma solicitação de mensagem. */
export async function respondMessageRequest(
  channelId: string,
  accept: boolean,
) {
  const { error } = await supabase.rpc("respond_message_request", {
    p_channel_id: channelId,
    p_accept: accept,
  });
  if (error) throw error;
}

export interface DirectChannelUnread {
  channelId: string;
  lastMessageAt?: string;
  unreadCount: number;
  mentionCount: number;
}

export async function listDirectChannelUnreads() {
  const { data, error } = await supabase.rpc("direct_channel_unreads");
  if (error) throw error;
  return ((data ?? []) as any[]).map((row) => ({
    channelId: row.channel_id,
    lastMessageAt: row.last_message_at ?? undefined,
    unreadCount: row.unread_count ?? 0,
    mentionCount: row.mention_count ?? 0,
  })) satisfies DirectChannelUnread[];
}

/** Mantém os contadores da barra lateral em dia sem baixar o histórico. */
export function subscribeDirectChannelUnreads(
  userId: string,
  onUnreads: (unreads: DirectChannelUnread[]) => void,
  onError: (error: Error) => void = console.error,
  /** Ids das conversas diretas conhecidas, para ignorar o resto do tráfego. */
  directChannelIds: () => Set<string> = () => new Set(),
) {
  let active = true;
  let timer: number | undefined;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void listDirectChannelUnreads()
        .then((unreads) => active && onUnreads(unreads))
        .catch((caught) =>
          onError(caught instanceof Error ? caught : new Error(String(caught))),
        );
    }, 250);
  };
  // Uma mensagem de canal de servidor não muda contador nenhum desta lista;
  // recontar a cada uma delas só gastaria uma consulta por mensagem.
  const refreshIfDirect = (payload: {
    new?: { channel_id?: string };
    old?: { channel_id?: string };
  }) => {
    const channelId = payload.new?.channel_id ?? payload.old?.channel_id;
    if (channelId && !directChannelIds().has(channelId)) return;
    refresh();
  };
  const realtime = supabase
    .channel(`dm-unreads:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      refreshIfDirect,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "read_states" },
      refreshIfDirect,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });
  refresh();
  return () => {
    active = false;
    window.clearTimeout(timer);
    void supabase.removeChannel(realtime);
  };
}
