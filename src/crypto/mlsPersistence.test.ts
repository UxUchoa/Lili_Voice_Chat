import { describe, expect, it, vi } from "vitest";
import {
  MissingLocalMlsKeyError,
  MlsLocalStateError,
  mlsMessageCacheId,
  persistWithSessionFallback,
  shouldReplaceMissingMlsDevice,
} from "./mlsPersistence";

describe("persistWithSessionFallback", () => {
  it("mantém o modo durável quando o navegador aceita a CryptoKey", async () => {
    const fallback = vi.fn();
    const result = await persistWithSessionFallback(
      async () => undefined,
      fallback,
    );

    expect(result).toEqual({ mode: "durable" });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("ativa a sessão temporária somente quando a persistência falha", async () => {
    const failure = new DOMException("clone recusado", "DataCloneError");
    const fallback = vi.fn();
    const result = await persistWithSessionFallback(async () => {
      throw failure;
    }, fallback);

    expect(result).toEqual({ mode: "session", error: failure });
    expect(fallback).toHaveBeenCalledOnce();
  });
});

describe("mlsMessageCacheId", () => {
  it("isola a mesma mensagem para contas diferentes no mesmo navegador", () => {
    expect(mlsMessageCacheId("alice", "message-1")).not.toBe(
      mlsMessageCacheId("bob", "message-1"),
    );
  });
});

describe("classificação de falhas do cofre", () => {
  it("só substitui o dispositivo quando a chave está comprovadamente ausente", () => {
    expect(shouldReplaceMissingMlsDevice(new MissingLocalMlsKeyError())).toBe(
      true,
    );
    expect(shouldReplaceMissingMlsDevice(new TypeError("offline"))).toBe(false);
    expect(shouldReplaceMissingMlsDevice(new MlsLocalStateError())).toBe(false);
  });
});
