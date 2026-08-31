import { supabase } from "./client";
import { assertOnlineStorageUploadAllowed } from "./quota";

/**
 * Perfil do servidor: nome, ícone e descrição.
 *
 * O ícone vive no bucket privado `server-icons`, sempre em `<serverId>/…`.
 * Como a política de Storage usa essa pasta para autorizar a escrita, o id do
 * servidor é reservado antes do upload; se a criação falhar depois, o arquivo
 * órfão é removido aqui mesmo e nada meio-criado sobra no banco.
 */

const ICON_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const SERVER_ICON_MAX_BYTES = 5 * 1024 * 1024;

export function assertServerIconFile(file: Blob & { name?: string }) {
  if (!ICON_EXTENSIONS[file.type])
    throw new Error("Use uma imagem JPEG, PNG, WebP ou GIF.");
  if (file.size > SERVER_ICON_MAX_BYTES)
    throw new Error("O ícone do servidor excede 5 MB.");
}

export async function reserveServerId() {
  const { data, error } = await supabase.rpc("reserve_server_id");
  if (error) throw error;
  return data as string;
}

async function uploadServerIcon(serverId: string, icon: Blob) {
  assertServerIconFile(icon);
  await assertOnlineStorageUploadAllowed(icon.size);
  const path = `${serverId}/${crypto.randomUUID()}.${ICON_EXTENSIONS[icon.type]}`;
  const { error } = await supabase.storage
    .from("server-icons")
    .upload(path, icon, { contentType: icon.type, upsert: false });
  if (error) throw error;
  return path;
}

async function removeServerIcon(path: string) {
  await supabase.storage
    .from("server-icons")
    .remove([path])
    .catch(() => undefined);
}

export async function createOnlineServerProfile({
  name,
  description,
  icon,
}: {
  name: string;
  description: string;
  icon?: Blob | null;
}) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Informe o nome do servidor.");
  if (trimmedName.length > 100)
    throw new Error("O nome do servidor deve ter no máximo 100 caracteres.");
  const trimmedDescription = description.trim();
  if (trimmedDescription.length > 1000)
    throw new Error("A descrição deve ter no máximo 1000 caracteres.");
  const serverId = await reserveServerId();
  let iconPath: string | undefined;
  if (icon) iconPath = await uploadServerIcon(serverId, icon);
  try {
    const { data, error } = await supabase.rpc("create_server", {
      p_name: trimmedName,
      p_description: trimmedDescription,
      p_icon_path: iconPath ?? null,
      p_server_id: serverId,
    });
    if (error) throw error;
    return data as string;
  } catch (caught) {
    if (iconPath) await removeServerIcon(iconPath);
    throw caught;
  }
}

export async function updateOnlineServerProfile({
  serverId,
  name,
  description,
  icon,
  clearIcon = false,
  previousIconPath,
}: {
  serverId: string;
  name: string;
  description: string;
  icon?: Blob | null;
  clearIcon?: boolean;
  previousIconPath?: string;
}) {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Informe o nome do servidor.");
  if (trimmedName.length > 100)
    throw new Error("O nome do servidor deve ter no máximo 100 caracteres.");
  const trimmedDescription = description.trim();
  if (trimmedDescription.length > 1000)
    throw new Error("A descrição deve ter no máximo 1000 caracteres.");
  let iconPath: string | undefined;
  if (icon && !clearIcon) iconPath = await uploadServerIcon(serverId, icon);
  try {
    const { error } = await supabase.rpc("update_server", {
      p_server_id: serverId,
      p_name: trimmedName,
      p_description: trimmedDescription,
      p_icon_path: iconPath ?? null,
      p_clear_icon: clearIcon,
    });
    if (error) throw error;
  } catch (caught) {
    if (iconPath) await removeServerIcon(iconPath);
    throw caught;
  }
  // O arquivo anterior só sai depois que o novo caminho já está no banco.
  if (previousIconPath && previousIconPath !== iconPath && (iconPath || clearIcon))
    await removeServerIcon(previousIconPath);
}
