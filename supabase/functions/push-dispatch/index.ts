import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { json, withCors } from "../_shared/cors.ts";
import { dispatchPendingNotifications } from "./core.ts";

Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);
    const expectedSecret = Deno.env.get("PUSH_DISPATCH_SECRET");
    if (
      !expectedSecret ||
      request.headers.get("x-push-secret") !== expectedSecret
    )
      return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const vapidSubject = Deno.env.get("VAPID_SUBJECT") ?? "";
    const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
    const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    if (
      !supabaseUrl ||
      !serviceKey ||
      !vapidSubject ||
      !vapidPublic ||
      !vapidPrivate
    )
      return json({ error: "server_not_configured" }, 503);

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    try {
      const result = await dispatchPendingNotifications({
        claimEnvelopes: async (limit) => {
          const { data, error } = await admin.rpc(
            "claim_notification_envelopes",
            { p_limit: limit },
          );
          if (error) throw error;
          return data ?? [];
        },
        listSubscriptions: async (userId) => {
          const { data, error } = await admin
            .from("push_subscriptions")
            .select("id, endpoint, p256dh, auth")
            .eq("user_id", userId);
          if (error) throw error;
          return data ?? [];
        },
        sendNotification: async (subscription, payload, ttl) => {
          await webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: { p256dh: subscription.p256dh, auth: subscription.auth },
            },
            payload,
            { TTL: ttl },
          );
        },
        removeSubscription: async (subscriptionId) => {
          const { error } = await admin
            .from("push_subscriptions")
            .delete()
            .eq("id", subscriptionId);
          if (error) throw error;
        },
        updateEnvelope: async (envelopeId, patch) => {
          const { error } = await admin
            .from("notification_envelopes")
            .update(patch)
            .eq("id", envelopeId);
          if (error) throw error;
        },
      });
      return json(result);
    } catch {
      return json({ error: "dispatch_failed" }, 500);
    }
  }),
);
