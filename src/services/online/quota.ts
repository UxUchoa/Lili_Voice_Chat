import { supabase } from "./client";

export interface OnlineQuotaStatus {
  databaseUsedBytes: number;
  databaseLimitBytes: number;
  databasePercent: number;
  databaseLevel: "OK" | "NOTICE" | "WARNING" | "CRITICAL";
  storageUsedBytes: number;
  storageLimitBytes: number;
  storagePercent: number;
  storageLevel: "OK" | "NOTICE" | "WARNING" | "CRITICAL";
  measuredAt: string;
}

export async function getOnlineQuotaStatus() {
  const { data, error } = await supabase.rpc("instance_quota_status");
  if (error) throw error;
  const row = data?.[0];
  if (!row) throw new Error("A instância não retornou métricas de quota.");
  return {
    databaseUsedBytes: Number(row.database_used_bytes),
    databaseLimitBytes: Number(row.database_limit_bytes),
    databasePercent: Number(row.database_percent),
    databaseLevel: row.database_level,
    storageUsedBytes: Number(row.storage_used_bytes),
    storageLimitBytes: Number(row.storage_limit_bytes),
    storagePercent: Number(row.storage_percent),
    storageLevel: row.storage_level,
    measuredAt: row.measured_at,
  } satisfies OnlineQuotaStatus;
}

export async function assertOnlineStorageUploadAllowed(sizeBytes: number) {
  const { data, error } = await supabase.rpc("can_accept_storage_upload", {
    p_size_bytes: Math.max(0, Math.ceil(sizeBytes)),
  });
  if (error) throw error;
  if (!data)
    throw new Error(
      "Uploads estão temporariamente bloqueados porque o armazenamento atingiu 95% da quota.",
    );
}

export type QuotaLevel = "OK" | "NOTICE" | "WARNING" | "CRITICAL";

/**
 * Consumo deste servidor contra a fatia que cabe a ele.
 *
 * A fatia é o teto da instância dividido pelo número de servidores. Ela encolhe
 * quando alguém cria um servidor novo, e é isso que "dividir a mesma banda"
 * quer dizer: o rateio fica visível em vez de acontecer em silêncio até alguém
 * bater no teto.
 */
export interface ServerQuotaStatus {
  usedBytes: number;
  shareBytes: number;
  percent: number;
  level: QuotaLevel;
  messageCount: number;
  oldestMessageAt: string | null;
}

export async function getServerQuotaStatus(serverId: string) {
  const { data, error } = await supabase.rpc("server_quota_status", {
    p_server_id: serverId,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("O servidor não retornou métricas de quota.");
  return {
    usedBytes: Number(row.used_bytes),
    shareBytes: Number(row.share_bytes),
    percent: Number(row.percent),
    level: row.level,
    messageCount: Number(row.message_count),
    oldestMessageAt: row.oldest_message_at ?? null,
  } satisfies ServerQuotaStatus;
}

/**
 * Apaga da mensagem mais antiga para a mais nova até o servidor caber na
 * fatia. Mensagem fixada é preservada: alguém marcou aquilo como o que vale
 * guardar.
 *
 * É irreversível — não há lixeira. Quem chama precisa ter confirmado.
 */
export async function pruneOnlineServerMessages(
  serverId: string,
  targetPercent = 70,
) {
  const { data, error } = await supabase.rpc("prune_server_messages", {
    p_server_id: serverId,
    p_target_percent: targetPercent,
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return {
    deletedCount: Number(row?.deleted_count ?? 0),
    freedBytes: Number(row?.freed_bytes ?? 0),
  };
}
