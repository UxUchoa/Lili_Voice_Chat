import { supabase } from "./client";

export interface OnlineCallSession {
  id: string;
  channelId: string;
  createdBy: string;
  createdAt: string;
  endedAt?: string;
  participants: Array<{
    userId: string;
    joinedAt: string;
    leftAt?: string;
  }>;
}

export async function listRecentOnlineCalls(limit = 20) {
  const { data, error } = await supabase
    .from("call_sessions")
    .select(
      "id,channel_id,created_by,created_at,ended_at,call_session_participants(user_id,joined_at,left_at)",
    )
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 50)));
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    channelId: row.channel_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    endedAt: row.ended_at ?? undefined,
    participants: (row.call_session_participants ?? []).map((participant) => ({
      userId: participant.user_id,
      joinedAt: participant.joined_at,
      leftAt: participant.left_at ?? undefined,
    })),
  })) satisfies OnlineCallSession[];
}

export type OnlineVoiceCounts = Record<string, number>;
/** Participantes ativos por canal de voz, para "Ativo agora" e "Em voz". */
export type OnlineVoiceMembers = Record<string, string[]>;

export async function listActiveOnlineVoiceMembers() {
  const { data, error } = await supabase
    .from("call_sessions")
    .select("channel_id,call_session_participants(user_id,left_at,last_seen_at)")
    .is("ended_at", null);
  if (error) throw error;
  const members: OnlineVoiceMembers = {};
  const freshAfter = Date.now() - 45_000;
  for (const session of data ?? []) {
    const users = [
      ...new Set(
        (session.call_session_participants ?? [])
          .filter(
            (participant) =>
              participant.left_at === null &&
              new Date(participant.last_seen_at).getTime() >= freshAfter,
          )
          .map((participant) => participant.user_id),
      ),
    ];
    if (users.length) members[session.channel_id] = users;
  }
  return members;
}

export function subscribeActiveOnlineVoiceMembers(
  userId: string,
  onMembers: (members: OnlineVoiceMembers) => void,
  onError: (error: Error) => void = console.error,
) {
  let timer: number | undefined;
  let active = true;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void listActiveOnlineVoiceMembers()
        .then((members) => active && onMembers(members))
        .catch((caught) =>
          onError(caught instanceof Error ? caught : new Error(String(caught))),
        );
    }, 120);
  };
  const realtime = supabase
    .channel(`voice-members:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_sessions" },
      refresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_session_participants" },
      refresh,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });
  const reconcileTimer = window.setInterval(refresh, 4_000);
  refresh();
  return () => {
    active = false;
    window.clearTimeout(timer);
    window.clearInterval(reconcileTimer);
    void supabase.removeChannel(realtime);
  };
}

export async function listActiveOnlineVoiceCounts() {
  const { error: reapError } = await supabase.rpc(
    "reap_stale_call_participants",
  );
  if (reapError) throw reapError;
  const { data, error } = await supabase
    .from("call_sessions")
    .select(
      "channel_id,call_session_participants(user_id,left_at,last_seen_at)",
    )
    .is("ended_at", null);
  if (error) throw error;
  const counts: OnlineVoiceCounts = {};
  const freshAfter = Date.now() - 45_000;
  for (const session of data ?? []) {
    const activeUsers = new Set(
      (session.call_session_participants ?? [])
        .filter(
          (participant) =>
            participant.left_at === null &&
            new Date(participant.last_seen_at).getTime() >= freshAfter,
        )
        .map((participant) => participant.user_id),
    );
    counts[session.channel_id] = activeUsers.size;
  }
  return counts;
}

export function subscribeActiveOnlineVoiceCounts(
  userId: string,
  onCounts: (counts: OnlineVoiceCounts) => void,
  onError: (error: Error) => void = console.error,
) {
  let timer: number | undefined;
  let active = true;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void listActiveOnlineVoiceCounts()
        .then((counts) => active && onCounts(counts))
        .catch((caught) =>
          onError(caught instanceof Error ? caught : new Error(String(caught))),
        );
    }, 80);
  };
  const realtime = supabase
    .channel(`voice-counts:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_sessions" },
      refresh,
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_session_participants" },
      refresh,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });
  const reconcileTimer = window.setInterval(refresh, 2_500);
  refresh();
  return () => {
    active = false;
    window.clearTimeout(timer);
    window.clearInterval(reconcileTimer);
    void supabase.removeChannel(realtime);
  };
}

export interface OnlineVoiceMoveRequest {
  requestId: string;
  serverId: string;
  sourceChannelId: string;
  destinationChannelId: string;
}

export function subscribeVoiceMoveRequests(
  userId: string,
  onMove: (request: OnlineVoiceMoveRequest) => void | Promise<void>,
  onError: (error: Error) => void = console.error,
) {
  let processing = false;
  const claim = async () => {
    if (processing) return;
    processing = true;
    try {
      while (true) {
        const { data, error } = await supabase.rpc("claim_voice_move_request");
        if (error) throw error;
        const row = data?.[0];
        if (!row) return;
        await onMove({
          requestId: row.request_id,
          serverId: row.server_id,
          sourceChannelId: row.source_channel_id,
          destinationChannelId: row.destination_channel_id,
        });
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught : new Error(String(caught)));
    } finally {
      processing = false;
    }
  };
  const realtime = supabase
    .channel(`voice-moves:${userId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "voice_move_requests",
        filter: `target_user_id=eq.${userId}`,
      },
      () => void claim(),
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") void claim();
    });
  const reconcileTimer = window.setInterval(() => void claim(), 2_000);
  return () => {
    window.clearInterval(reconcileTimer);
    void supabase.removeChannel(realtime);
  };
}
