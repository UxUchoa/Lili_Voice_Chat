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
