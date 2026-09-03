import { describe, expect, it } from "vitest";
import { splitIntoColumns } from "./gifColumns";

const gif = (id: string, width: number, height: number) => ({
  id,
  width,
  height,
});

describe("splitIntoColumns", () => {
  it("não perde nem duplica nenhum item", () => {
    const items = Array.from({ length: 37 }, (_, index) =>
      gif(`g${index}`, 200, 100 + index),
    );
    const columns = splitIntoColumns(items, 2);
    const ids = columns.flat().map((item) => item.id);
    expect(ids).toHaveLength(items.length);
    expect(new Set(ids).size).toBe(items.length);
  });

  it("equilibra por altura, e não por contagem", () => {
    // Um GIF muito alto ao lado de vários baixos: alternar um-a-um deixaria uma
    // coluna com o dobro da altura da outra.
    const items = [
      gif("alto", 100, 400),
      gif("baixo1", 100, 50),
      gif("baixo2", 100, 50),
      gif("baixo3", 100, 50),
      gif("baixo4", 100, 50),
    ];
    const [primeira, segunda] = splitIntoColumns(items, 2);
    expect(primeira.map((item) => item.id)).toEqual(["alto"]);
    expect(segunda).toHaveLength(4);
  });

  it("mantém a ordem de chegada dentro de cada coluna", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      gif(`g${index}`, 100, 100),
    );
    for (const coluna of splitIntoColumns(items, 2)) {
      const posicoes = coluna.map((item) => Number(item.id.slice(1)));
      expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    }
  });

  it("sobrevive a medidas ausentes ou zeradas", () => {
    const items = [gif("a", 0, 0), gif("b", 100, 100), gif("c", -1, 10)];
    expect(splitIntoColumns(items, 2).flat()).toHaveLength(3);
  });

  it("devolve o número de colunas pedido, mesmo vazio", () => {
    expect(splitIntoColumns([], 2)).toEqual([[], []]);
    expect(splitIntoColumns([gif("a", 1, 1)], 1)).toEqual([[gif("a", 1, 1)]]);
  });
});
