import { supabase } from "./client";

export interface AttachmentResendRequest {
  id: string;
  messageId: string;
  channelId: string;
  attachmentId: string;
  attachmentName: string;
  requesterId: string;
  ownerId: string;
  createdAt: string;
  resolvedAt: string | null;
}

type Row = {
  id: string;
  message_id: string;
  channel_id: string;
  attachment_id: string;
  attachment_name: string;
  requester_id: string;
  owner_id: string;
  created_at: string;
  resolved_at: string | null;
};

const toRequest = (row: Row): AttachmentResendRequest => ({
  id: row.id,
  messageId: row.message_id,
  channelId: row.channel_id,
  attachmentId: row.attachment_id,
  attachmentName: row.attachment_name,
  requesterId: row.requester_id,
  ownerId: row.owner_id,
  createdAt: row.created_at,
  resolvedAt: row.resolved_at,
});

/**
 * Apaga do armazenamento o que passou de 24 h.
 *
 * Precisa passar pela função de borda: o Postgres não consegue remover de
 * `storage.objects` (o Supabase bloqueia por gatilho) e só a API de Storage
 * apaga o arquivo. Em produção quem chama de minuto em minuto é o `pg_cron`
 * (`supabase/snippets/schedule_attachments_expire.sql`); esta chamada é a rede
 * de segurança para a instância sem agendador, disparada por quem estiver com
 * o app aberto.
 */
export async function expireOnlineAttachments() {
  const { data, error } = await supabase.functions.invoke<{ removed: number }>(
    "attachments-expire",
    { body: {} },
  );
  if (error) throw error;
  return Number(data?.removed ?? 0);
}

export async function requestOnlineAttachmentResend(
  messageId: string,
  attachmentId: string,
  attachmentName: string,
) {
  const { data, error } = await supabase.rpc("request_attachment_resend", {
    p_message_id: messageId,
    p_attachment_id: attachmentId,
    p_attachment_name: attachmentName,
  });
  if (error) throw error;
  return data as string;
}

export async function resolveOnlineAttachmentResend(requestId: string) {
  const { error } = await supabase.rpc("resolve_attachment_resend", {
    p_request_id: requestId,
  });
  if (error) throw error;
}

export async function listOnlineAttachmentResendRequests(channelId: string) {
  const { data, error } = await supabase
    .from("attachment_resend_requests")
    .select("*")
    .eq("channel_id", channelId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as Row[]).map(toRequest);
}

export function subscribeOnlineAttachmentResendRequests(
  channelId: string,
  onChange: () => void,
) {
  const channel = supabase
    .channel(`attachment-resend-${channelId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "attachment_resend_requests",
        filter: `channel_id=eq.${channelId}`,
      },
      onChange,
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
