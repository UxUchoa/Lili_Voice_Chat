import type { MessagePayload, MessageView } from "../../domain/types";
import { attachmentSizeError } from "../../domain/attachments";
import { collectBatches, selectOlderPage } from "../../crypto/messagePagination";
import { supabase } from "./client";
import { assertOnlineStorageUploadAllowed } from "./quota";
import { runStage } from "../../crypto/pipelineTrace";

/**
 * Mensagens em claro, protegidas por autenticação e RLS.
 *
 * Substitui o motor OpenMLS. O conteúdo passa a ser legível pelo backend; quem
 * decide o acesso são as políticas de `messages`, que exigem participação no
 * canal para ler e permissão de escrita para inserir. Não há mais chave local,
 * época, Welcome nem grupo — e portanto nada que possa dessincronizar entre
 * dispositivos e deixar a conversa ilegível.
 */

interface SendMessageInput {
  channelId: string;
  text: string;
  replyToId?: string;
  mentionRecipientIds?: string[];
  mentionRoleIds?: string[];
  mentionHereRecipientIds?: string[];
  mentionsEveryone?: boolean;
  mentionsHere?: boolean;
  resolvedMentionRecipientIds?: string[];
  files?: File[];
  /** Nomes dos arquivos que devem nascer cobertos. */
  spoilerNames?: Set<string>;
}

interface EditMessageInput {
  text: string;
  mentionRecipientIds?: string[];
  mentionRoleIds?: string[];
  mentionHereRecipientIds?: string[];
  mentionsEveryone?: boolean;
  mentionsHere?: boolean;
  resolvedMentionRecipientIds?: string[];
}

const MESSAGE_SELECT =
  "*, message_reactions(user_id, emoji), message_pins(pinned_at), message_attachments(*)";

/**
 * Identificador estável deste navegador.
 *
 * Vale só para a lista de sessões e para as chamadas — não protege nada. Fica
 * em `localStorage` para que um login novo no mesmo navegador reaproveite a
 * linha em vez de encher a lista de dispositivos fantasma a cada visita. O
 * nome da chave segue o padrão interno do projeto, que não acompanha a marca.
 */
const DEVICE_KEY = "janja.device.fingerprint";

function deviceFingerprint() {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // Armazenamento bloqueado: um identificador por sessão ainda deixa a
    // chamada funcionar; só a lista de sessões fica mais barulhenta.
    return crypto.randomUUID();
  }
}

const deviceIds = new Map<string, Promise<string>>();

/** Garante a linha em `devices` e devolve o id desta sessão. */
export function ensureDevice(userId: string): Promise<string> {
  if (!userId)
    return Promise.reject(new Error("Não há sessão autenticada."));
  let pending = deviceIds.get(userId);
  if (!pending) {
    pending = registerDevice().catch((caught) => {
      deviceIds.delete(userId);
      throw caught;
    });
    deviceIds.set(userId, pending);
  }
  return pending;
}

async function registerDevice() {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error("Não há sessão autenticada.");
  const { data, error } = await supabase
    .from("devices")
    .upsert(
      {
        user_id: user.id,
        name: navigator.userAgent.includes("Electron")
          ? "Lili Desktop"
          : "Lili Web",
        platform: navigator.platform || "web",
        fingerprint: deviceFingerprint(),
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "user_id,fingerprint" },
    )
    .select("id, revoked_at")
    .single();
  if (error) throw error;
  if (data.revoked_at)
    throw new Error("Esta sessão foi encerrada em outro dispositivo.");
  return data.id as string;
}

/** Esquece o dispositivo em memória; usado ao sair da conta. */
export function releaseDevice(userId: string) {
  deviceIds.delete(userId);
}

interface AttachmentRow {
  id: string;
  storage_object: string;
  byte_size: number;
  name: string;
  mime: string;
  spoiler: boolean | null;
}

