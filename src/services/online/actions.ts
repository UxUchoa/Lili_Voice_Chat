import type { Channel, Role } from "../../domain/types";
import { supabase } from "./client";
import { assertOnlineStorageUploadAllowed } from "./quota";

async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const deleteOnlineServer = (serverId: string) =>
  rpc("delete_server", { p_server_id: serverId });
export const leaveOnlineServer = (serverId: string) =>
  rpc("leave_server", { p_server_id: serverId });
export const transferOnlineServer = (serverId: string, userId: string) =>
  rpc("transfer_server", { p_server_id: serverId, p_new_owner_id: userId });

export const updateOnlineChannel = (channel: Channel) =>
  rpc("update_channel", {
    p_channel_id: channel.id,
    p_name: channel.name,
    p_slowmode_seconds: channel.slowmodeSeconds,
    p_private: channel.private,
    p_user_limit: channel.userLimit,
    p_topic: channel.topic ?? "",
  });
/** Devolve as permissões do canal às da categoria em que ele está. */
export const syncOnlineChannelWithCategory = (channelId: string) =>
  rpc("sync_channel_with_category", { p_channel_id: channelId });
export const deleteOnlineChannel = (channelId: string) =>
  rpc("delete_channel", { p_channel_id: channelId });
export async function duplicateOnlineChannel(channelId: string) {
  return (await rpc("duplicate_channel", {
    p_channel_id: channelId,
  })) as string;
}
export const reorderOnlineChannel = (
  channelId: string,
  direction: "up" | "down",
) =>
  rpc("reorder_channel", { p_channel_id: channelId, p_direction: direction });
export const moveOnlineChannelToCategory = (
  channelId: string,
  categoryId?: string,
  syncPermissions = true,
) =>
  rpc("move_channel_to_category", {
    p_channel_id: channelId,
    p_category_id: categoryId ?? null,
    p_sync_permissions: syncPermissions,
  });

export async function createOnlineRole(serverId: string, name: string) {
  return (await rpc("create_role", {
    p_server_id: serverId,
    p_name: name,
  })) as string;
}
export const updateOnlineRole = (role: Role) =>
  rpc("update_role", {
    p_role_id: role.id,
    p_name: role.name,
    p_color: role.color,
    p_permissions: role.permissions,
    p_hoist: role.hoist,
    p_mentionable: role.mentionable,
    p_unicode_emoji: role.icon ?? null,
  });
export const deleteOnlineRole = (roleId: string) =>
  rpc("delete_role", { p_role_id: roleId });
export async function duplicateOnlineRole(roleId: string) {
  return (await rpc("duplicate_role", { p_role_id: roleId })) as string;
}
export const reorderOnlineRole = (roleId: string, direction: "up" | "down") =>
  rpc("reorder_role", { p_role_id: roleId, p_direction: direction });
export const setOnlineMemberRole = (
  serverId: string,
  userId: string,
  roleId: string,
  assign: boolean,
) =>
  rpc("set_member_role", {
    p_server_id: serverId,
    p_target_id: userId,
    p_role_id: roleId,
    p_assign: assign,
  });
export const setOnlineChannelOverride = (
  channelId: string,
  targetType: "ROLE" | "MEMBER",
  targetId: string,
  allow: bigint,
  deny: bigint,
) =>
  rpc("set_channel_override", {
    p_channel_id: channelId,
    p_target_type: targetType,
    p_target_id: targetId,
    p_allow: allow.toString(),
    p_deny: deny.toString(),
  });
export const moderateOnlineMember = (
  serverId: string,
  userId: string,
  action: "kick" | "ban" | "timeout",
  reason?: string,
  minutes = 10,
) =>
  rpc("moderate_member", {
    p_server_id: serverId,
    p_target_id: userId,
    p_action: action,
    p_reason: reason ?? null,
    p_timeout_minutes: minutes,
  });
export const unbanOnlineMember = (serverId: string, userId: string) =>
  rpc("unban_member", { p_server_id: serverId, p_target_id: userId });
