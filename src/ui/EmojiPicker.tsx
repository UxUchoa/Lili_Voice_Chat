import { useMemo, useState } from "react";
import {
  ALL_EMOJI,
  EMOJI_CATEGORIES,
  searchEmoji,
  type EmojiEntry,
} from "../domain/emoji";

const RECENT_KEY = "janja-emoji-recent-v1";
const RECENT_LIMIT = 24;

function readRecent(): EmojiEntry[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const chars = JSON.parse(raw) as string[];
    // Guardamos só o caractere: se o conjunto mudar entre versões, o que
    // sumiu simplesmente não volta, em vez de quebrar a lista.
    return chars
      .map((char) => ALL_EMOJI.find((item) => item.char === char))
      .filter((item): item is EmojiEntry => item !== undefined);
  } catch {
    return [];
  }
}

export function rememberEmoji(char: string) {
  try {
    const current = (JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") ??
      []) as string[];
    const next = [char, ...current.filter((item) => item !== char)].slice(
      0,
      RECENT_LIMIT,
    );
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* modo privado sem storage: a lista de recentes só não persiste. */
  }
}

export function EmojiPicker({ onPick }: { onPick: (char: string) => void }) {
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("recentes");
  const [recent, setRecent] = useState(readRecent);
  const [hovered, setHovered] = useState<EmojiEntry | null>(null);

  const results = useMemo(
    () => (query.trim() ? searchEmoji(query) : []),
    [query],
  );
  const categories = useMemo(
    () => [
      {
        id: "recentes",
        label: "Usados com frequência",
        icon: "🕘",
        emojis: recent,
      },
      ...EMOJI_CATEGORIES,
    ],
    [recent],
  );
  const active =
    categories.find((item) => item.id === categoryId) ?? categories[1];

  const pick = (item: EmojiEntry) => {
    rememberEmoji(item.char);
    setRecent(readRecent());
    onPick(item.char);
  };

  const grid = query.trim() ? results : active.emojis;

  return (
    <div className="emoji-picker">
      <div className="picker-search">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          value={query}
          placeholder="Encontre o emoji perfeito"
          aria-label="Buscar emoji"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="emoji-body">
        {!query.trim() && (
          <nav className="emoji-categories" aria-label="Categorias de emoji">
            {categories.map((category) => (
              <button
                key={category.id}
                className={category.id === active.id ? "active" : ""}
                title={category.label}
                aria-label={category.label}
                onClick={() => setCategoryId(category.id)}
              >
                {category.icon}
              </button>
            ))}
          </nav>
        )}
        <div className="emoji-grid-wrap">
          <h4>{query.trim() ? "Resultados" : active.label}</h4>
          {grid.length === 0 ? (
            <p className="empty-copy">
              {query.trim()
                ? "Nenhum emoji com esse nome."
                : "Os que você usar aparecem aqui."}
            </p>
          ) : (
            <div className="emoji-grid">
              {grid.map((item, index) => (
                <button
                  key={`${active.id}-${index}-${item.char}`}
                  title={item.name}
                  aria-label={item.name}
                  onPointerEnter={() => setHovered(item)}
                  onFocus={() => setHovered(item)}
                  onClick={() => pick(item)}
                >
                  {item.char}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <footer className="emoji-preview">
        <span aria-hidden="true">{hovered?.char ?? "🙂"}</span>
        <b>{hovered ? `:${hovered.name.replaceAll(" ", "_")}:` : "Emoji"}</b>
      </footer>
    </div>
  );
}
