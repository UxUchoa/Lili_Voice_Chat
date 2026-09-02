import { useEffect, useRef } from "react";
import type { MentionTarget } from "../domain/mentions";
import { IconUsers } from "./icons";

/**
 * Lista de sugestões que aparece ao digitar `@` — item 5.
 *
 * Não recebe foco. Quem continua com o cursor é o campo de texto: tirar o foco
 * dele para navegar na lista faria a digitação parar no meio da palavra. Por
 * isso a navegação é o compositor que despacha, e daqui só sai o clique.
 *
 * Segue o padrão `combobox` do WAI-ARIA — as marcações `aria-activedescendant`
 * e `aria-controls` ficam no `textarea`, que é quem tem o foco.
 */
export function MentionSuggestions({
  id,
  targets,
  active,
  onPick,
  onHover,
}: {
  id: string;
  targets: MentionTarget[];
  /** Índice destacado pelo teclado. */
  active: number;
  onPick: (target: MentionTarget) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);

  useEffect(() => {
    const option = listRef.current?.children[active] as
      | HTMLElement
      | undefined;
    option?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!targets.length) return null;

  return (
    <div className="mention-suggestions">
      <span className="eyebrow">MENCIONAR</span>
      <ul ref={listRef} id={id} role="listbox" aria-label="Sugestões de menção">
        {targets.map((target, index) => (
          <li
            key={`${target.kind}-${target.id}`}
            id={`${id}-${index}`}
            role="option"
            aria-selected={index === active}
            className={index === active ? "active" : ""}
            onMouseEnter={() => onHover(index)}
            // `mousedown` e não `click`: o clique tiraria o foco do campo antes
            // de a escolha ser aplicada, e o cursor voltaria para o começo.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(target);
            }}
          >
            {target.kind === "role" ? (
              <IconUsers size={15} />
            ) : (
              <span className="mention-suggestion-at" aria-hidden="true">
                @
              </span>
            )}
            <b>{target.label}</b>
            {target.hint && <small>{target.hint}</small>}
          </li>
        ))}
      </ul>
    </div>
  );
}
