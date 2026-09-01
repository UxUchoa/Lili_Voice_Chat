/**
 * Diagnóstico por estágio do caminho de uma mensagem.
 *
 * Uma falha de envio e uma falha de decifra são problemas diferentes, mas na
 * interface as duas viravam a mesma mensagem genérica — e a investigação
 * começava adivinhando. Aqui cada etapa é nomeada, e o erro carrega **onde**
 * parou: `SEND_FAILED_AT=ENCRYPTION` é uma pista; "falha ao enviar" não é.
 *
 * Nada de sensível entra nestes registros. Chave, segredo, texto em claro e
 * token não aparecem nem truncados: o que ajuda a depurar é o identificador e
 * o estágio, e é só isso que sai daqui.
 */

export const SEND_STAGES = [
  "CONVERSATION_RESOLVED",
  "GROUP_RESOLVED",
  "RECIPIENTS_RECONCILED",
  "ATTACHMENTS_ENCRYPTED",
  "ATTACHMENTS_UPLOADED",
  "ENCRYPTION",
  "STATE_PERSISTED",
  "DATABASE_INSERT",
  "ATTACHMENT_METADATA",
  "CACHE_WRITTEN",
] as const;

export const RECEIVE_STAGES = [
  "GROUP_RESOLVED",
  "EVENTS_PROCESSED",
  "ROWS_FETCHED",
  "CACHE_LOOKUP",
  "DECRYPTION",
  "RENDERED",
] as const;

export type SendStage = (typeof SEND_STAGES)[number];
export type ReceiveStage = (typeof RECEIVE_STAGES)[number];

/** Erro que preserva o estágio em que o caminho parou. */
export class MessagePipelineError extends Error {
  constructor(
    readonly phase: "SEND" | "RECEIVE",
    readonly stage: string,
    readonly detail: Record<string, unknown>,
    cause: unknown,
  ) {
    super(
      `${phase}_FAILED_AT=${stage}: ${
        cause instanceof Error && cause.message
          ? cause.message
          : // O WebCrypto rejeita com uma exceção sem mensagem; sem este texto
            // o alerta da interface aparecia em branco.
            "falha sem mensagem do provedor"
      }`,
      { cause },
    );
    this.name = "MessagePipelineError";
  }
}

/**
 * Executa um estágio anotando onde ele quebrou.
 *
 * O erro original vai em `cause`, intacto, para que quem trata um tipo
 * específico mais acima continue conseguindo reconhecê-lo.
 */
export async function runStage<T>(
  phase: "SEND" | "RECEIVE",
  stage: SendStage | ReceiveStage,
  detail: Record<string, unknown>,
  step: () => Promise<T>,
): Promise<T> {
  try {
    return await step();
  } catch (caught) {
    if (caught instanceof MessagePipelineError) throw caught;
    console.warn(`[pipeline] ${phase}_FAILED_AT=${stage}`, {
      ...detail,
      error: caught instanceof Error ? caught.name : typeof caught,
    });
    throw new MessagePipelineError(phase, stage, detail, caught);
  }
}

/**
 * Registra por que uma mensagem específica não abriu.
 *
 * Chamado no lugar do `catch` vazio que existia: uma mensagem anterior à
 * entrada deste dispositivo no grupo é esperada e não é defeito, mas
 * silenciá-la junto com as demais escondia o caso que importa.
 */
export function traceDecryptFailure(detail: {
  messageId: string;
  channelId: string;
  deviceId: string;
  senderDeviceId?: string;
  epoch?: number;
  joinedAtSequence?: number;
  reason: "NO_GROUP" | "PROCESS_MESSAGE_FAILED" | "CACHE_MISS_OWN_MESSAGE";
  error?: unknown;
}) {
  const { error, ...safe } = detail;
  console.debug("[pipeline] RECEIVE_FAILED_AT=DECRYPTION", {
    ...safe,
    error: error instanceof Error ? error.name : undefined,
  });
}
