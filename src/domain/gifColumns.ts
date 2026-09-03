/**
 * Distribui os GIFs em colunas de alturas livres.
 *
 * A grade imita a do Discord: duas colunas, cada item com a altura que o seu
 * formato pede. Isso vinha do `columns: 2` do CSS, e era ali que estava o bug —
 * multi-coluna dentro de um container de altura limitada não quebra para baixo,
 * ele abre **novas colunas para o lado**. A lista virava um carrossel
 * horizontal, e como `overflow-y` não é `visible` o `overflow-x` computa para
 * `auto`, o que fazia nascer a barra horizontal. Categorias que traziam mais
 * resultados abriam mais colunas, e por isso o comportamento mudava conforme a
 * categoria escolhida.
 *
 * Montando as colunas aqui, cada uma é um bloco comum empilhado para baixo: o
 * container rola na vertical porque não existe mais nada crescendo para a
 * direita, e a quantidade de resultados deixa de mudar a forma da lista.
 *
 * A escolha da coluna é pela mais curta até agora, medindo em altura relativa
 * (a proporção do GIF), e não pela contagem de itens. Alternar um-a-um deixaria
 * uma coluna muito mais longa que a outra sempre que os formatos fossem
 * diferentes — e GIF alto ao lado de GIF largo é o caso comum, não a exceção.
 */
export interface GifShape {
  width: number;
  height: number;
}

/** Altura que o item ocupa numa coluna de largura 1. */
function relativeHeight(gif: GifShape): number {
  // Sem medida utilizável, assume quadrado: melhor uma estimativa neutra do que
  // uma divisão por zero mandando o item para o fim de uma coluna qualquer.
  if (!(gif.width > 0) || !(gif.height > 0)) return 1;
  return gif.height / gif.width;
}

export function splitIntoColumns<T extends GifShape>(
  items: readonly T[],
  columnCount = 2,
): T[][] {
  const total = Math.max(1, Math.floor(columnCount));
  const columns: T[][] = Array.from({ length: total }, () => []);
  const heights = new Array<number>(total).fill(0);
  for (const item of items) {
    let shortest = 0;
    for (let index = 1; index < total; index += 1)
      if (heights[index] < heights[shortest]) shortest = index;
    columns[shortest].push(item);
    heights[shortest] += relativeHeight(item);
  }
  return columns;
}
