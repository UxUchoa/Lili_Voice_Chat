import { describe, expect, it } from "vitest";
import {
  REACTION_MAX_GRAPHEMES,
  countGraphemes,
  reactionError,
  truncateGraphemes,
} from "./reactions";

describe("countGraphemes", () => {
  it("conta um emoji como um caractere, e não como suas unidades UTF-16", () => {
    // "❤️" tem length 2 e "👨‍👩‍👧" tem length 8: contar `length` recusaria
    // um único emoji como se fossem vários caracteres.
    expect("❤️".length).toBeGreaterThan(1);
    expect(countGraphemes("❤️")).toBe(1);
    expect(countGraphemes("👨‍👩‍👧")).toBe(1);
    expect(countGraphemes("😂")).toBe(1);
  });

  it("conta texto simples", () => {
    expect(countGraphemes("GG")).toBe(2);
    expect(countGraphemes("kkkkk")).toBe(5);
  });

  it("conta combinações de emoji e texto", () => {
    expect(countGraphemes("😂GG")).toBe(3);
    expect(countGraphemes("aprovado✅")).toBe(9);
  });
});

describe("reactionError", () => {
  it("aceita os formatos que o produto permite", () => {
    for (const valid of ["😂", "❤️", "GG", "kkkkk", "😂GG", "aprovado✅"])
      expect(reactionError(valid)).toBeUndefined();
  });

  it("aceita exatamente o limite", () => {
    expect(reactionError("a".repeat(REACTION_MAX_GRAPHEMES))).toBeUndefined();
    expect(reactionError("❤️".repeat(REACTION_MAX_GRAPHEMES))).toBeUndefined();
  });

  it("recusa um caractere além do limite", () => {
    expect(reactionError("a".repeat(REACTION_MAX_GRAPHEMES + 1))).toBe(
      "A reação deve ter no máximo 15 caracteres.",
    );
  });

  it("recusa vazio e espaços em branco", () => {
    expect(reactionError("")).toBe("A reação não pode ficar em branco.");
    expect(reactionError("   ")).toBe("A reação não pode ficar em branco.");
    expect(reactionError("\t\n ")).toBe("A reação não pode ficar em branco.");
  });

  it("ignora espaços nas pontas antes de medir", () => {
    expect(reactionError("  GG  ")).toBeUndefined();
  });
});

describe("truncateGraphemes", () => {
  it("não parte um emoji ao meio", () => {
    expect(truncateGraphemes("😂😂😂", 2)).toBe("😂😂");
    expect(countGraphemes(truncateGraphemes("👨‍👩‍👧abc", 1))).toBe(1);
  });

  it("devolve a string inteira quando ela já cabe", () => {
    expect(truncateGraphemes("GG", 15)).toBe("GG");
  });
});
