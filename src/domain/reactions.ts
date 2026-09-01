/**
 * Regras de uma reação.
 *
 * O limite é contado em **grafemas**, não em unidades UTF-16. `"❤️".length` é
 * 2 e `"👨‍👩‍👧".length` é 8: contar `length` recusaria um único emoji como se
 * fossem vários caracteres. `Intl.Segmenter` agrupa o que a pessoa enxerga
 * como um caractere só.
 */
export const REACTION_MAX_GRAPHEMES = 15;

/**
 * Teto que o banco consegue impor.
 *
 * Postgres não segmenta grafemas, então a contagem exata vive no cliente. O
 * servidor garante o que sabe garantir: não vazio e um teto duro de caracteres
 * — quinze grafemas cabem folgadamente aqui, mesmo em sequências ZWJ longas,
 * e nada absurdo passa.
 */
export const REACTION_MAX_CODE_POINTS = 128;

const segmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : undefined;

/** Quantos caracteres a pessoa enxerga nesta string. */
export function countGraphemes(value: string): number {
  if (!value) return 0;
  if (segmenter) return [...segmenter.segment(value)].length;
  // Sem `Intl.Segmenter` (navegador antigo), os pontos de código já erram
  // menos que `length`: pelo menos um par surrogate conta como um.
  return [...value].length;
}

/** Corta preservando grafemas — nunca parte um emoji ao meio. */
export function truncateGraphemes(value: string, limit: number): string {
  if (countGraphemes(value) <= limit) return value;
  const units = segmenter
    ? [...segmenter.segment(value)].map((entry) => entry.segment)
    : [...value];
  return units.slice(0, limit).join("");
}

/** Espaços nas pontas não fazem parte da reação. */
export const normalizeReaction = (value: string) => value.trim();

/**
 * Devolve a mensagem de erro, ou `undefined` quando a reação é válida.
 *
 * A mesma função vale para o campo enquanto a pessoa digita e para a checagem
 * antes de persistir, para não existirem duas regras que discordam.
 */
export function reactionError(value: string): string | undefined {
  const reaction = normalizeReaction(value);
  if (!reaction) return "A reação não pode ficar em branco.";
  const graphemes = countGraphemes(reaction);
  if (graphemes > REACTION_MAX_GRAPHEMES)
    return `A reação deve ter no máximo ${REACTION_MAX_GRAPHEMES} caracteres.`;
  if (reaction.length > REACTION_MAX_CODE_POINTS)
    return "A reação é longa demais.";
  return undefined;
}

export const isReactionValid = (value: string) => !reactionError(value);
