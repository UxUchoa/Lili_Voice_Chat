import { describe, expect, it } from "vitest";
import {
  RECOVERY_KEY_LENGTH,
  formatRecoveryKey,
  generateRecoveryKey,
  hashRecoveryKey,
  isRecoveryKeyShaped,
  normalizeRecoveryKey,
} from "./recoveryKey";

describe("generateRecoveryKey", () => {
  it("entrega oito grupos de quatro, prontos para ler em voz alta", () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    expect(normalizeRecoveryKey(key)).toHaveLength(RECOVERY_KEY_LENGTH);
  });

  it("não repete: são 160 bits sorteados a cada chamada", () => {
    const keys = new Set(Array.from({ length: 200 }, generateRecoveryKey));
    expect(keys.size).toBe(200);
  });

  it("nunca usa as letras que se confundem com número", () => {
    const chars = new Set(
      Array.from({ length: 300 }, generateRecoveryKey).join("").split(""),
    );
    for (const forbidden of ["I", "L", "O", "U"])
      expect(chars.has(forbidden)).toBe(false);
  });
});

describe("normalizeRecoveryKey", () => {
  it("aceita a chave como a pessoa digita", () => {
    const key = generateRecoveryKey();
    const sloppy = ` ${key.toLowerCase().replace(/-/g, " ")}  `;
    expect(normalizeRecoveryKey(sloppy)).toBe(normalizeRecoveryKey(key));
  });

  it("corrige a confusão entre O/0 e I/L/1", () => {
    expect(normalizeRecoveryKey("OIL")).toBe("011");
  });

  it("descarta o que não pertence ao alfabeto", () => {
    expect(normalizeRecoveryKey("AB!@#12")).toBe("AB12");
  });
});

describe("isRecoveryKeyShaped", () => {
  it("aprova a chave completa e recusa a incompleta", () => {
    expect(isRecoveryKeyShaped(generateRecoveryKey())).toBe(true);
    expect(isRecoveryKeyShaped("ABCD-EFGH")).toBe(false);
    expect(isRecoveryKeyShaped("")).toBe(false);
  });
});

describe("hashRecoveryKey", () => {
  it("é estável e independente de como a chave foi digitada", async () => {
    const key = generateRecoveryKey();
    const direct = await hashRecoveryKey(key);
    const sloppy = await hashRecoveryKey(key.toLowerCase().replace(/-/g, ""));
    expect(direct).toBe(sloppy);
  });

  it("muda por completo quando a chave muda", async () => {
    const [first, second] = [generateRecoveryKey(), generateRecoveryKey()];
    expect(await hashRecoveryKey(first)).not.toBe(await hashRecoveryKey(second));
  });

  it("cabe em base64url, sem caractere que precise de escape", async () => {
    const hash = await hashRecoveryKey(generateRecoveryKey());
    expect(hash).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("recusa a chave truncada em vez de gerar hash de meia chave", async () => {
    await expect(hashRecoveryKey("ABCD-EFGH")).rejects.toThrow(
      /32 caracteres/,
    );
  });
});

describe("formatRecoveryKey", () => {
  it("agrupa de quatro em quatro", () => {
    expect(formatRecoveryKey("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});
