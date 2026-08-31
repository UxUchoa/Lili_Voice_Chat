export async function collectBatches<T>(
  fetchBatch: (from: number, to: number) => Promise<T[]>,
  batchSize = 200,
) {
  if (!Number.isInteger(batchSize) || batchSize < 1)
    throw new Error("O tamanho do lote deve ser um inteiro positivo.");
  const rows: T[] = [];
  while (true) {
    const batch = await fetchBatch(rows.length, rows.length + batchSize - 1);
    rows.push(...batch);
    if (batch.length < batchSize) return rows;
  }
}

type CursorMessage = { id: string; createdAt: string };

const compareMessages = (left: CursorMessage, right: CursorMessage) =>
  left.createdAt.localeCompare(right.createdAt) ||
  left.id.localeCompare(right.id);

const cursorFor = (message: CursorMessage) =>
  `${message.createdAt}|${message.id}`;

export function selectOlderPage<T extends CursorMessage>(
  input: T[],
  before?: string,
  limit = 50,
): { messages: T[]; nextCursor?: string } {
  const messages = [...input].sort(compareMessages);
  const separator = before?.lastIndexOf("|") ?? -1;
  const cursor = before
    ? {
        createdAt: separator >= 0 ? before.slice(0, separator) : before,
        id: separator >= 0 ? before.slice(separator + 1) : "",
      }
    : undefined;
  const eligible = cursor
    ? messages.filter((message) => compareMessages(message, cursor) < 0)
    : messages;
  const start = Math.max(0, eligible.length - limit);
  const page = eligible.slice(start);
  return {
    messages: page,
    nextCursor: start > 0 && page[0] ? cursorFor(page[0]) : undefined,
  };
}
