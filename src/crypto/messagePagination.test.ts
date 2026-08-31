import { describe, expect, it, vi } from "vitest";
import { collectBatches, selectOlderPage } from "./messagePagination";

describe("paginação do histórico cifrado", () => {
  it("sincroniza todos os lotes em vez de parar em 200 mensagens", async () => {
    const source = Array.from({ length: 257 }, (_, index) => index);
    const fetchBatch = vi.fn(async (from: number, to: number) =>
      source.slice(from, to + 1),
    );

    await expect(collectBatches(fetchBatch, 200)).resolves.toEqual(source);
    expect(fetchBatch).toHaveBeenNthCalledWith(1, 0, 199);
    expect(fetchBatch).toHaveBeenNthCalledWith(2, 200, 399);
  });

  it("pagina sem perder mensagens que compartilham o mesmo timestamp", () => {
    const messages = Array.from({ length: 120 }, (_, index) => ({
      id: index.toString().padStart(3, "0"),
      createdAt: "2026-08-27T12:00:00.000Z",
    }));
    const newest = selectOlderPage(messages, undefined, 50);
    const middle = selectOlderPage(messages, newest.nextCursor, 50);
    const oldest = selectOlderPage(messages, middle.nextCursor, 50);

    expect(
      [...oldest.messages, ...middle.messages, ...newest.messages].map(
        (message) => message.id,
      ),
    ).toEqual(messages.map((message) => message.id));
    expect(oldest.nextCursor).toBeUndefined();
  });
});
