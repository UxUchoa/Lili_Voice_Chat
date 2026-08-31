import { useEffect, useMemo, useRef, useState } from "react";
import {
  featuredGifs,
  gifCategories,
  gifSearchEnabled,
  searchGifs,
  type GifCategory,
  type GifResult,
} from "../services/gifs";
import { formatBytes } from "../domain/attachments";

export function GifPicker({
  onPick,
  busy,
}: {
  onPick: (gif: GifResult) => void;
  busy: boolean;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [categories, setCategories] = useState<GifCategory[]>([]);
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const enabled = useMemo(gifSearchEnabled, []);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!enabled) return;
    // Cada busca leva um número: a resposta de uma digitação antiga que chegue
    // atrasada não pode sobrescrever a atual.
    const ticket = ++requestRef.current;
    setLoading(true);
    setError("");
    const work = debounced
      ? searchGifs(debounced)
      : Promise.all([featuredGifs(), gifCategories()]).then(
          ([featured, tags]) => {
            if (ticket === requestRef.current) setCategories(tags);
            return featured;
          },
        );
    work
      .then((items) => {
        if (ticket === requestRef.current) setResults(items);
      })
      .catch((caught) => {
        if (ticket !== requestRef.current) return;
        setResults([]);
        setError(
          caught instanceof Error ? caught.message : "A busca de GIFs falhou.",
        );
      })
      .finally(() => {
        if (ticket === requestRef.current) setLoading(false);
      });
  }, [debounced, enabled]);

  if (!enabled)
    return (
      <div className="gif-picker gif-picker-empty">
        <h4>Busca de GIFs desativada</h4>
        <p>
          Falta a chave da API do Tenor. Crie uma chave gratuita no console do
          Google, coloque em <code>VITE_TENOR_API_KEY</code> no seu{" "}
          <code>.env.local</code> e reinicie o servidor de desenvolvimento.
        </p>
        <p className="gif-picker-note">
          Enquanto isso, dá para enviar um GIF pelo botão de anexo — ele segue
          o mesmo caminho cifrado.
        </p>
      </div>
    );

  return (
    <div className="gif-picker">
      <div className="picker-search">
        <span aria-hidden="true">⌕</span>
        <input
          autoFocus
          value={query}
          placeholder="Buscar GIFs"
          aria-label="Buscar GIFs"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {!debounced && categories.length > 0 && (
        <div className="gif-categories">
          {categories.slice(0, 8).map((category) => (
            <button
              key={category.searchTerm}
              onClick={() => setQuery(category.searchTerm)}
              style={{ backgroundImage: `url(${category.imageUrl})` }}
            >
              <span>{category.label}</span>
            </button>
          ))}
        </div>
      )}
      <div className="gif-grid">
        {loading && results.length === 0 && (
          <p className="empty-copy">Carregando…</p>
        )}
        {!loading && results.length === 0 && !error && (
          <p className="empty-copy">Nenhum GIF encontrado.</p>
        )}
        {results.map((gif) => (
          <button
            key={gif.id}
            disabled={busy}
            title={`${gif.description} · ${formatBytes(gif.bytes)}`}
            onClick={() => onPick(gif)}
          >
            <img src={gif.previewUrl} alt={gif.description} loading="lazy" />
          </button>
        ))}
      </div>
      {busy && <p className="gif-sending">Cifrando e enviando o GIF…</p>}
    </div>
  );
}
