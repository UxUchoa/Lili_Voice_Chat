import type { ReactNode } from "react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
  /** Ícone à esquerda do rótulo. A busca por digitação usa só o `label`. */
  icon?: ReactNode;
  disabled?: boolean;
}

/**
 * Lista suspensa do design system.
 *
 * O `<select>` nativo não aceita estilo no popup: o menu é desenhado pelo
 * sistema operacional, com fonte, cor e cantos próprios. Dentro de uma
 * interface escura ele aparece como um retângulo branco do Windows, e não há
 * CSS que resolva — por isso o controle é remontado aqui.
 *
 * Segue o padrão `listbox` da WAI-ARIA: o gatilho é um `button` com
 * `aria-haspopup`, a lista tem `role="listbox"` e cada item `role="option"`
 * com `aria-selected`. Teclado: setas, Home, End, Enter, Espaço, Escape e
 * busca por digitação.
 */
export function Select({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Selecione",
  disabled,
  className = "",
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [dropUp, setDropUp] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeahead = useRef({ text: "", at: 0 });
  /**
   * Só a navegação por teclado rola a lista até o item ativo. Rolar no hover
   * faz a lista se mexer embaixo do ponteiro — o item foge do clique, e num
   * caso real a pessoa acaba escolhendo outra coisa.
   */
  const keyboardNav = useRef(false);
  const listId = useId();

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  // Abre já apontando para o item atual, não para o primeiro da lista.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  /**
   * Decide se o menu abre para cima. Medido antes da pintura para não haver
   * um quadro com a lista fora da tela.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const box = trigger.getBoundingClientRect();
    const estimated = Math.min(options.length * 34 + 12, 260);
    setDropUp(
      box.bottom + estimated > window.innerHeight && box.top > estimated,
    );
  }, [open, options.length]);

  useEffect(() => {
    if (!open || !keyboardNav.current) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  /**
   * Vários destes controles vivem dentro de um `<label>`, e um label repassa o
   * clique para o controle que ele rotula. Sem `preventDefault` o clique na
   * opção fechava a lista e o label reabria em seguida, ao encaminhar o mesmo
   * clique para o gatilho: o menu parecia nunca fechar.
   */
  const swallowLabelActivation = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  };

  /** Pula os desabilitados, e não sai da lista nas pontas. */
  const step = (from: number, direction: 1 | -1) => {
    for (
      let index = from + direction;
      index >= 0 && index < options.length;
      index += direction
    )
      if (!options[index].disabled) return index;
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    keyboardNav.current = true;
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      commit(active);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => step(index, 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => step(index, -1));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      setActive(step(-1, 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setActive(step(options.length, -1));
      return;
    }
    // Busca por digitação: teclas em sequência formam um prefixo; uma pausa
    // de um segundo recomeça a busca.
    if (event.key.length === 1) {
      const now = Date.now();
      const state = typeahead.current;
      state.text = now - state.at > 1000 ? event.key : state.text + event.key;
      state.at = now;
      const query = state.text.toLowerCase();
      const found = options.findIndex(
        (option) =>
          !option.disabled && option.label.toLowerCase().startsWith(query),
      );
      if (found >= 0) setActive(found);
    }
  };

  return (
    <div
      className={`ds-select ${open ? "open" : ""} ${className}`}
      ref={rootRef}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ds-select-trigger"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={(event) => {
          swallowLabelActivation(event);
          setOpen((current) => !current);
        }}
        onKeyDown={onKeyDown}
      >
        <span className={selected ? "" : "ds-select-placeholder"}>
          {selected ? (
            <>
              {selected.icon}
              {selected.label}
            </>
          ) : (
            placeholder
          )}
        </span>
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <ul
          id={listId}
          ref={listRef}
          className={`ds-select-list ${dropUp ? "up" : ""}`}
          role="listbox"
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              data-active={index === active}
              className={[
                option.value === value ? "selected" : "",
                index === active ? "active" : "",
                option.disabled ? "disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onPointerEnter={() => {
                if (option.disabled) return;
                keyboardNav.current = false;
                setActive(index);
              }}
              onClick={(event) => {
                swallowLabelActivation(event);
                commit(index);
              }}
            >
              {option.icon}
              {option.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
