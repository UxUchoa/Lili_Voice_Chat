import type { NotificationSetting } from "../../domain/types";
import { supabase } from "./client";

export async function saveOnlineNotificationSetting(
  setting: NotificationSetting,
) {
  const { error } = await supabase.from("notification_settings").upsert(
    {
      user_id: setting.userId,
      scope_type: setting.scopeType,
      scope_id: setting.scopeId,
      mode: setting.mode,
      suppress_everyone: setting.suppressEveryone,
      suppress_roles: setting.suppressRoles,
      muted_until: setting.mutedUntil ?? null,
    },
    { onConflict: "user_id,scope_type,scope_id" },
  );
  if (error) throw error;
}

export async function deleteOnlineNotificationSetting(
  scopeType: NotificationSetting["scopeType"],
  scopeId: string,
) {
  const { error } = await supabase
    .from("notification_settings")
    .delete()
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId);
  if (error) throw error;
}
