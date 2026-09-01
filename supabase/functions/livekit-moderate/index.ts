import { createClient } from "npm:@supabase/supabase-js@2";
import { RoomServiceClient } from "npm:livekit-server-sdk@2";
import { json, withCors } from "../_shared/cors.ts";

type Action = "mute" | "unmute" | "deafen" | "undeafen" | "disconnect" | "move";
interface ModerationRequest {
  channel_id?: string;
  target_user_id?: string;
  action?: Action;
  destination_channel_id?: string;
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
    const livekitApiUrl =
      Deno.env.get("LIVEKIT_API_URL") ??
      livekitUrl
        .replace(/^ws/, "http")
        .replace("127.0.0.1", "host.docker.internal")
        .replace("localhost", "host.docker.internal");
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

    let body: ModerationRequest;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400);
    }
    const {
      channel_id: channelId,
      target_user_id: targetId,
      action,
      destination_channel_id: destinationId,
    } = body;
    if (!channelId || !targetId || !action)
      return json({ error: "invalid_request" }, 400);

    const { data: channel, error: channelError } = await scoped
      .from("channels")
      .select("server_id,kind")
      .eq("id", channelId)
      .single();
    if (channelError || channel.kind !== "voice" || !channel.server_id)
      return json({ error: "invalid_channel" }, 400);
    const permission = ["mute", "unmute"].includes(action)
      ? 256
      : ["deafen", "undeafen"].includes(action)
        ? 512
        : 1024;
    const { data: allowed, error: permissionError } = await scoped.rpc(
      "can_moderate_member",
      {
        p_server_id: channel.server_id,
        p_target_id: targetId,
        p_permission: permission,
      },
    );
    if (permissionError || !allowed) return json({ error: "forbidden" }, 403);

    if (action === "move") {
      if (!destinationId) return json({ error: "destination_required" }, 400);
      const { data: destination } = await scoped
        .from("channels")
        .select("server_id,kind")
        .eq("id", destinationId)
        .single();
      if (
        !destination ||
        destination.server_id !== channel.server_id ||
        destination.kind !== "voice"
      )
        return json({ error: "invalid_destination" }, 400);
    }

    const { data: sourceSession, error: sourceSessionError } = await admin
      .from("call_sessions")
      .select("id,room_name")
      .eq("channel_id", channelId)
      .is("ended_at", null)
      .maybeSingle();
    if (sourceSessionError || !sourceSession)
      return json({ error: "participant_not_connected" }, 409);

    let moveRequestId: string | undefined;
    if (action === "move" && destinationId) {
      const { data: moveRequest, error: moveRequestError } = await admin
        .from("voice_move_requests")
        .insert({
          server_id: channel.server_id,
          source_channel_id: channelId,
          destination_channel_id: destinationId,
          target_user_id: targetId,
          requested_by: authData.user.id,
        })
        .select("id")
        .single();
      if (moveRequestError || !moveRequest)
        return json({ error: "move_request_failed" }, 500);
      moveRequestId = moveRequest.id;
    }

    const service = new RoomServiceClient(
      livekitApiUrl,
      livekitKey,
      livekitSecret,
    );
    const room = sourceSession.room_name;
    try {
      if (action === "disconnect") {
        await service.removeParticipant(room, targetId);
      } else if (action === "move") {
        // O cliente precisa obter um novo token para o canal de destino, e o
        // token é emitido por sala. Por isso desconectamos e deixamos o pedido
        // persistido conduzir a reconexão no cliente alvo, em vez de mover o
        // participante direto no LiveKit.
        await service.removeParticipant(room, targetId);
      } else if (action === "mute" || action === "unmute") {
        const participant = await service.getParticipant(room, targetId);
        const audioTracks = participant.tracks.filter(
          (track) => track.type === 0,
        );
        await Promise.all(
          audioTracks.map((track) =>
            service.mutePublishedTrack(
              room,
              targetId,
              track.sid,
              action === "mute",
            ),
          ),
        );
      } else {
        const participant = await service.getParticipant(room, targetId);
        await service.updateParticipant(room, targetId, {
          permission: {
            ...participant.permission,
            canSubscribe: action === "undeafen",
          },
        });
      }
    } catch (caught) {
      console.error("LiveKit moderation failed", caught);
      if (action !== "move" || !moveRequestId)
        return json({ error: "participant_not_connected" }, 409);
    }

    const { error: auditError } = await scoped.rpc("record_voice_moderation", {
      p_server_id: channel.server_id,
      p_target_id: targetId,
      p_channel_id: channelId,
      p_action: action,
      p_destination_channel_id: destinationId ?? null,
    });
    if (auditError)
      return json({ error: "audit_failed", detail: auditError.message }, 500);
    return json({ ok: true, move_request_id: moveRequestId });
  }),
);
