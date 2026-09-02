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

/**
 * As chamadas de que **esta pessoa** participou, da mais recente para a mais
 * antiga.
 *
 * A busca começa pela participação, e não pela sessão, porque `call_sessions`
 * é visível a quem pode entrar no canal — é o que sustenta o "ativo agora",
 * mostrando quem está na sala neste momento. Perguntar por sessões e confiar
 * nessa visibilidade trazia todas as chamadas já feitas em todo canal que a
 * pessoa alcança, e o painel de amigos listava conversas de outras contas com
 * nome e horário. Histórico é de quem esteve nele.
 *
 * Os participantes vêm inteiros no segundo passo, de propósito: filtrar a
 * sessão pela participação e ao mesmo tempo pedir só as linhas de quem
 * pergunta devolveria uma chamada sem a outra ponta, e a lista precisa dizer
 * com quem foi.
 */
export async function listRecentOnlineCalls(limit = 20) {
  const teto = Math.max(1, Math.min(limit, 50));
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  // Sem sessão não há histórico pessoal, e devolver o do canal seria o bug.
  if (!userId) return [];

  const { data: minhas, error: participationError } = await supabase
    .from("call_session_participants")
    .select("session_id,joined_at")
    .eq("user_id", userId)
    .order("joined_at", { ascending: false })
    .limit(teto);
  if (participationError) throw participationError;
  const ids = [...new Set((minhas ?? []).map((row) => row.session_id))];
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("call_sessions")
    .select(
      "id,channel_id,created_by,created_at,ended_at,call_session_participants(user_id,joined_at,left_at)",
    )
    .in("id", ids)
    .order("created_at", { ascending: false })
    .limit(teto);
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
/** Quem está no canal, e com o quê. */
export interface OnlineVoiceMember {
  userId: string;
  cameraOn: boolean;
  screenOn: boolean;
}

/** Participantes ativos por canal de voz, para "Ativo agora" e "Em voz". */
export type OnlineVoiceMembers = Record<string, OnlineVoiceMember[]>;

export async function listActiveOnlineVoiceMembers() {
  const { data, error } = await supabase
    .from("call_sessions")
    .select(
      "channel_id,call_session_participants(user_id,left_at,last_seen_at,camera_on,screen_on)",
    )
    .is("ended_at", null);
  if (error) throw error;
  const members: OnlineVoiceMembers = {};
  const freshAfter = Date.now() - 45_000;
  for (const session of data ?? []) {
    // Um mesmo usuário pode ter mais de um dispositivo na sala. Vale o
    // agregado: se qualquer aparelho dele está com a câmera aberta, ele está
    // com a câmera aberta para quem olha de fora.
    const byUser = new Map<string, OnlineVoiceMember>();
    for (const participant of session.call_session_participants ?? []) {
      if (participant.left_at !== null) continue;
      if (new Date(participant.last_seen_at).getTime() < freshAfter) continue;
      const current = byUser.get(participant.user_id);
      byUser.set(participant.user_id, {
        userId: participant.user_id,
        cameraOn: Boolean(current?.cameraOn) || Boolean(participant.camera_on),
        screenOn: Boolean(current?.screenOn) || Boolean(participant.screen_on),
      });
    }
    if (byUser.size) members[session.channel_id] = [...byUser.values()];
  }
  return members;
}

/**
 * Publica o que este dispositivo está transmitindo agora.
 *
 * Falhar aqui não pode derrubar a chamada: é informação de vitrine para a
 * barra lateral, e o heartbeat reafirma o estado logo em seguida.
 */
export async function setOnlineVoiceMediaState(input: {
  sessionId: string;
  deviceId: string;
  cameraOn: boolean;
  screenOn: boolean;
}) {
  const { error } = await supabase.rpc("set_voice_media_state", {
    p_session_id: input.sessionId,
    p_device_id: input.deviceId,
    p_camera_on: input.cameraOn,
    p_screen_on: input.screenOn,
  });
  if (error) console.warn("[voz] estado de mídia não publicado", error.message);
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
  // Eram 4 s. Cada participante já emite heartbeat, e cada heartbeat vira
  // evento de Realtime que dispara `refresh` em todo mundo — a sondagem por
  // cima disso só somava tráfego. Quinze segundos cobre a perda de evento, e a
  // aba escondida não gasta nada.
  const reconcileTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") refresh();
  }, 15_000);
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
