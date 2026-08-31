import { useCallback, useEffect, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";

export interface ConfirmRequest {
  title: string;
  /** Corpo da pergunta. Uma frase; o que será perdido, não como fazer. */
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Vermelho no botão de confirmar — para o que não tem volta. */
  danger?: boolean;
  /**
   * Exige digitar exatamente este texto antes de liberar a confirmação.
   * Reservado para o que apaga estrutura inteira, como excluir um servidor.
   */
  requireText?: string;
  onConfirm: () => void;
}

function ConfirmModal({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const armed = !request.requireText || typed.trim() === request.requireText;

  useEffect(() => {
    // Foco no campo quando ele existe; no botão quando não existe. Sem isto o
    // Enter/Esc só funcionaria depois de um clique.
    (inputRef.current ?? confirmRef.current)?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const accept = () => {
    if (!armed) return;
    request.onConfirm();
    onClose();
  };

  return (
    <ModalPortal>
      <div
        className="modal-backdrop confirm-backdrop"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          className="confirm-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
        >
          <h2 id="confirm-title">{request.title}</h2>
          <p id="confirm-message">{request.message}</p>
          {request.requireText && (
            <label className="confirm-guard">
              {/* O texto precisa de um elemento próprio: solto num container
                  flex em coluna, cada trecho vira um item e a frase quebra em
                  três linhas. */}
              <span>
                Digite <b>{request.requireText}</b> para confirmar
              </span>
              <input
                ref={inputRef}
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") accept();
                }}
              />
            </label>
          )}
          <div className="confirm-actions">
            <button className="outline-button" onClick={onClose}>
              {request.cancelLabel ?? "Cancelar"}
            </button>
            <button
              ref={confirmRef}
              className={request.danger ? "danger-button" : "primary-button"}
              disabled={!armed}
              onClick={accept}
            >
              {request.confirmLabel ?? "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Substitui `window.confirm`, que trava a página, ignora o tema e não deixa
 * exigir nada além de um clique. Devolve `ask` para pedir a confirmação e o
 * elemento que precisa ser renderizado uma vez na árvore.
 */
export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const ask = useCallback((next: ConfirmRequest) => setRequest(next), []);
  const close = useCallback(() => setRequest(null), []);
  return {
    ask,
    confirmDialog: request ? (
      <ConfirmModal request={request} onClose={close} />
    ) : null,
  };
}
