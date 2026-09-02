import { useEffect, useState, type CSSProperties } from "react";
import type { Profile } from "../domain/types";
import {
  IconBan,
  IconCheck,
  IconMessage,
  IconPencil,
  IconPhone,
  IconUserPlus,
  IconUserX,
  IconVideo,
  IconX,
} from "./icons";
import { ProfileCard } from "./ProfileCard";

export interface UserProfileActions {
  message: () => void;
  callVoice: () => void;
  callVideo: () => void;
  removeFriend?: () => void;
  /** Enviar pedido de amizade a quem ainda não é amigo. */
  addFriend?: () => void;
  /** Responder a um pedido recebido. */
  acceptFriend?: () => void;
  declineFriend?: () => void;
  /** Cancelar um pedido que este usuário enviou. */
  cancelFriendRequest?: () => void;
  block?: () => void;
  unblock?: () => void;
  saveNote: (note: string) => void;
  saveNickname: (nickname: string) => void;
}

/** Relação entre as duas contas, que decide quais ações fazem sentido. */
export type UserRelationship =
  | "none"
  | "friend"
  | "incoming-request"
  | "outgoing-request"
  | "blocked"
  | "blocked-by";

/** Cartão de perfil de outro usuário, no formato do Discord. */
export function UserProfileModal({
  profile,
  nickname,
  note,
  relationship,
  busy = false,
  mutualServers,
  actions,
  onClose,
}: {
  profile: Profile;
  nickname?: string;
  note?: string;
  relationship: UserRelationship;
  busy?: boolean;
  mutualServers: string[];
  actions: UserProfileActions;
  onClose: () => void;
}) {
  const isFriend = relationship === "friend";
  // Bloqueio corta a interação nos dois sentidos: nem mensagem, nem chamada.
  const blocked = relationship === "blocked" || relationship === "blocked-by";
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [editingNickname, setEditingNickname] = useState(false);
  const [draftNickname, setDraftNickname] = useState(nickname ?? "");

  useEffect(() => setDraftNote(note ?? ""), [note]);
  useEffect(() => setDraftNickname(nickname ?? ""), [nickname]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="user-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Perfil de ${profile.displayName}`}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="close-settings"
          aria-label="Fechar perfil"
          onClick={onClose}
        >
          <IconX size={20} />
        </button>
        <ProfileCard profile={profile} nickname={nickname}>
          {mutualServers.length > 0 && (
            <div className="user-profile-section">
              <span className="eyebrow">
                SERVIDORES EM COMUM — {mutualServers.length}
              </span>
              <p>{mutualServers.join(", ")}</p>
            </div>
          )}

          <div className="user-profile-section">
            <span className="eyebrow">APELIDO DE AMIGO</span>
            {editingNickname ? (
              <div className="user-profile-inline">
                <input
                  autoFocus
                  value={draftNickname}
                  maxLength={32}
                  placeholder={profile.displayName}
                  onChange={(event) => setDraftNickname(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    actions.saveNickname(draftNickname);
                    setEditingNickname(false);
                  }}
                />
                <button
                  className="primary-button"
                  onClick={() => {
                    actions.saveNickname(draftNickname);
                    setEditingNickname(false);
                  }}
                >
                  Salvar
                </button>
              </div>
            ) : (
              <button
                className="user-profile-nickname"
                onClick={() => setEditingNickname(true)}
              >
                <span>{nickname || "Adicionar apelido"}</span>
                <IconPencil size={15} />
              </button>
            )}
          </div>

          <div className="user-profile-section">
            <span className="eyebrow">NOTA</span>
            <textarea
              className="user-profile-note"
              value={draftNote}
              maxLength={256}
              rows={2}
              placeholder="Escreva uma nota (visível apenas para você)"
              onChange={(event) => setDraftNote(event.target.value)}
              onBlur={() => {
                if (draftNote !== (note ?? "")) actions.saveNote(draftNote);
              }}
            />
          </div>

          {blocked && (
            <p className="user-profile-blocked" role="status">
              {relationship === "blocked"
                ? "Você bloqueou esta pessoa. Mensagens e chamadas estão desativadas."
                : "Esta pessoa bloqueou você. Mensagens e chamadas estão desativadas."}
            </p>
          )}

          <div className="user-profile-actions">
            <button
              className="primary-button"
              disabled={busy || blocked}
              onClick={actions.message}
            >
              <IconMessage size={18} />
              Mensagem
            </button>
            <button
              className="icon-button"
              aria-label="Chamada de voz"
              title="Chamada de voz"
              disabled={busy || blocked}
              onClick={actions.callVoice}
            >
              <IconPhone size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Chamada de vídeo"
              title="Chamada de vídeo"
              disabled={busy || blocked}
              onClick={actions.callVideo}
            >
              <IconVideo size={20} />
            </button>
            {relationship === "none" && actions.addFriend && (
              <button
                className="icon-button accept"
                aria-label="Adicionar amigo"
                title="Adicionar amigo"
                disabled={busy}
                onClick={actions.addFriend}
              >
                <IconUserPlus size={20} />
              </button>
            )}
            {relationship === "incoming-request" && (
              <>
                {actions.acceptFriend && (
                  <button
                    className="icon-button accept"
                    aria-label="Aceitar pedido de amizade"
                    title="Aceitar pedido"
                    disabled={busy}
                    onClick={actions.acceptFriend}
                  >
                    <IconCheck size={20} />
                  </button>
                )}
                {actions.declineFriend && (
                  <button
                    className="icon-button danger-text"
                    aria-label="Recusar pedido de amizade"
                    title="Recusar pedido"
                    disabled={busy}
                    onClick={actions.declineFriend}
                  >
                    <IconX size={20} />
                  </button>
                )}
              </>
            )}
            {relationship === "outgoing-request" &&
              actions.cancelFriendRequest && (
                <button
                  className="icon-button"
                  aria-label="Cancelar pedido de amizade"
                  title="Pedido enviado — cancelar"
                  disabled={busy}
                  onClick={actions.cancelFriendRequest}
                >
                  <IconX size={20} />
                </button>
              )}
            {isFriend && actions.removeFriend && (
              <button
                className="icon-button"
                aria-label="Desfazer amizade"
                title="Desfazer amizade"
                disabled={busy}
                onClick={actions.removeFriend}
              >
                <IconUserX size={20} />
              </button>
            )}
            {relationship === "blocked"
              ? actions.unblock && (
                  <button
                    className="icon-button accept"
                    aria-label="Desbloquear"
                    title="Desbloquear"
                    disabled={busy}
                    onClick={actions.unblock}
                  >
                    <IconUserPlus size={20} />
                  </button>
                )
              : actions.block && (
                  <button
                    className="icon-button danger-text"
                    aria-label="Bloquear"
                    title="Bloquear"
                    disabled={busy}
                    onClick={actions.block}
                  >
                    <IconBan size={20} />
                  </button>
                )}
          </div>
        </ProfileCard>
      </section>
    </div>
  );
}
