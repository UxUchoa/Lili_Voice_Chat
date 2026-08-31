import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelCallInvite,
  respondCallInvite,
  startCallInvite,
  subscribeCallInvites,
  type CallInvite,
} from "../services/online/callInvites";
import { playSound, startRingtone, stopRingtone } from "../services/sounds";

export type OutgoingCallStatus =
  | "ringing"
  | "declined"
  | "missed"
  | "cancelled";

export interface OutgoingCall {
  channelId: string;
  withVideo: boolean;
  status: OutgoingCallStatus;
}

/**
 * Sinalização de chamada dos dois lados.
 *
 * Quem liga fica em "Chamando…" até o outro lado responder; quem recebe vê o
 * modal com toque, e só entramos na sala LiveKit quando a chamada é aceita.
 * Assim não sobra sessão fantasma no histórico quando ninguém atende, e os
 * dois lados entram praticamente juntos.
 *
 * O estado de "chamando" é derivado dos próprios convites, não de um estado
 * local: se a aba de quem ligou recarregar, ele volta a ver a chamada em
 * curso e pode cancelá-la, em vez de deixar o telefone do outro tocando sem
 * dono até expirar.
 */
export function useCallSignaling(
  currentUserId: string,
  {
    activeCallChannelId,
    onAccepted,
    onError,
  }: {
    /** Canal da chamada em que este cliente já está, se houver. */
    activeCallChannelId: string;
    /** Entrar na chamada: aceite local ou aceite do outro lado. */
    onAccepted: (channelId: string, withVideo: boolean) => void;
    onError: (message: string) => void;
  },
) {
  const [invites, setInvites] = useState<CallInvite[]>([]);
  const [outcome, setOutcome] = useState<OutgoingCall | null>(null);
  const [busy, setBusy] = useState(false);
  // Convites já resolvidos por este cliente. Sem isto, o eco do Realtime
  // reabriria o modal por um instante depois de atender ou recusar.
  const handledRef = useRef(new Set<string>());
  const callingChannelRef = useRef("");
  const onAcceptedRef = useRef(onAccepted);
  const onErrorRef = useRef(onError);
  onAcceptedRef.current = onAccepted;
  onErrorRef.current = onError;

  useEffect(() => {
    if (!currentUserId) return;
    return subscribeCallInvites(currentUserId, setInvites, (caught) =>
      onErrorRef.current(caught.message),
    );
  }, [currentUserId]);

  const incoming =
    invites.find(
      (invite) =>
        invite.calleeId === currentUserId &&
        invite.state === "ringing" &&
        new Date(invite.expiresAt).getTime() > Date.now() &&
        // Já estar na chamada deste canal significa que o convite foi aceito
        // por outro caminho; não faz sentido tocar de novo.
        invite.channelId !== activeCallChannelId &&
        !handledRef.current.has(invite.id),
    ) ?? null;

  // Toca enquanto houver chamada recebida — e só enquanto houver. A dependência
  // é o id, não o objeto: a reconciliação periódica recria as linhas a cada
  // poucos segundos e reiniciaria o laço no meio do motivo, o que soaria como
  // dois telefones tocando fora de fase.
  const incomingId = incoming?.id ?? "";
  useEffect(() => {
    if (incomingId) startRingtone();
    else stopRingtone();
    return stopRingtone;
  }, [incomingId]);

  const ringingOutgoing = useMemo(
    () =>
      invites.find(
        (invite) =>
          invite.callerId === currentUserId &&
          invite.state === "ringing" &&
          new Date(invite.expiresAt).getTime() > Date.now(),
      ) ?? null,
    [currentUserId, invites],
  );

  // Lembra qual canal este cliente está chamando, inclusive quando a
  // informação veio do banco depois de um refresh.
  if (ringingOutgoing) callingChannelRef.current = ringingOutgoing.channelId;

  // Desfecho da chamada que este cliente originou.
  useEffect(() => {
    const channelId = callingChannelRef.current;
    if (!channelId || ringingOutgoing) return;
    const mine = invites.filter(
      (invite) =>
        invite.callerId === currentUserId && invite.channelId === channelId,
    );
    if (mine.length === 0) return;
    callingChannelRef.current = "";
    const accepted = mine.find((invite) => invite.state === "accepted");
    if (accepted) {
      // A tela de chamada passa a ser o feedback; manter o "Chamando…" por
      // cima dela só esconderia a chamada que acabou de começar.
      setOutcome(null);
      onAcceptedRef.current(
        channelId,
        accepted.acceptedWithVideo ?? accepted.withVideo,
      );
      return;
    }
    const status: OutgoingCallStatus = mine.some(
      (invite) => invite.state === "declined",
    )
      ? "declined"
      : mine.some((invite) => invite.state === "cancelled")
        ? "cancelled"
        : "missed";
    // Cancelar é decisão de quem ligou: o aviso serve para recusa e para
    // chamada não atendida, não para o próprio desligar.
    if (status !== "cancelled") {
      playSound("call-declined");
      setOutcome({
        channelId,
        withVideo: mine[0]?.withVideo ?? false,
        status,
      });
    }
  }, [currentUserId, invites, ringingOutgoing]);

  const outgoing: OutgoingCall | null = ringingOutgoing
    ? {
        channelId: ringingOutgoing.channelId,
        withVideo: ringingOutgoing.withVideo,
        status: "ringing",
      }
    : outcome;

  const startCall = useCallback(
    async (channelId: string, withVideo: boolean) => {
      setBusy(true);
      setOutcome(null);
      try {
        const created = await startCallInvite(channelId, withVideo);
        if (created.length === 0) {
          onErrorRef.current(
            "Não há ninguém para chamar nesta conversa no momento.",
          );
          return;
        }
        callingChannelRef.current = channelId;
        // Mostra "Chamando…" na hora, sem esperar o próximo evento do
        // Realtime: o retorno da RPC já é a verdade do servidor.
        setInvites((current) => [
          ...created,
          ...current.filter(
            (invite) => !created.some((item) => item.id === invite.id),
          ),
        ]);
      } catch (caught) {
        onErrorRef.current(
          caught instanceof Error
            ? caught.message
            : "Não foi possível iniciar a chamada.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const cancelCall = useCallback(async () => {
    const channelId = callingChannelRef.current;
    callingChannelRef.current = "";
    setOutcome(null);
    if (!channelId) return;
    setInvites((current) =>
      current.map((invite) =>
        invite.callerId === currentUserId &&
        invite.channelId === channelId &&
        invite.state === "ringing"
          ? { ...invite, state: "cancelled" as const }
          : invite,
      ),
    );
    try {
      await cancelCallInvite({ channelId });
    } catch (caught) {
      onErrorRef.current(
        caught instanceof Error
          ? caught.message
          : "Não foi possível cancelar a chamada.",
      );
    }
  }, [currentUserId]);

  const dismissOutgoing = useCallback(() => setOutcome(null), []);

  const answerCall = useCallback(
    async (invite: CallInvite, withVideo: boolean) => {
      handledRef.current.add(invite.id);
      stopRingtone();
      setBusy(true);
      try {
        const result = await respondCallInvite(invite.id, true, withVideo);
        if (result && result.state !== "accepted") {
          onErrorRef.current(
            result.state === "cancelled"
              ? "A chamada foi cancelada."
              : "A chamada não está mais disponível.",
          );
          return;
        }
        onAcceptedRef.current(invite.channelId, withVideo);
      } catch (caught) {
        handledRef.current.delete(invite.id);
        onErrorRef.current(
          caught instanceof Error
            ? caught.message
            : "Não foi possível atender a chamada.",
        );
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const declineCall = useCallback(async (invite: CallInvite) => {
    handledRef.current.add(invite.id);
    stopRingtone();
    setInvites((current) =>
      current.map((item) =>
        item.id === invite.id ? { ...item, state: "declined" as const } : item,
      ),
    );
    try {
      await respondCallInvite(invite.id, false);
    } catch (caught) {
      onErrorRef.current(
        caught instanceof Error
          ? caught.message
          : "Não foi possível recusar a chamada.",
      );
    }
  }, []);

  /** Encerrar a chamada também cancela qualquer toque ainda pendente. */
  const hangUp = useCallback(async (channelId: string) => {
    callingChannelRef.current = "";
    setOutcome(null);
    await cancelCallInvite({ channelId }).catch(() => undefined);
  }, []);

  return {
    incoming,
    outgoing,
    busy,
    startCall,
    cancelCall,
    dismissOutgoing,
    answerCall,
    declineCall,
    hangUp,
  };
}