export const updateOnlineMemberNickname = (
  serverId: string,
  userId: string,
  nickname: string,
) =>
  rpc("update_member_nickname", {
    p_server_id: serverId,
    p_target_id: userId,
    p_nickname: nickname,
  });
export const markOnlineChannelRead = (channelId: string, messageId?: string) =>
  rpc("mark_channel_read", {
    p_channel_id: channelId,
    p_last_message_id: messageId ?? null,
  });
export async function moderateOnlineVoice(
  channelId: string,
  userId: string,
  action: "mute" | "unmute" | "deafen" | "undeafen" | "disconnect" | "move",
  destinationChannelId?: string,
) {
  const { data, error } = await supabase.functions.invoke("livekit-moderate", {
    body: {
      channel_id: channelId,
      target_user_id: userId,
      action,
      destination_channel_id: destinationChannelId,
    },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}
export async function createOnlineDirectChannel(
  userIds: string[],
  name?: string,
) {
  return (await rpc("create_direct_channel", {
    p_member_ids: userIds,
    p_name: name ?? null,
  })) as string;
}
export async function saveOnlineGroupDm(
  channel: Channel,
  name: string,
  iconFile?: File | null,
  removeIcon = false,
) {
  let nextIconPath = removeIcon ? undefined : channel.iconPath;
  let uploadedPath: string | undefined;
  if (iconFile) {
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const extension = extensions[iconFile.type];
    if (!extension) throw new Error("Use um ícone JPEG, PNG, WebP ou GIF.");
    if (iconFile.size > 5 * 1024 * 1024)
      throw new Error("O ícone do grupo excede 5 MB.");
    await assertOnlineStorageUploadAllowed(iconFile.size);
    uploadedPath = `${channel.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage
      .from("gdm-icons")
      .upload(uploadedPath, iconFile, {
        contentType: iconFile.type,
        upsert: false,
      });
    if (error) throw error;
    nextIconPath = uploadedPath;
  }
  try {
    await rpc("update_group_dm", {
      p_channel_id: channel.id,
      p_name: name,
      p_icon_path: nextIconPath ?? null,
    });
  } catch (caught) {
    if (uploadedPath)
      await supabase.storage.from("gdm-icons").remove([uploadedPath]);
    throw caught;
  }
  if (channel.iconPath && channel.iconPath !== nextIconPath)
    await supabase.storage.from("gdm-icons").remove([channel.iconPath]);
}
export const addOnlineGroupDmMember = (channelId: string, userId: string) =>
  rpc("add_group_dm_member", {
    p_channel_id: channelId,
    p_user_id: userId,
  });
export const removeOnlineGroupDmMember = (channelId: string, userId: string) =>
  rpc("remove_group_dm_member", {
    p_channel_id: channelId,
    p_user_id: userId,
  });
export const requestOnlineFriend = (userId: string) =>
  rpc("request_friend", { p_addressee_id: userId });
export const respondOnlineFriend = (friendshipId: string, accept: boolean) =>
  rpc("respond_friend_request", {
    p_friendship_id: friendshipId,
    p_accept: accept,
  });
export async function removeOnlineFriend(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId);
  if (error) throw error;
}
export async function blockOnlineUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from("blocks")
    .upsert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
  // Bloquear encerra a amizade e solicitações pendentes entre o par; sem isto
  // o usuário apareceria como amigo e bloqueado ao mesmo tempo.
  const { error: friendshipError } = await supabase
    .from("friendships")
    .delete()
    .or(
      `and(requester_id.eq.${blockerId},addressee_id.eq.${blockedId}),and(requester_id.eq.${blockedId},addressee_id.eq.${blockerId})`,
    );
  if (friendshipError) throw friendshipError;
}

export async function cancelOnlineFriendRequest(friendshipId: string) {
  const { error } = await supabase
    .from("friendships")
    .delete()
    .eq("id", friendshipId)
    .eq("status", "pending");
  if (error) throw error;
}
export async function unblockOnlineUser(blockerId: string, blockedId: string) {
  const { error } = await supabase
    .from("blocks")
    .delete()
    .eq("blocker_id", blockerId)
    .eq("blocked_id", blockedId);
  if (error) throw error;
}
