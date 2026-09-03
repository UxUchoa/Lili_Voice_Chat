import { useEffect, useRef, useState } from "react";
import { IconSearch } from "./icons";
import { splitIntoColumns } from "../domain/gifColumns";
import {
  GifNotConfiguredError,
  featuredGifs,
  gifCategories,
  searchGifs,
  type GifCategory,
  type GifResult,
} from "../services/gifs";
import { formatBytes } from "../domain/attachments";

/** Colunas da grade. Duas, como no seletor do Discord. */
const GIF_COLUMNS = 2;

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
  /**
   * A chave vive no servidor, então o cliente não tem como saber de antemão se
   * a busca está configurada — ele descobre pela primeira resposta. Antes esta
   * checagem era local, com a chave embutida no pacote.
   */
  const [unconfigured, setUnconfigured] = useState(false);
  /**
   * O provedor respondeu, mas nenhum item veio com imagem.
   *
   * Sem isto a grade enchia de quadros quebrados — `<img>` sem `src` mostra o
   * ícone de imagem partida e o texto alternativo, que foi como o problema
   * apareceu. Um item sem URL não tem conserto do lado do cliente: é a função
   * `gifs` publicada devolvendo um formato mais antigo que o do cliente.
   */
  const [imageless, setImageless] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
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
        if (ticket !== requestRef.current) return;
        const usable = items.filter((gif) => gif.previewUrl && gif.url);
        setResults(usable);
        setImageless(items.length > 0 && usable.length === 0);
      })
      .catch((caught) => {
        if (ticket !== requestRef.current) return;
        setResults([]);
        setImageless(false);
        if (caught instanceof GifNotConfiguredError) {
          setUnconfigured(true);
          return;
        }
        setError(
          caught instanceof Error ? caught.message : "A busca de GIFs falhou.",
        );
      })
      .finally(() => {
        if (ticket === requestRef.current) setLoading(false);
      });
  }, [debounced]);

  if (unconfigured)
    return (
      <div className="gif-picker gif-picker-empty">
        <h4>Busca de GIFs desativada</h4>
        <p>
          Falta a chave do Giphy no servidor. Crie uma chave gratuita no painel
          do Giphy e publique como <code>GIF_API_KEY</code> nos secrets das
          funções do Supabase.
        </p>
        <p className="gif-picker-note">
          Enquanto isso, dá para enviar um GIF pelo botão de anexo — ele segue
          o mesmo caminho.
        </p>
      </div>
    );

  return (
    <div className="gif-picker">
      <div className="picker-search">
        <IconSearch size={15} />
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
              style={
                category.imageUrl
                  ? { backgroundImage: `url(${category.imageUrl})` }
                  : undefined
              }
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
          <p className="empty-copy">
            {imageless
              ? "O provedor respondeu, mas sem endereço de imagem em nenhum item — a função `gifs` publicada está desatualizada. Publique-a de novo."
              : "Nenhum GIF encontrado."}
          </p>
        )}
        {results.length > 0 &&
          splitIntoColumns(results, GIF_COLUMNS).map((column, index) => (
            // As colunas são montadas aqui, e não pelo `columns` do CSS:
             // multi-coluna dentro de um container de altura limitada abre
             // colunas para o lado em vez de continuar para baixo, e a lista
             // virava um carrossel horizontal conforme o número de resultados.
            <div className="gif-column" key={index}>
              {column.map((gif) => (
                <button
                  key={gif.id}
                  disabled={busy}
                  title={`${gif.description} · ${formatBytes(gif.bytes)}`}
                  onClick={() => onPick(gif)}
                >
                  <img
                    src={gif.previewUrl}
                    alt={gif.description}
                    loading="lazy"
                    width={gif.width}
                    height={gif.height}
                  />
                </button>
              ))}
            </div>
          ))}
      </div>
      {busy && <p className="gif-sending">Baixando e enviando o GIF…</p>}
    </div>
  );
}
