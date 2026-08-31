import { useEffect, useState, type CSSProperties } from "react";
import type { Profile } from "../domain/types";
import { IconPhone, IconPhoneOff, IconVideo, IconX } from "./icons";
import type { OutgoingCallStatus } from "../hooks/useCallSignaling";

type CallPerson = Pick<
  Profile,
  "displayName" | "avatar" | "avatarUrl" | "color" | "status"
>;

function CallAvatar({ person }: { person: CallPerson }) {
  return (
    <span
      className="call-overlay-avatar"
      style={{ "--avatar-color": person.color } as CSSProperties}
    >
      {person.avatarUrl ? (
        <img src={person.avatarUrl} alt="" />
      ) : (
        <b>{person.avatar}</b>
      )}
    </span>
  );
}

/**
 * Chamada recebida. Fica acima de qualquer tela — a pessoa pode estar num
 * servidor, numa conversa ou nas configurações quando o telefone toca.
 */
export function IncomingCallOverlay({
  caller,
  withVideo,
  busy,
  onAnswerAudio,
  onAnswerVideo,
  onDecline,
}: {
  caller: CallPerson;
  withVideo: boolean;
  busy: boolean;
  onAnswerAudio: () => void;
  onAnswerVideo: () => void;
  onDecline: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDecline();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onDecline]);

  return (
    <div className="call-overlay-backdrop" role="presentation">
      <section
        className="call-overlay incoming"
        role="dialog"
        aria-modal="true"
        aria-label={`Chamada recebida de ${caller.displayName}`}
      >
        <span className="call-overlay-pulse" aria-hidden="true" />
        <CallAvatar person={caller} />
        <h2>{caller.displayName}</h2>
        <p className="call-overlay-subtitle">
          {withVideo
            ? "Chamada de vídeo recebida"
            : "Chamada de voz recebida"}
        </p>
        <div className="call-overlay-actions">
          <button
            className="call-answer audio"
            disabled={busy}
            onClick={onAnswerAudio}
          >
            <IconPhone size={24} />
            <span>Atender com áudio</span>
          </button>
          <button
            className="call-answer video"
            disabled={busy}
            onClick={onAnswerVideo}
          >
            <IconVideo size={24} />
            <span>Atender com vídeo</span>
          </button>
          <button
            className="call-answer decline"
            disabled={busy}
            onClick={onDecline}
          >
            <IconPhoneOff size={24} />
            <span>Recusar</span>
          </button>
        </div>
      </section>
    </div>
  );
}

const OUTGOING_COPY: Record<OutgoingCallStatus, string> = {
  ringing: "Chamando…",
  declined: "Chamada recusada",
  missed: "Ninguém atendeu",
  cancelled: "Chamada cancelada",
};

/** O que quem liga vê enquanto espera — e quando a espera termina. */
export function OutgoingCallOverlay({
  peer,
  withVideo,
  status,
  onCancel,
  onDismiss,
}: {
  peer: CallPerson;
  withVideo: boolean;
  status: OutgoingCallStatus;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const ringing = status === "ringing";

  useEffect(() => {
    if (!ringing) return;
    const timer = window.setInterval(
      () => setSeconds((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [ringing]);

  // Um resultado não fica na tela para sempre: some sozinho depois de um
  // instante, como o aviso de "chamada recusada" de um telefone.
  useEffect(() => {
    if (ringing) return;
    const timer = window.setTimeout(onDismiss, 3200);
    return () => window.clearTimeout(timer);
  }, [onDismiss, ringing, status]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (ringing) onCancel();
      else onDismiss();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onCancel, onDismiss, ringing]);

  return (
    <div className="call-overlay-backdrop" role="presentation">
      <section
        className={`call-overlay outgoing ${status}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Chamando ${peer.displayName}`}
      >
        {ringing && <span className="call-overlay-pulse" aria-hidden="true" />}
        <CallAvatar person={peer} />
        <h2>{peer.displayName}</h2>
        <p className="call-overlay-subtitle" role="status">
          {OUTGOING_COPY[status]}
          {ringing && seconds > 0 ? ` ${seconds}s` : ""}
        </p>
        <p className="call-overlay-kind">
          {withVideo ? "Chamada de vídeo" : "Chamada de voz"}
        </p>
        <div className="call-overlay-actions">
          {ringing ? (
            <button className="call-answer decline" onClick={onCancel}>
              <IconPhoneOff size={24} />
              <span>Cancelar</span>
            </button>
          ) : (
            <button className="call-answer dismiss" onClick={onDismiss}>
              <IconX size={24} />
              <span>Fechar</span>
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
