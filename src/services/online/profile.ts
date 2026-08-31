import type {
  MessageView,
  PresenceStatus,
  PrivacySetting,
} from "../../domain/types";
import { getMlsEngine } from "../../crypto/mlsEngine";
import { supabase } from "./client";
import { assertOnlineStorageUploadAllowed } from "./quota";

export interface OnlineDevice {
  id: string;
  name: string;
  platform: string;
  fingerprint: string;
  lastSeenAt: string;
  revokedAt?: string;
  verifiedAt?: string;
}

export async function saveOnlineProfile(
  userId: string,
  changes: {
    username: string;
    displayName: string;
    bio: string;
    pronouns: string;
    customStatus: string;
    presence: PresenceStatus;
  },
) {
  const username = changes.username.trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,24}$/.test(username))
    throw new Error(
      "O username deve ter 3–24 caracteres: letras minúsculas, números, _ ou .",
    );
  const { error } = await supabase
    .from("profiles")
    .update({
      username,
      display_name: changes.displayName.trim(),
      bio: changes.bio,
      pronouns: changes.pronouns.trim() || null,
      custom_status: changes.customStatus.trim() || null,
      presence: changes.presence,
    })
    .eq("id", userId);
  if (error) throw error;
}

export async function uploadOnlineProfileMedia(
  userId: string,
  kind: "avatar" | "banner",
  file: File,
) {
  const bucket = kind === "avatar" ? "avatars" : "banners";
  const maxBytes = kind === "avatar" ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const extension = extensions[file.type];
  if (!extension) throw new Error("Use uma imagem JPEG, PNG, WebP ou GIF.");
  if (file.size > maxBytes)
    throw new Error(
      `${kind === "avatar" ? "Avatar" : "Banner"} excede ${maxBytes / 1024 / 1024} MB.`,
    );
  await assertOnlineStorageUploadAllowed(file.size);

  const column = kind === "avatar" ? "avatar_path" : "banner_path";
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(column)
    .eq("id", userId)
    .single();
  if (profileError) throw profileError;
  const oldPath = (profile as Record<string, string | null>)[column];
  const path = `${userId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;
  const { error: updateError } = await supabase
    .from("profiles")
    .update({ [column]: path })
    .eq("id", userId);
  if (updateError) {
    await supabase.storage.from(bucket).remove([path]);
    throw updateError;
  }
  if (oldPath && oldPath !== path)
    await supabase.storage.from(bucket).remove([oldPath]);
  return path;
}

export async function saveOnlinePrivacy(
  userId: string,
  changes: Partial<Omit<PrivacySetting, "userId">>,
) {
  const values: Record<string, unknown> = {};
  if (changes.dmPolicy !== undefined) values.dm_policy = changes.dmPolicy;
  if (changes.friendRequestPolicy !== undefined)
    values.friend_request_policy = changes.friendRequestPolicy;
  if (changes.profileVisible !== undefined)
    values.profile_visible = changes.profileVisible;
  const { error } = await supabase
    .from("profiles")
    .update(values)
    .eq("id", userId);
  if (error) throw error;
}

export async function listOnlineDevices(userId: string) {
  await getMlsEngine(userId);
  const { data, error } = await supabase
    .from("devices")
    .select("id,name,platform,fingerprint,last_seen_at,revoked_at,verified_at")
    .eq("user_id", userId)
    .order("last_seen_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((device) => ({
    id: device.id,
    name: device.name,
    platform: device.platform,
    fingerprint: device.fingerprint,
    lastSeenAt: device.last_seen_at,
    revokedAt: device.revoked_at ?? undefined,
    verifiedAt: device.verified_at ?? undefined,
  })) satisfies OnlineDevice[];
}

export async function revokeOnlineDevice(deviceId: string) {
  const { error } = await supabase
    .from("devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", deviceId)
    .is("revoked_at", null);
  if (error) throw error;
}

export async function verifyOnlineDevice(deviceId: string, shortCode: string) {
  const { error } = await supabase.rpc("verify_device", {
    p_target_device_id: deviceId,
    p_short_code: shortCode,
  });
  if (error) throw error;
}

export async function listDecryptedOnlineMessages(
  userId: string,
  channelIds: string[],
  limit = 200,
): Promise<MessageView[]> {
  const engine = await getMlsEngine(userId);
  const results = await Promise.allSettled(
    channelIds.map((channelId) => engine.listMessages(channelId)),
  );
  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}
