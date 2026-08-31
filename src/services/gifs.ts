import { onlineConfig } from "./online/config";
import { ATTACHMENT_MAX_BYTES } from "../domain/attachments";

/**
 * Busca de GIFs no Tenor v2, a mesma fonte que o Discord usa.
 *
 * O GIF escolhido **não** vira uma URL na mensagem: ele é baixado aqui e
 * enviado como anexo cifrado, igual a qualquer outro arquivo. Postar a URL
 * entregaria ao Tenor quem abriu a conversa e quando, e o arquivo ficaria
 * fora da validade de um dia e do teto de tamanho — as duas coisas que
 * valem para todo o resto do chat.
 */
const ENDPOINT = "https://tenor.googleapis.com/v2";
const CLIENT_KEY = "janja-voice-chat";

export interface GifResult {
  id: string;
  description: string;
  /** Versão leve, para a grade do seletor. */
  previewUrl: string;
  /** O arquivo que vai para o chat. */
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

export class GifNotConfiguredError extends Error {
  constructor() {
    super(
      "A busca de GIFs precisa de uma chave do Tenor em VITE_TENOR_API_KEY.",
    );
    this.name = "GifNotConfiguredError";
  }
}

export const gifSearchEnabled = () => onlineConfig.tenorApiKey !== "";

type TenorFormat = { url: string; dims: [number, number]; size: number };
type TenorItem = {
  id: string;
  content_description?: string;
  media_formats: Partial<Record<string, TenorFormat>>;
};

async function tenor(path: string, params: Record<string, string>) {
  if (!gifSearchEnabled()) throw new GifNotConfiguredError();
  const query = new URLSearchParams({
    key: onlineConfig.tenorApiKey,
    client_key: CLIENT_KEY,
    country: "BR",
    locale: "pt_BR",
    ...params,
  });
  const response = await fetch(`${ENDPOINT}/${path}?${query}`);
  if (!response.ok)
    throw new Error(
      response.status === 403
        ? "A chave do Tenor foi recusada. Confira VITE_TENOR_API_KEY."
        : `A busca de GIFs falhou (HTTP ${response.status}).`,
    );
  return response.json();
}

const toResult = (item: TenorItem): GifResult | null => {
  // `gif` é o original e pode passar do teto; `mediumgif` costuma ser o
  // equilíbrio entre qualidade e tamanho, e `tinygif` é o fallback.
  const full =
    item.media_formats.mediumgif ??
    item.media_formats.gif ??
    item.media_formats.tinygif;
  const preview =
    item.media_formats.tinygif ?? item.media_formats.nanogif ?? full;
  if (!full || !preview) return null;
  if (full.size > ATTACHMENT_MAX_BYTES) return null;
  return {
    id: item.id,
    description: item.content_description ?? "GIF",
    previewUrl: preview.url,
    url: full.url,
    width: full.dims?.[0] ?? 0,
    height: full.dims?.[1] ?? 0,
    bytes: full.size ?? 0,
  };
};

const collect = (payload: { results?: TenorItem[] }) =>
  (payload.results ?? [])
    .map(toResult)
    .filter((item): item is GifResult => item !== null);

export async function searchGifs(query: string, limit = 30) {
  return collect(
    await tenor("search", {
      q: query,
      limit: String(limit),
      media_filter: "mediumgif,tinygif,nanogif,gif",
      contentfilter: "medium",
    }),
  );
}

export async function featuredGifs(limit = 30) {
  return collect(
    await tenor("featured", {
      limit: String(limit),
      media_filter: "mediumgif,tinygif,nanogif,gif",
      contentfilter: "medium",
    }),
  );
}

export async function gifCategories(): Promise<GifCategory[]> {
  const payload = (await tenor("categories", { type: "featured" })) as {
    tags?: Array<{ searchterm: string; name: string; image: string }>;
  };
  return (payload.tags ?? []).map((tag) => ({
    searchTerm: tag.searchterm,
    label: tag.name.replace(/^#/, ""),
    imageUrl: tag.image,
  }));
}

/** Baixa o GIF escolhido para virar anexo cifrado. */
export async function downloadGifAsFile(gif: GifResult) {
  const response = await fetch(gif.url);
  if (!response.ok)
    throw new Error(`Não foi possível baixar o GIF (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (blob.size > ATTACHMENT_MAX_BYTES)
    throw new Error("Este GIF passa do limite de tamanho do chat.");
  const safeName =
    gif.description
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "gif";
  return new File([blob], `${safeName}.gif`, {
    type: blob.type || "image/gif",
  });
}
