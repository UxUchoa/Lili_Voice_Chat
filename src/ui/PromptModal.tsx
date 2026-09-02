import { useCallback, useEffect, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";

export interface PromptRequest {
  title: string;
  /** Uma frase explicando o que será feito com o texto. */
  message?: string;
  label: string;
  /** Valor inicial, para editar algo que já existe. */
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  maxLength?: number;
  /** Campo de várias linhas — para nota e motivo, que costumam ser frases. */
  multiline?: boolean;
  /** Deixa confirmar com o campo vazio: é assim que se apaga uma nota. */
  allowEmpty?: boolean;
  /** Vermelho no botão de confirmar — para punições e afins. */
  danger?: boolean;
  /** Recebe o texto já sem espaços nas pontas. */
  onSubmit: (value: string) => void;
}

function PromptModal({
  request,
  onClose,
}: {
  request: PromptRequest;
  onClose: () => void;
}) {
  const [value, setValue] = useState(request.initialValue ?? "");
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const armed = request.allowEmpty || Boolean(value.trim());

  useEffect(() => {
    const field = fieldRef.current;
    field?.focus();
    // Seleciona o que já estava lá: editar um apelido quase sempre começa
    // apagando o anterior.
    field?.select();
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
    request.onSubmit(value.trim());
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
          className="confirm-modal prompt-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-modal-title"
        >
          <h2 id="prompt-modal-title">{request.title}</h2>
          {request.message && <p>{request.message}</p>}
          <label className="prompt-modal-field">
            <span>{request.label}</span>
            {request.multiline ? (
              <textarea
                ref={fieldRef as React.RefObject<HTMLTextAreaElement>}
                value={value}
                rows={3}
                maxLength={request.maxLength}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  // Num campo de várias linhas o Enter quebra linha; enviar é
                  // Ctrl+Enter, como no compositor.
                  if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                    accept();
                }}
              />
            ) : (
              <input
                ref={fieldRef as React.RefObject<HTMLInputElement>}
                value={value}
                maxLength={request.maxLength}
                placeholder={request.placeholder}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") accept();
                }}
              />
            )}
          </label>
          <div className="confirm-actions">
            <button className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className={`primary-button ${request.danger ? "danger" : ""}`}
              disabled={!armed}
              onClick={accept}
            >
              {request.confirmLabel ?? "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

/**
 * Substitui `window.prompt` — item 25.
 *
 * O diálogo nativo trava a página inteira, ignora o tema, não tem rótulo nem
 * limite de tamanho, e no Chromium do Electron nem sempre aparece. Segue o
 * mesmo formato de `useConfirm`: devolve `ask` e o elemento que precisa ser
 * renderizado uma vez na árvore.
 *
 * `undefined` do cancelamento vira "não chamou `onSubmit`", e não uma string
 * vazia: apagar uma nota e desistir de editá-la são coisas diferentes.
 */
export function usePrompt() {
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const ask = useCallback((next: PromptRequest) => setRequest(next), []);
  const close = useCallback(() => setRequest(null), []);
  return {
    ask,
    promptDialog: request ? (
      <PromptModal request={request} onClose={close} />
    ) : null,
  };
}