interface MessageRow {
  id: string;
  channel_id: string;
  author_id: string;
  sender_device_id: string | null;
  body: string;
  reply_to_id: string | null;
  mention_recipient_ids: string[] | null;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  message_reactions?: Array<{ user_id: string; emoji: string }>;
  message_pins?: Array<{ pinned_at: string }> | { pinned_at: string } | null;
  message_attachments?: AttachmentRow[];
}

function toMessageView(row: MessageRow): MessageView {
  const deletedAt = row.deleted_at ?? undefined;
  const reactions: Record<string, string[]> = {};
  for (const reaction of row.message_reactions ?? [])
    reactions[reaction.emoji] = [
      ...(reactions[reaction.emoji] ?? []),
      reaction.user_id,
    ];
  // Uma lápide não carrega conteúdo: o corpo já sai vazio do banco, mas
  // reação, anexo e menção continuariam ali e apareceriam pendurados numa
  // mensagem que não existe mais.
  if (deletedAt)
    return {
      version: 1,
      text: "",
      mentions: [],
      reactions: {},
      attachments: [],
      id: row.id,
      channelId: row.channel_id,
      authorId: row.author_id,
      senderDeviceId: row.sender_device_id ?? undefined,
      replyToId: row.reply_to_id ?? undefined,
      pinned: false,
      createdAt: row.created_at,
      deletedAt,
    };
  return {
    version: 1,
    text: row.body,
    mentions: row.mention_recipient_ids ?? [],
    reactions,
    attachments: (row.message_attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      size: Number(attachment.byte_size),
      mime: attachment.mime,
      storageObject: attachment.storage_object,
      spoiler: attachment.spoiler ?? false,
    })),
    id: row.id,
    channelId: row.channel_id,
    authorId: row.author_id,
    senderDeviceId: row.sender_device_id ?? undefined,
    replyToId: row.reply_to_id ?? undefined,
    pinned: Array.isArray(row.message_pins)
      ? row.message_pins.length > 0
      : Boolean(row.message_pins),
    createdAt: row.created_at,
    editedAt: row.edited_at ?? undefined,
  };
}

export async function listMessages(channelId: string): Promise<MessageView[]> {
  const rows = await collectBatches<MessageRow>(async (from, to) => {
    const { data, error } = await supabase
      .from("messages")
      .select(MESSAGE_SELECT)
      .eq("channel_id", channelId)
      // As apagadas vêm junto de propósito: viram lápide na lista. O corpo já
      // foi zerado no momento da exclusão, então nada do conteúdo trafega.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as MessageRow[];
  });
  return rows.map(toMessageView);
}

export async function listMessagesPage(channelId: string, before?: string) {
  const messages = await listMessages(channelId);
  return selectOlderPage(messages, before);
}

/**
 * Sobe os anexos e devolve os metadados.
 *
 * Sem E2EE o arquivo vai como está: cifrá-lo com uma chave que viaja em claro
 * na mesma mensagem não protegeria de ninguém. O acesso é o do bucket, que
 * exige sessão autenticada.
 */
async function uploadAttachments(
  files: File[],
  channelId: string,
  spoilerNames: Set<string> = new Set(),
) {
  const selected = files.slice(0, 10);
  // Antes de subir qualquer byte: um arquivo recusado no fim do upload gasta a
  // banda de quem enviou para nada.
  for (const file of selected) {
    const tooLarge = attachmentSizeError(file);
    if (tooLarge) throw new Error(tooLarge);
  }
  await assertOnlineStorageUploadAllowed(
    selected.reduce((total, file) => total + file.size, 0),
  );
  const uploaded: Array<{
    id: string;
    storageObject: string;
    name: string;
    mime: string;
    size: number;
    spoiler: boolean;
  }> = [];
  for (const file of selected) {
    const id = crypto.randomUUID();
    const storageObject = `${channelId}/${id}`;
    const { error } = await supabase.storage
      .from("attachments")
      .upload(storageObject, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
        // O padrão do Storage é `max-age=3600`. Num anexo que vence em um dia
        // isso deixaria o navegador servindo o arquivo por até uma hora depois
        // de ele ser apagado do servidor.
        cacheControl: "no-store",
      });
    if (error) {
      if (uploaded.length)
        await supabase.storage
          .from("attachments")
          .remove(uploaded.map((item) => item.storageObject));
      throw error;
    }
    uploaded.push({
      id,
      storageObject,
      name: file.name,
      mime: file.type || "application/octet-stream",
      size: file.size,
      // `spoilerNames` chega do compositor: marcar acontece por arquivo, e o
      // nome e o unico identificador que existe antes do upload.
      spoiler: spoilerNames.has(file.name),
    });
  }
  return uploaded;
}

