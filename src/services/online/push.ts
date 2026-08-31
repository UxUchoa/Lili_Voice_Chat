import { onlineConfig } from "./config";
import { supabase } from "./client";

const decodeVapidKey = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

export async function registerRemotePush(userId: string, deviceId?: string) {
  if (
    !onlineConfig.vapidPublicKey ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return {
      registered: false,
      reason: "unsupported-or-unconfigured",
    } as const;
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted")
    return { registered: false, reason: "permission-denied" } as const;
  const registration = await navigator.serviceWorker.register("/push-sw.js", {
    scope: "/",
  });
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(onlineConfig.vapidPublicKey),
    }));
  const json = subscription.toJSON();
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: userId,
      device_id: deviceId ?? null,
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh,
      auth: json.keys?.auth,
      user_agent: navigator.userAgent,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw error;
  return { registered: true, endpoint: subscription.endpoint } as const;
}
