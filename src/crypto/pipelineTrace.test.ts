import { describe, expect, it, vi } from "vitest";
import { MessagePipelineError, runStage } from "./pipelineTrace";

describe("runStage", () => {
  it("devolve o valor quando o estágio passa", async () => {
    await expect(
      runStage("SEND", "CONVERSATION_RESOLVED", { channelId: "c" }, async () => "ok"),
    ).resolves.toBe("ok");
  });

  it("nomeia o estágio que falhou e preserva a causa", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cause = new Error("insert recusado");

    const caught = await runStage(
      "SEND",
      "DATABASE_INSERT",
      { channelId: "c" },
      async () => {
        throw cause;
      },
    ).catch((error: unknown) => error);

    expect(caught).toBeInstanceOf(MessagePipelineError);
    expect((caught as MessagePipelineError).message).toContain(
      "SEND_FAILED_AT=DATABASE_INSERT",
    );
    expect((caught as MessagePipelineError).cause).toBe(cause);
  });

  it("dá texto a uma rejeição sem mensagem do WebCrypto", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const caught = await runStage(
      "RECEIVE",
      "ROWS_FETCHED",
      {},
      async () => {
        throw new DOMException("", "OperationError");
      },
    ).catch((error: unknown) => error);

    expect((caught as Error).message).toBe(
      "RECEIVE_FAILED_AT=ROWS_FETCHED: falha sem mensagem do provedor",
    );
  });

  it("não reembrulha um erro que já traz o estágio", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const inner = new MessagePipelineError(
      "SEND",
      "CONVERSATION_RESOLVED",
      {},
      new Error("raiz"),
    );

    const caught = await runStage("SEND", "DATABASE_INSERT", {}, async () => {
      throw inner;
    }).catch((error: unknown) => error);

    expect(caught).toBe(inner);
  });

  it("não deixa segredo entrar no registro do estágio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runStage(
      "SEND",
      "ATTACHMENTS_UPLOADED",
      { channelId: "canal", deviceId: "disp" },
      async () => {
        throw new Error("chave-secreta-nao-pode-vazar");
      },
    ).catch(() => undefined);

    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "chave-secreta-nao-pode-vazar",
    );
  });
});
