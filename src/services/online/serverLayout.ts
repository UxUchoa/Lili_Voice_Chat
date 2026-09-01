import { supabase } from "./client";
import type {
  ServerFolder,
  ServerPlacement,
} from "../../domain/serverLayout";

/**
 * Arranjo da barra de servidores — itens 6 e 7.
 *
 * É de cada pessoa: dois membros do mesmo servidor arrastam para onde quiserem
 * sem interferir um no outro, e a RLS não deixa ninguém ler o arranjo alheio.
 */

export async function fetchServerLayout(): Promise<{
  folders: ServerFolder[];
  placements: ServerPlacement[];
}> {
  const [folders, placements] = await Promise.all([
    supabase
      .from("server_folders")
      .select("id,name,color,position")
      .order("position", { ascending: true }),
    supabase.from("server_placements").select("server_id,folder_id,position"),
  ]);
  if (folders.error) throw folders.error;
  if (placements.error) throw placements.error;
  return {
    folders: (folders.data ?? []).map((row) => ({
      id: row.id as string,
      name: row.name as string,
      color: (row.color as string | null) ?? undefined,
      position: Number(row.position),
    })),
    placements: (placements.data ?? []).map((row) => ({
      serverId: row.server_id as string,
      folderId: (row.folder_id as string | null) ?? undefined,
      position: Number(row.position),
    })),
  };
}

/**
 * Grava o arranjo inteiro.
 *
 * Mandar tudo de uma vez, e não "moveu um", torna a operação idempotente e
 * imune a corrida entre duas abas da mesma conta.
 */
export async function saveServerLayout(layout: {
  folders: Array<{ id: string; position: number }>;
  servers: Array<{ id: string; folder_id: string | null; position: number }>;
}) {
  const { error } = await supabase.rpc("save_server_layout", {
    p_folders: layout.folders,
    p_servers: layout.servers,
  });
  if (error) throw error;
}

export async function createServerFolder(name: string, color?: string) {
  const { data, error } = await supabase.rpc("create_server_folder", {
    p_name: name,
    p_color: color ?? null,
  });
  if (error) throw error;
  return data as string;
}

export async function updateServerFolder(
  folderId: string,
  changes: { name?: string; color?: string | null },
) {
  const { error } = await supabase.rpc("update_server_folder", {
    p_folder_id: folderId,
    p_name: changes.name ?? null,
    // String vazia limpa a cor; `null` mantém a atual.
    p_color: changes.color === null ? "" : (changes.color ?? null),
  });
  if (error) throw error;
}

/** Dissolve a pasta. Os servidores voltam ao topo — nenhum é removido. */
export async function deleteServerFolder(folderId: string) {
  const { error } = await supabase.rpc("delete_server_folder", {
    p_folder_id: folderId,
  });
  if (error) throw error;
}
