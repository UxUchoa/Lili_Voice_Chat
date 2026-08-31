import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2";
import { json, withCors } from "../_shared/cors.ts";

interface TokenRequest {
  channel_id?: string;
  participant_name?: string;
}

Deno.serve(
  withCors(async (request) => {
    if (request.method !== "POST")
      return json({ error: "method_not_allowed" }, 405);

    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      return json({ error: "unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const livekitUrl = Deno.env.get("LIVEKIT_URL") ?? "";
    const livekitKey = Deno.env.get("LIVEKIT_API_KEY") ?? "";
    const livekitSecret = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
    if (
      !supabaseUrl ||
      !publishableKey ||
      !serviceKey ||
      !livekitUrl ||
      !livekitKey ||
      !livekitSecret
    )
      return json({ error: "server_not_configured" }, 503);

    const scoped = createClient(supabaseUrl, publishableKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: authData, error: authError } = await scoped.auth.getUser();
    if (authError || !authData.user)
      return json({ error: "unauthorized" }, 401);

    let body: TokenRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const channelId = body.channel_id;
    if (!channelId || !/^[0-9a-f-]{36}$/i.test(channelId))
      return json({ error: "invalid_channel" }, 400);

    const { data: canConnect, error: permissionError } = await scoped.rpc(
      "has_channel_permission",
      {
        p_channel_id: channelId,
        p_permission: 32,
      },
    );
    if (permissionError || !canConnect)
      return json({ error: "forbidden" }, 403);

    const { data: channel } = await scoped
      .from("channels")
      .select("server_id")
      .eq("id", channelId)
      .single();
    const { data: membership } = channel?.server_id
      ? await scoped
          .from("server_members")
          .select("server_muted,server_deafened")
          .eq("server_id", channel.server_id)
          .eq("user_id", authData.user.id)
          .maybeSingle()
      : { data: null };

    const { data: existing } = await admin
      .from("call_sessions")
      .select("id, e2ee_epoch, room_name")
      .eq("channel_id", channelId)
      .is("ended_at", null)
      .maybeSingle();
    let callSession = existing;
    if (!existing) {
      const roomName = `channel-${channelId}-${crypto.randomUUID()}`;
      const { data: created, error } = await admin
        .from("call_sessions")
        .insert({
          channel_id: channelId,
          room_name: roomName,
          created_by: authData.user.id,
          e2ee_epoch: 1,
        })
        .select("id, e2ee_epoch, room_name")
        .single();
      if (error && error.code === "23505") {
        const { data: concurrent, error: concurrentError } = await admin
          .from("call_sessions")
          .select("id, e2ee_epoch, room_name")
          .eq("channel_id", channelId)
          .is("ended_at", null)
          .single();
        if (concurrentError) return json({ error: "call_session_failed" }, 500);
        callSession = concurrent;
      } else if (error) {
        console.error("call_session insert failed", error.code, error.message);
        return json({ error: "call_session_failed" }, 500);
      } else {
        callSession = created;
      }
    }
    if (!callSession) return json({ error: "call_session_failed" }, 500);

    const token = new AccessToken(livekitKey, livekitSecret, {
      identity: authData.user.id,
      name: String(
        body.participant_name ??
          authData.user.user_metadata?.display_name ??
          "Janja",
      ).slice(0, 64),
      ttl: "10m",
      metadata: JSON.stringify({ channel_id: channelId, e2ee: true }),
    });
    token.addGrant({
      roomJoin: true,
      room: callSession.room_name,
      canPublish: !membership?.server_muted,
      canSubscribe: !membership?.server_deafened,
      canPublishData: true,
    });
    return json({
      server_url: livekitUrl,
      participant_token: await token.toJwt(),
      room_name: callSession.room_name,
      call_session_id: callSession.id,
      e2ee_epoch: callSession.e2ee_epoch,
    });
  }),
);
