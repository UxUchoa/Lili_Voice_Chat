import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IconChevronRight } from "./icons";

export interface ContextMenuItem {
  id: string;
  label: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Marcado com bolinha/check, para grupos de escolha. */
  checked?: boolean;
  checkStyle?: "radio" | "checkbox";
  onSelect?: () => void;
  submenu?: ContextMenuItem[];
  /** Separador acima deste item. */
  separatorBefore?: boolean;
}

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

const MENU_MARGIN = 8;
const SUBMENU_WIDTH = 232;

/** Altura util da janela para qualquer menu flutuante. */
const viewportLimit = () => window.innerHeight - MENU_MARGIN * 2;

function ContextSubmenu({
  x,
  y,
  flipped,
  children,
}: {
  x: number;
  y: number;
  flipped: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const limit = viewportLimit();
  const [top, setTop] = useState(y);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    // O submenu nasce alinhado ao topo do item que o abriu. Quando esse item
    // está perto do rodapé, ele precisa subir: antes seguia janela afora e o
    // último item ficava cortado.
    const height = Math.min(element.getBoundingClientRect().height, limit);
    setTop(
      Math.max(
        MENU_MARGIN,
        Math.min(y, window.innerHeight - height - MENU_MARGIN),
      ),
    );
  }, [x, y, limit]);
  return (
    <div
      ref={ref}
      className={`context-submenu ${flipped ? "flipped" : ""}`}
      role="menu"
      style={{ left: x, top, maxHeight: Math.min(420, limit) }}
    >
      {children}
    </div>
  );
}

export function ContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ x: state.x, y: state.y });
  const [maxHeight, setMaxHeight] = useState(() =>
    Math.min(560, viewportLimit()),
  );
  const [openSubmenu, setOpenSubmenu] = useState<{
    id: string;
    x: number;
    y: number;
    flipped: boolean;
  } | null>(null);

  /**
   * O submenu é posicionado em coordenadas de tela, não dentro do item.
   * O menu principal rola (`overflow-y`), e um filho absoluto seria
   * recortado por esse contexto — era por isso que o submenu não aparecia
   * e sobrava uma barra de rolagem horizontal no menu.
   */
  const openSubmenuFor = (item: ContextMenuItem, trigger: HTMLElement) => {
    if (!item.submenu) {
      setOpenSubmenu(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    const width = SUBMENU_WIDTH;
    const flipped = rect.right + width + MENU_MARGIN > window.innerWidth;
    setOpenSubmenu({
      id: item.id,
      x: flipped ? Math.max(MENU_MARGIN, rect.left - width - 4) : rect.right + 4,
      y: rect.top,
      flipped,
    });
  };

  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!element) return;
    // Reposiciona para caber na janela: perto da borda direita/inferior o menu
    // abre para o outro lado, como qualquer menu nativo.
    const limit = viewportLimit();
    setMaxHeight(Math.min(560, limit));
    const rect = element.getBoundingClientRect();
    const x =
      state.x + rect.width + MENU_MARGIN > window.innerWidth
        ? Math.max(MENU_MARGIN, state.x - rect.width)
        : state.x;
    // `max-height` sozinho não resolvia: um menu alto continuava ancorado no
    // cursor e passava do rodapé. Aqui ele sobe até caber e, se ainda assim
    // não couber, começa na margem e rola.
    const height = Math.min(rect.height, limit);
    const y = Math.max(
      MENU_MARGIN,
      Math.min(state.y, window.innerHeight - height - MENU_MARGIN),
    );
    setPosition({ x, y });
  }, [state]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  const renderItems = (items: ContextMenuItem[], nested = false) =>
    items.map((item) => (
      <div
        className={`context-item-wrap ${item.separatorBefore ? "with-separator" : ""}`}
        key={item.id}
        onPointerEnter={(event) => {
          if (nested) return;
          const trigger = event.currentTarget.querySelector("button");
          if (trigger) openSubmenuFor(item, trigger as HTMLElement);
        }}
      >
        <button
          role={
            item.checkStyle === "checkbox"
              ? "menuitemcheckbox"
              : item.checkStyle === "radio"
                ? "menuitemradio"
                : "menuitem"
          }
          aria-checked={item.checked}
          aria-haspopup={item.submenu ? "menu" : undefined}
          aria-expanded={
            item.submenu ? openSubmenu?.id === item.id : undefined
          }
          onFocus={(event) => {
            if (nested) return;
            openSubmenuFor(item, event.currentTarget);
          }}
          disabled={item.disabled}
          className={[
            "context-item",
            item.danger ? "danger" : "",
            item.checked ? "checked" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => {
            if (item.disabled || item.submenu) return;
            item.onSelect?.();
            onClose();
          }}
        >
          <span className="context-item-body">
            <span className="context-item-label">{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </span>
          {item.checkStyle && (
            <span
              className={`context-mark ${item.checkStyle} ${item.checked ? "on" : ""}`}
              aria-hidden="true"
            />
          )}
          {item.submenu && <IconChevronRight size={16} />}
        </button>
        {item.submenu && openSubmenu?.id === item.id && (
          <ContextSubmenu
            x={openSubmenu.x}
            y={openSubmenu.y}
            flipped={openSubmenu.flipped}
          >
            {renderItems(item.submenu, true)}
          </ContextSubmenu>
        )}
      </div>
    ));

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: position.x, top: position.y, maxHeight }}
      onContextMenu={(event) => event.preventDefault()}
    >
      {renderItems(state.items)}
    </div>
  );
}

/** Hook utilitário: abre o menu na posição do cursor. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const open = (
    event: { preventDefault: () => void; clientX: number; clientY: number },
    items: ContextMenuItem[],
  ) => {
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, items });
  };
  return { menu, open, close: () => setMenu(null) };
}
