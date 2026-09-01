export type MlsPersistenceMode = "durable" | "session";

export const INDEXED_DB_MASTER_KEY = "indexeddb:v1";

export class MissingLocalMlsKeyError extends Error {
  constructor() {
    super("A chave E2EE deste dispositivo não existe mais neste navegador.");
    this.name = "MissingLocalMlsKeyError";
  }
}

export class MlsLocalStateError extends Error {
  constructor(cause?: unknown) {
    super(
      "O cofre E2EE local está corrompido. O dispositivo foi preservado para não perder o histórico automaticamente.",
      { cause },
    );
    this.name = "MlsLocalStateError";
  }
}

/**
 * Tenta tornar a chave durável sem transformar falha de compatibilidade em
 * perda de acesso. O chamador define o fallback de sessão, que só roda quando
 * a gravação durável falha.
 */
export async function persistWithSessionFallback(
  persistDurably: () => Promise<void>,
  useSession: () => void | Promise<void>,
): Promise<{ mode: MlsPersistenceMode; error?: unknown }> {
  try {
    await persistDurably();
    return { mode: "durable" };
  } catch (error) {
    await useSession();
    return { mode: "session", error };
  }
}

/** Apenas a ausência comprovada da chave autoriza substituir o dispositivo. */
export function shouldReplaceMissingMlsDevice(caught: unknown) {
  return caught instanceof MissingLocalMlsKeyError;
}

export function mlsMessageCacheId(userId: string, messageId: string) {
  return `${userId}:${messageId}`;
}
