import { supabase } from "./client";

/**
 * Sinalização de toque das chamadas.
 *
 * O LiveKit cuida da mídia depois que os dois lados entram na sala; o que
 * faltava era o telefone tocar. Cada convite é uma linha em `call_invites`
 * observada por Realtime pelos dois lados, então quem liga vê "Chamando…"
 * virar "Atendida" ou "Recusada" no mesmo instante em que o outro decide.
 */

export type CallInviteState =
  | "ringing"
  | "accepted"
  | "declined"
  | "cancelled"
  | "missed";

export interface CallInvite {
  id: string;
  channelId: string;
  callerId: string;
  calleeId: string;
  withVideo: boolean;
  acceptedWithVideo?: boolean;
  state: CallInviteState;
  createdAt: string;
  respondedAt?: string;
  expiresAt: string;
}

const RING_TIMEOUT_MS = 45_000;

const toInvite = (row: any): CallInvite => ({
  id: row.id,
  channelId: row.channel_id,
  callerId: row.caller_id,
  calleeId: row.callee_id,
  withVideo: row.with_video,
  acceptedWithVideo: row.accepted_with_video ?? undefined,
  state: row.state,
  createdAt: row.created_at,
  respondedAt: row.responded_at ?? undefined,
  expiresAt: row.expires_at,
});

export async function startCallInvite(channelId: string, withVideo: boolean) {
  const { data, error } = await supabase.rpc("start_call_invite", {
    p_channel_id: channelId,
    p_with_video: withVideo,
  });
  if (error) throw error;
  return ((data ?? []) as any[]).map(toInvite);
}

export async function respondCallInvite(
  inviteId: string,
  accept: boolean,
  withVideo = false,
) {
  const { data, error } = await supabase.rpc("respond_call_invite", {
    p_invite_id: inviteId,
    p_accept: accept,
    p_with_video: withVideo,
  });
  if (error) throw error;
  return data ? toInvite(data) : null;
}

export async function cancelCallInvite({
  inviteId,
  channelId,
}: {
  inviteId?: string;
  channelId?: string;
}) {
  const { error } = await supabase.rpc("cancel_call_invite", {
    p_invite_id: inviteId ?? null,
    p_channel_id: channelId ?? null,
  });
  if (error) throw error;
}

export async function listOpenCallInvites(userId: string) {
  // Marcar as vencidas antes de ler evita ressuscitar um toque antigo depois
  // de um refresh — o modal só volta para uma chamada que ainda está de pé.
  const { error: expireError } = await supabase.rpc("expire_call_invites");
  if (expireError) throw expireError;
  const { data, error } = await supabase
    .from("call_invites")
    .select("*")
    .or(`caller_id.eq.${userId},callee_id.eq.${userId}`)
    .gte("created_at", new Date(Date.now() - RING_TIMEOUT_MS * 4).toISOString())
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return ((data ?? []) as any[]).map(toInvite);
}

/**
 * Observa os convites do usuário. O callback recebe a lista completa das
 * linhas recentes; reconciliar por lista (em vez de aplicar eventos soltos)
 * evita que um evento perdido deixe um modal de chamada preso na tela.
 */
export function subscribeCallInvites(
  userId: string,
  onInvites: (invites: CallInvite[]) => void,
  onError: (error: Error) => void = console.error,
) {
  let active = true;
  let timer: number | undefined;
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      void listOpenCallInvites(userId)
        .then((invites) => active && onInvites(invites))
        .catch((caught) =>
          onError(caught instanceof Error ? caught : new Error(String(caught))),
        );
    }, 60);
  };
  const realtime = supabase
    .channel(`call-invites:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "call_invites" },
      refresh,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") refresh();
    });
  // O toque tem prazo: sem esta reconciliação um convite vencido continuaria
  // tocando até chegar algum outro evento da tabela.
  const reconcile = window.setInterval(refresh, 3_000);
  refresh();
  return () => {
    active = false;
    window.clearTimeout(timer);
    window.clearInterval(reconcile);
    void supabase.removeChannel(realtime);
  };
}