export async function sendMessage(userId: string, input: SendMessageInput) {
  if (input.text.length > 8_000)
    throw new Error("A mensagem excede o limite de 8.000 caracteres.");
  const where = { channelId: input.channelId };
  const deviceId = await runStage("SEND", "CONVERSATION_RESOLVED", where, () =>
    ensureDevice(userId),
  );
  const attachments = input.files?.length
    ? await runStage("SEND", "ATTACHMENTS_UPLOADED", where, () =>
        uploadAttachments(
          input.files ?? [],
          input.channelId,
          input.spoilerNames,
        ),
      )
    : [];
  try {
    const { data: messageId, error } = await supabase.rpc("send_message", {
      p_channel_id: input.channelId,
      p_body: input.text,
      p_device_id: deviceId,
      p_reply_to_id: input.replyToId ?? null,
      p_mention_recipient_ids:
        input.resolvedMentionRecipientIds ?? input.mentionRecipientIds ?? [],
      p_mention_role_ids: input.mentionRoleIds ?? [],
      p_mention_here_recipient_ids: input.mentionHereRecipientIds ?? [],
      p_mentions_everyone: input.mentionsEveryone ?? false,
      p_mentions_here: input.mentionsHere ?? false,
      // Vão na mesma transação da mensagem: inseri-los depois deixaria o
      // destinatário receber pelo realtime uma mensagem que anuncia arquivo
      // e ainda não tem nenhum.
      p_attachments: attachments.map((attachment) => ({
        id: attachment.id,
        storage_object: attachment.storageObject,
        byte_size: attachment.size,
        name: attachment.name,
        mime: attachment.mime,
        spoiler: attachment.spoiler,
      })),
    });
    if (error) throw error;
    return messageId as string;
  } catch (caught) {
    if (attachments.length)
      await supabase.storage
        .from("attachments")
        .remove(attachments.map((item) => item.storageObject));
    throw caught;
  }
}

export async function editMessage(messageId: string, input: EditMessageInput) {
  if (input.text.length > 8_000)
    throw new Error("A mensagem excede o limite de 8.000 caracteres.");
  const { error } = await supabase
    .from("messages")
    .update({
      body: input.text,
      edited_at: new Date().toISOString(),
      // A lista **pedida**. `mention_recipient_ids` é a resolvida, que o
      // gatilho de validação recalcula a partir desta — escrevê-la aqui
      // deixaria a menção removida na edição continuar valendo.
      mention_user_ids:
        input.resolvedMentionRecipientIds ?? input.mentionRecipientIds ?? [],
      mention_role_ids: input.mentionRoleIds ?? [],
      mention_here_recipient_ids: input.mentionHereRecipientIds ?? [],
      mentions_everyone: input.mentionsEveryone ?? false,
      mentions_here: input.mentionsHere ?? false,
    })
    .eq("id", messageId);
  if (error) throw error;
}

export async function downloadAttachment(
  attachment: MessagePayload["attachments"][number],
) {
  if (!attachment.storageObject)
    throw new Error("O anexo não tem caminho de armazenamento.");
  const { data, error } = await supabase.storage
    .from("attachments")
    .download(attachment.storageObject);
  if (error) throw error;
  return new Blob([await data.arrayBuffer()], { type: attachment.mime });
}

export async function downloadOnlineAttachment(
  _userId: string,
  attachment: MessagePayload["attachments"][number],
) {
  return downloadAttachment(attachment);
}
