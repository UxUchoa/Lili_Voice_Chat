import { describe, expect, it } from "vitest";
import { ALL_EMOJI, EMOJI_CATEGORIES, searchEmoji } from "./emoji";

describe("catálogo de emoji", () => {
  it("tem as oito categorias, todas com conteúdo", () => {
    expect(EMOJI_CATEGORIES).toHaveLength(8);
    for (const category of EMOJI_CATEGORIES)
      expect(category.emojis.length).toBeGreaterThan(15);
  });

  it("não repete o mesmo emoji dentro de uma categoria", () => {
    for (const category of EMOJI_CATEGORIES) {
      const chars = category.emojis.map((item) => item.char);
      expect(new Set(chars).size).toBe(chars.length);
    }
  });
});

describe("searchEmoji", () => {
  it("ignora acento, que é como as pessoas digitam com pressa", () => {
    expect(searchEmoji("coracao")[0]?.char).toBe("❤️");
    expect(searchEmoji("coração")[0]?.char).toBe("❤️");
  });

  it("encontra pelo nome e pelas palavras-chave", () => {
    expect(searchEmoji("fogo")[0]?.char).toBe("🔥");
    expect(searchEmoji("curti").map((item) => item.char)).toContain("👍");
  });

  it("devolve cada caractere uma vez só", () => {
    // 🔥 está em "natureza" e em "símbolos": na busca ele não pode duplicar,
    // senão a grade repete o item e o React reclama de chave igual.
    const chars = searchEmoji("fogo").map((item) => item.char);
    expect(new Set(chars).size).toBe(chars.length);
  });

  it("não devolve nada para busca vazia", () => {
    expect(searchEmoji("")).toEqual([]);
    expect(searchEmoji("   ")).toEqual([]);
  });

  it("respeita o limite pedido", () => {
    expect(searchEmoji("a", 5).length).toBeLessThanOrEqual(5);
  });

  it("todo item do catálogo é alcançável pelo próprio nome", () => {
    const amostra = ALL_EMOJI.slice(0, 40);
    for (const item of amostra)
      expect(
        searchEmoji(item.name, 200).some((hit) => hit.char === item.char),
      ).toBe(true);
  });
});
