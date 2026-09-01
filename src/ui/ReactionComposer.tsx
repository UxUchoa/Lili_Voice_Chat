import { useEffect, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import {
  REACTION_MAX_GRAPHEMES,
  countGraphemes,
  normalizeReaction,
  reactionError,
  truncateGraphemes,
} from "../domain/reactions";

/**
 * Campo de reação personalizada.
 *
 * Substitui o `window.prompt`, que trava a página, ignora o tema e não tem
 * como mostrar contador nem recusar antes de fechar. Segue o mesmo desenho do
 * `ConfirmModal`: portal, backdrop, Escape fecha, foco entra no campo.
 *
 * A contagem é em grafemas, não em `length`: `"❤️".length` é 2 e
 * `"👨‍👩‍👧".length` é 8, então medir por `length` recusaria um único emoji.
 */
export function ReactionComposer({
  onSubmit,
  onClose,
}: {
  onSubmit: (reaction: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("👍");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const used = countGraphemes(normalizeReaction(value));
  const error = reactionError(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const accept = () => {
    setTouched(true);
    if (error) return;
    onSubmit(normalizeReaction(value));
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
          className="confirm-modal reaction-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reaction-title"
        >
          <h2 id="reaction-title">Adicionar reação</h2>
          <p>Um emoji, um texto curto, ou os dois juntos.</p>
          <label className="reaction-field">
            <input
              ref={inputRef}
              value={value}
              autoComplete="off"
              aria-label="Reação"
              aria-invalid={touched && Boolean(error)}
              // O corte preserva grafemas: colar um texto longo nunca parte um
              // emoji ao meio.
              onChange={(event) => {
                setTouched(true);
                setValue(
                  truncateGraphemes(event.target.value, REACTION_MAX_GRAPHEMES),
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") accept();
              }}
            />
            <span
              className={`reaction-counter ${used > REACTION_MAX_GRAPHEMES ? "over" : ""}`}
            >
              {used} / {REACTION_MAX_GRAPHEMES}
            </span>
          </label>
          {touched && error && (
            <p className="reaction-error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="primary-button"
              disabled={Boolean(error)}
              onClick={accept}
            >
              Reagir
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
