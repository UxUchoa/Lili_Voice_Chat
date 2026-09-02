import { supabase } from "./online/client";
import { ATTACHMENT_MAX_BYTES } from "../domain/attachments";

/**
 * Busca de GIFs, pela função de borda `gifs`.
 *
 * O cliente não fala com o Giphy nem conhece o formato dele: manda um modo e
 * recebe o formato já normalizado. A chave vive só no servidor — uma variável
 * `VITE_` seria embutida no pacote público, e qualquer pessoa leria no devtools
 * e gastaria a cota da conta.
 *
 * O GIF escolhido **não** vira uma URL na mensagem: ele é baixado aqui e
 * enviado como anexo, igual a qualquer outro arquivo. Postar a URL entregaria
 * ao Giphy quem abriu a conversa e quando, e o arquivo ficaria fora da validade
 * de um dia e do teto de tamanho — as duas coisas que valem para todo o resto
 * do chat.
 */

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

/**
 * O servidor está sem a chave do Giphy.
 *
 * É uma classe própria porque o seletor trata este caso de outro jeito: em vez
 * de "a busca falhou, tente de novo", ele explica que falta configurar e
 * aponta o caminho do anexo, que continua funcionando.
 */
export class GifNotConfiguredError extends Error {
  constructor() {
    super("A busca de GIFs ainda não foi configurada neste servidor.");
    this.name = "GifNotConfiguredError";
  }
}

type GifMode = "search" | "trending" | "categories";

interface GifResponse {
  results?: GifResult[];
  categories?: GifCategory[];
  error?: string;
}

/** Mensagens por código de erro da função; o resto cai no texto genérico. */
const MESSAGES: Record<string, string> = {
  gifs_key_rejected:
    "A chave do Giphy foi recusada pelo provedor. Confira GIF_API_KEY nos secrets.",
  gifs_upstream_error: "O Giphy não respondeu. Tente de novo em instantes.",
  unauthorized: "Entre de novo para buscar GIFs.",
};

async function call(
  mode: GifMode,
  options: { query?: string; limit?: number } = {},
): Promise<GifResponse> {
  const { data, error } = await supabase.functions.invoke<GifResponse>("gifs", {
    body: { mode, ...options },
  });
  // Um erro de transporte esconde o corpo da resposta, onde está o código.
  // Sem lê-lo, "falta a chave" e "o Giphy caiu" viram a mesma mensagem.
  const code = data?.error ?? (error ? await errorCode(error) : undefined);
  if (code === "gifs_not_configured") throw new GifNotConfiguredError();
  if (code) throw new Error(MESSAGES[code] ?? "A busca de GIFs falhou.");
  if (error) throw new Error("A busca de GIFs falhou.");
  return data ?? {};
}

/** Extrai o código de erro do corpo, quando o invoke devolve uma resposta. */
async function errorCode(error: unknown): Promise<string | undefined> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return undefined;
  try {
    const body = (await context.clone().json()) as { error?: string };
    return typeof body.error === "string" ? body.error : undefined;
  } catch {
    return undefined;
  }
}

export async function searchGifs(query: string, limit = 30) {
  return (await call("search", { query, limit })).results ?? [];
}

/** A grade de abertura, antes de alguém digitar qualquer coisa. */
export async function featuredGifs(limit = 30) {
  return (await call("trending", { limit })).results ?? [];
}

export async function gifCategories(): Promise<GifCategory[]> {
  return (await call("categories")).categories ?? [];
}

/** Baixa o GIF escolhido para virar anexo. */
export async function downloadGifAsFile(gif: GifResult) {
  const response = await fetch(gif.url);
  if (!response.ok)
    throw new Error(`Não foi possível baixar o GIF (HTTP ${response.status}).`);
  const blob = await response.blob();
  // O tamanho anunciado pelo provedor pode não bater com o arquivo; o teto é
  // conferido de novo aqui, com os bytes na mão.
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
