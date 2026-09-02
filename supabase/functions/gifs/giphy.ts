/**
 * Tradução do Giphy para o formato que o chat entende.
 *
 * Fica separado do handler para poder ser testado com `vitest` — o `npm test`
 * já roda `supabase/functions` — sem subir Deno nem chamar a API de verdade.
 * Nada aqui toca `Deno`, `fetch` ou variável de ambiente: só entra JSON e sai
 * o formato normalizado.
 *
 * A normalização acontece no servidor de propósito. O cliente nunca aprende o
 * formato do Giphy, então trocar de provedor depois é mexer só neste arquivo.
 */

/** O que o seletor de GIFs consome. */
export interface GifResult {
  id: string;
  description: string;
  /** Versão leve, para a grade do seletor. */
  previewUrl: string;
  /** O arquivo que vai virar anexo na mensagem. */
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export interface GifCategory {
  searchTerm: string;
  label: string;
  imageUrl: string;
}

/** Uma variante de tamanho devolvida pelo Giphy. */
interface GiphyRendition {
  url?: string;
  width?: string;
  height?: string;
  size?: string;
}

export interface GiphyItem {
  id?: string;
  title?: string;
  alt_text?: string;
  images?: Record<string, GiphyRendition | undefined>;
}

/**
 * Variantes que servem como anexo, da melhor para a mais econômica.
 *
 * `original` primeiro porque é a qualidade que a pessoa viu no seletor; as
 * seguintes existem para quando ela passa do teto de anexo do chat. Ficar só
 * com `original` faria um GIF grande simplesmente sumir da busca.
 */
const FULL_ORDER = [
  "original",
  "downsized_medium",
  "downsized",
  "fixed_width",
  "downsized_small",
] as const;

/** Variantes para a grade: leves, porque aparecem dezenas de uma vez. */
const PREVIEW_ORDER = [
  "fixed_width_small",
  "preview_gif",
  "fixed_width",
  "downsized",
  "original",
] as const;

const toNumber = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const usable = (rendition: GiphyRendition | undefined) =>
  typeof rendition?.url === "string" && rendition.url.length > 0;

/**
 * Maior variante que ainda cabe no teto de anexo.
 *
 * O `size` do Giphy vem como texto. Uma variante sem `size` legível entra como
 * `0`, e aí passa no teste de tamanho — é o certo: recusar por falta de
 * metadado descartaria GIFs perfeitamente válidos, e o tamanho real ainda é
 * conferido na hora de baixar.
 */
export function pickFull(
  images: Record<string, GiphyRendition | undefined> | undefined,
  maxBytes: number,
): GiphyRendition | undefined {
  if (!images) return undefined;
  for (const name of FULL_ORDER) {
    const rendition = images[name];
    if (usable(rendition) && toNumber(rendition!.size) <= maxBytes)
      return rendition;
  }
  return undefined;
}

export function pickPreview(
  images: Record<string, GiphyRendition | undefined> | undefined,
): GiphyRendition | undefined {
  if (!images) return undefined;
  for (const name of PREVIEW_ORDER) {
    const rendition = images[name];
    if (usable(rendition)) return rendition;
  }
  return undefined;
}

/** Um item do Giphy vira um `GifResult`, ou `null` se não servir. */
export function toGifResult(
  item: GiphyItem,
  maxBytes: number,
): GifResult | null {
  if (!item.id) return null;
  const full = pickFull(item.images, maxBytes);
  const preview = pickPreview(item.images) ?? full;
  if (!full || !preview) return null;
  return {
    id: item.id,
    // `alt_text` descreve a imagem; o título costuma ser o nome do canal que
    // publicou. Para quem usa leitor de tela a diferença é tudo.
    description: item.alt_text?.trim() || item.title?.trim() || "GIF",
    previewUrl: preview.url!,
    url: full.url!,
    width: toNumber(full.width),
    height: toNumber(full.height),
    bytes: toNumber(full.size),
  };
}

export function toGifResults(
  payload: { data?: GiphyItem[] } | undefined,
  maxBytes: number,
): GifResult[] {
  return (payload?.data ?? [])
    .map((item) => toGifResult(item, maxBytes))
    .filter((item): item is GifResult => item !== null);
}

interface GiphyCategory {
  name?: string;
  name_encoded?: string;
  gif?: GiphyItem;
}

export function toGifCategories(
  payload: { data?: GiphyCategory[] } | undefined,
): GifCategory[] {
  return (payload?.data ?? []).flatMap((category) => {
    const label = category.name?.trim();
    if (!label) return [];
    const image = pickPreview(category.gif?.images);
    return [
      {
        // O `name_encoded` é o termo que a busca do Giphy espera de volta.
        searchTerm: category.name_encoded?.trim() || label,
        label,
        imageUrl: image?.url ?? "",
      },
    ];
  });
}

export type GifMode = "search" | "trending" | "categories";

export const GIF_MODES: readonly GifMode[] = [
  "search",
  "trending",
  "categories",
];

export function isGifMode(value: unknown): value is GifMode {
  return typeof value === "string" && GIF_MODES.includes(value as GifMode);
}

/** Teto de itens por chamada, para o proxy não virar um raspador de catálogo. */
export const GIF_MAX_LIMIT = 50;

export function clampLimit(value: unknown, fallback = 30): number {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, GIF_MAX_LIMIT);
}

/**
 * Monta a URL do Giphy.
 *
 * A chave entra aqui, no servidor. `rating` fica em `pg-13` porque o seletor
 * abre dentro de uma conversa e ninguém pediu conteúdo adulto; `bundle`
 * enxuga a resposta para as variantes que realmente usamos.
 */
export function giphyUrl(
  mode: GifMode,
  { apiKey, query, limit }: { apiKey: string; query?: string; limit?: number },
): string {
  const path =
    mode === "search"
      ? "search"
      : mode === "trending"
        ? "trending"
        : "categories";
  const params = new URLSearchParams({ api_key: apiKey });
  if (mode !== "categories") {
    params.set("limit", String(limit ?? 30));
    params.set("rating", "pg-13");
    params.set("bundle", "messaging_non_clips");
    params.set("lang", "pt");
  }
  if (mode === "search") params.set("q", query ?? "");
  return `https://api.giphy.com/v1/gifs/${path}?${params}`;
}
