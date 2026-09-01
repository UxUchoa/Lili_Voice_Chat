import { useEffect, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { Select } from "./Select";
import type { CategoryDeleteStrategy } from "../services/online/actions";

/**
 * Exclusão de categoria com destino explícito para os canais.
 *
 * O `parent_id` é `on delete set null`, então nenhum canal era apagado por
 * acidente nem antes. O que faltava era a escolha ser dita em voz alta: sem
 * isto, quem excluía descobria depois onde os canais tinham ido parar, e o
 * texto da confirmação ainda prometia que "todas as mensagens são apagadas" —
 * o que não era verdade para categoria.
 */
export function CategoryDeleteModal({
  categoryName,
  channelNames,
  otherCategories,
  onConfirm,
  onClose,
}: {
  categoryName: string;
  /** Canais que estão dentro dela agora. */
  channelNames: string[];
  otherCategories: Array<{ id: string; name: string }>;
  onConfirm: (
    strategy: CategoryDeleteStrategy,
    targetCategoryId?: string,
  ) => void;
  onClose: () => void;
}) {
  const [strategy, setStrategy] =
    useState<CategoryDeleteStrategy>("UNCATEGORIZE");
  const [target, setTarget] = useState(otherCategories[0]?.id ?? "");
  const firstRef = useRef<HTMLInputElement | null>(null);
  const empty = channelNames.length === 0;

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const blocked = strategy === "MOVE_TO_CATEGORY" && !target;

  const accept = () => {
    if (blocked) return;
    onConfirm(
      strategy,
      strategy === "MOVE_TO_CATEGORY" ? target : undefined,
    );
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
          className="confirm-modal category-delete-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="category-delete-title"
        >
          <h2 id="category-delete-title">Excluir categoria</h2>
          <p>
            {empty ? (
              <>
                “{categoryName}” está vazia e será removida. Nenhum canal é
                afetado.
              </>
            ) : (
              <>
                “{categoryName}” tem {channelNames.length}{" "}
                {channelNames.length === 1 ? "canal" : "canais"}. Escolha o que
                acontece com {channelNames.length === 1 ? "ele" : "eles"}.
              </>
            )}
          </p>

          {!empty && (
            <>
              <ul className="category-delete-list">
                {channelNames.slice(0, 6).map((name) => (
                  <li key={name}>#{name}</li>
                ))}
                {channelNames.length > 6 && (
                  <li className="more">
                    e mais {channelNames.length - 6}…
                  </li>
                )}
              </ul>

              <fieldset className="category-delete-choice">
                <legend>Destino dos canais</legend>
                <label>
                  <input
                    ref={firstRef}
                    type="radio"
                    name="category-strategy"
                    checked={strategy === "UNCATEGORIZE"}
                    onChange={() => setStrategy("UNCATEGORIZE")}
                  />
                  <span>
                    <b>Mover para “Sem categoria”</b>
                    <small>Os canais continuam no servidor, soltos.</small>
                  </span>
                </label>

                <label
                  className={otherCategories.length ? "" : "unavailable"}
                  aria-disabled={otherCategories.length === 0}
                >
                  <input
                    type="radio"
                    name="category-strategy"
                    disabled={otherCategories.length === 0}
                    checked={strategy === "MOVE_TO_CATEGORY"}
                    onChange={() => setStrategy("MOVE_TO_CATEGORY")}
                  />
                  <span>
                    <b>Mover para outra categoria</b>
                    <small>
                      {otherCategories.length
                        ? "Os canais passam para a categoria escolhida."
                        : "Não há outra categoria neste servidor."}
                    </small>
                  </span>
                </label>
                {strategy === "MOVE_TO_CATEGORY" && (
                  <div className="category-delete-target">
                    <Select
                      ariaLabel="Categoria de destino"
                      value={target}
                      onChange={setTarget}
                      options={otherCategories.map((category) => ({
                        value: category.id,
                        label: category.name,
                      }))}
                    />
                  </div>
                )}

                <label className="danger">
                  <input
                    type="radio"
                    name="category-strategy"
                    checked={strategy === "DELETE_CHANNELS"}
                    onChange={() => setStrategy("DELETE_CHANNELS")}
                  />
                  <span>
                    <b>Excluir os canais também</b>
                    <small>
                      Apaga {channelNames.length}{" "}
                      {channelNames.length === 1 ? "canal" : "canais"} e todas
                      as mensagens. Não dá para desfazer.
                    </small>
                  </span>
                </label>
              </fieldset>
            </>
          )}

          <div className="confirm-actions">
            <button className="outline-button" onClick={onClose}>
              Cancelar
            </button>
            <button
              className="danger-button"
              disabled={blocked}
              onClick={accept}
            >
              Excluir categoria
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
