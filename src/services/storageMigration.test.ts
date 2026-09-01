import { describe, expect, it } from "vitest";
import { migrateLegacyStorageKeys } from "./storageMigration";

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    clear: () => map.clear(),
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
    snapshot: () => Object.fromEntries(map),
  };
}

describe("migrateLegacyStorageKeys", () => {
  it("devolve a sessão presa no nome do rename", () => {
    const storage = fakeStorage({ "lili.supabase.session": "token-vivo" });

    migrateLegacyStorageKeys(storage as unknown as Storage);

    expect(storage.snapshot()).toEqual({
      "janja.supabase.session": "token-vivo",
    });
  });

  it("apaga o cofre abandonado mesmo quando já existe sessão atual", () => {
    // O segundo cofre é o que renova o refresh token por fora e derruba a
    // sessão boa. Preservar o valor atual não basta: o órfão precisa sumir.
    const storage = fakeStorage({
      "janja.supabase.session": "token-atual",
      "lili.supabase.session": "token-antigo",
    });

    migrateLegacyStorageKeys(storage as unknown as Storage);

    expect(storage.snapshot()).toEqual({
      "janja.supabase.session": "token-atual",
    });
  });

  it("restaura as preferências sem tocar em chaves de terceiros", () => {
    const storage = fakeStorage({
      "lili-ui-preferences-v2": '{"volume":0.3}',
      "lili.camera.quality": "720",
      "janja-emoji-recent-v1": '["ok"]',
      "outro-app": "intocado",
    });

    migrateLegacyStorageKeys(storage as unknown as Storage);

    expect(storage.snapshot()).toEqual({
      "janja-ui-preferences-v2": '{"volume":0.3}',
      "janja.camera.quality": "720",
      "janja-emoji-recent-v1": '["ok"]',
      "outro-app": "intocado",
    });
  });

  it("não recria nada quando o navegador nunca viu o rename", () => {
    const storage = fakeStorage({ "janja.supabase.session": "token" });

    migrateLegacyStorageKeys(storage as unknown as Storage);

    expect(storage.snapshot()).toEqual({ "janja.supabase.session": "token" });
  });

  it("desiste em silêncio quando o armazenamento está bloqueado", () => {
    const blocked = {
      getItem: () => {
        throw new DOMException("acesso negado", "SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };

    expect(() =>
      migrateLegacyStorageKeys(blocked as unknown as Storage),
    ).not.toThrow();
  });

  it("segue para as próximas chaves quando uma escrita falha", () => {
    const map = new Map([
      ["lili.supabase.session", "token"],
      ["lili.camera.quality", "720"],
    ]);
    const flaky = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === "janja.supabase.session")
          throw new DOMException("cota", "QuotaExceededError");
        map.set(key, value);
      },
      removeItem: (key: string) => void map.delete(key),
    };

    migrateLegacyStorageKeys(flaky as unknown as Storage);

    expect(map.get("janja.camera.quality")).toBe("720");
  });
});
