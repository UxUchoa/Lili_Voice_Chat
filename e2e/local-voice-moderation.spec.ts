import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import {
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import { RoomServiceClient } from "livekit-server-sdk";
import { expect, test } from "@playwright/test";

const status = JSON.parse(
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", "npx supabase status --output json"],
    {
      encoding: "utf8",
    },
  ),
);
const apiUrl = status.API_URL as string;
const publishableKey = (status.PUBLISHABLE_KEY ?? status.ANON_KEY) as string;
const serviceRoleKey = (status.SECRET_KEY ?? status.SERVICE_ROLE_KEY) as string;
const livekitUrl = "ws://127.0.0.1:7880";
const livekitApiKey = "janja_local_key";
const livekitApiSecret =
  "janja_local_secret_change_before_any_remote_deployment";

const unwrap = async <T>(
  promise: PromiseLike<{ data: T; error: { message: string } | null }>,
  label: string,
) => {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

async function waitFor(check: () => Promise<boolean>, message: string) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

test("moderação de voz local aplica mute e desconexão no LiveKit", async () => {
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const memberApi = createClient(apiUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const password = `Janja-${crypto.randomUUID()}-Aa1!`;
  const emails = [
    `voice-owner-${runId}@janja.local`,
    `voice-member-${runId}@janja.local`,
  ];
  const userIds: string[] = [];
  let serverId = "";
  const ownerRoom = new Room();
  const memberRoom = new Room();
  const movedMemberRoom = new Room();
  let source: AudioSource | undefined;

  try {
    for (const [index, email] of emails.entries()) {
      const created = await unwrap(
        admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: {
            username: `voice_${index}_${runId}`.replace(/\W/g, "").slice(0, 30),
            display_name: `Voice ${index}`,
          },
        }),
        "criar usuário de moderação",
      );
      userIds.push(created.user.id);
    }
    await unwrap(
      ownerApi.auth.signInWithPassword({ email: emails[0], password }),
      "login owner voz",
    );
    await unwrap(
      memberApi.auth.signInWithPassword({ email: emails[1], password }),
      "login member voz",
    );
    serverId = (await unwrap(
      ownerApi.rpc("create_server", { p_name: `Voice E2E ${runId}` }),
      "criar servidor voz",
    )) as string;
    const channels = await unwrap(
      ownerApi.from("channels").select("id,kind").eq("server_id", serverId),
      "listar canais voz",
    );
    const voiceChannel = channels.find((channel) => channel.kind === "voice");
    const textChannel = channels.find((channel) => channel.kind === "text");
    if (!voiceChannel || !textChannel)
      throw new Error("Canais iniciais ausentes.");
    const destinationChannelId = (await unwrap(
      ownerApi.rpc("create_channel", {
        p_server_id: serverId,
        p_name: "Destino",
        p_kind: "voice",
        p_parent_id: null,
      }),
      "criar destino de voz",
    )) as string;
    const invite = await unwrap(
      ownerApi.rpc("create_invite", {
        p_server_id: serverId,
        p_channel_id: textChannel.id,
        p_max_uses: 1,
        p_expires_in_minutes: 60,
      }),
      "criar convite voz",
    );
    await unwrap(
      memberApi.rpc("redeem_invite", { p_code: invite }),
      "entrar no servidor voz",
    );

    const ownerToken = await unwrap(
      ownerApi.functions.invoke("livekit-token", {
        body: { channel_id: voiceChannel.id, participant_name: "Owner" },
      }),
      "token LiveKit owner",
    );
    const memberToken = await unwrap(
      memberApi.functions.invoke("livekit-token", {
        body: { channel_id: voiceChannel.id, participant_name: "Member" },
      }),
      "token LiveKit member",
    );
    await Promise.all([
      ownerRoom.connect(ownerToken.server_url, ownerToken.participant_token),
      memberRoom.connect(memberToken.server_url, memberToken.participant_token),
    ]);

    source = new AudioSource(48_000, 1);
    const track = LocalAudioTrack.createAudioTrack("moderation-mic", source);
    const publishOptions = new TrackPublishOptions();
    publishOptions.source = TrackSource.SOURCE_MICROPHONE;
    await memberRoom.localParticipant.publishTrack(track, publishOptions);

    const service = new RoomServiceClient(
      `http://127.0.0.1:7880`,
      livekitApiKey,
      livekitApiSecret,
    );
    const roomName = ownerToken.room_name as string;
    await waitFor(async () => {
      try {
        const participant = await service.getParticipant(roomName, userIds[1]);
        return participant.tracks.length === 1;
      } catch {
        return false;
      }
    }, "A faixa do participante não chegou ao LiveKit.");

    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: voiceChannel.id,
          target_user_id: userIds[1],
          action: "mute",
        },
      }),
      "mutar participante",
    );
    await waitFor(async () => {
      const participant = await service.getParticipant(roomName, userIds[1]);
      return participant.tracks[0]?.muted === true;
    }, "O mute administrativo não foi aplicado.");
    const membership = await unwrap(
      ownerApi
        .from("server_members")
        .select("server_muted")
        .eq("server_id", serverId)
        .eq("user_id", userIds[1])
        .single(),
      "verificar mute persistido",
    );
    expect(membership.server_muted).toBe(true);

    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: voiceChannel.id,
          target_user_id: userIds[1],
          action: "deafen",
        },
      }),
      "ensurdecer participante",
    );
    await waitFor(async () => {
      const participant = await service.getParticipant(roomName, userIds[1]);
      return participant.permission?.canSubscribe === false;
    }, "O deafen administrativo não foi aplicado.");
    const deafenedMembership = await unwrap(
      ownerApi
        .from("server_members")
        .select("server_deafened")
        .eq("server_id", serverId)
        .eq("user_id", userIds[1])
        .single(),
      "verificar deafen persistido",
    );
    expect(deafenedMembership.server_deafened).toBe(true);

    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: voiceChannel.id,
          target_user_id: userIds[1],
          action: "undeafen",
        },
      }),
      "remover deafen do participante",
    );
    await waitFor(async () => {
      const participant = await service.getParticipant(roomName, userIds[1]);
      return participant.permission?.canSubscribe === true;
    }, "O undeafen administrativo não foi aplicado.");

    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: voiceChannel.id,
          target_user_id: userIds[1],
          action: "move",
          destination_channel_id: destinationChannelId,
        },
      }),
      "solicitar movimentação segura",
    );
    const moveRequests = await unwrap(
      memberApi.rpc("claim_voice_move_request"),
      "consumir movimentação segura",
    );
    expect(moveRequests).toHaveLength(1);
    expect(moveRequests[0].source_channel_id).toBe(voiceChannel.id);
    expect(moveRequests[0].destination_channel_id).toBe(destinationChannelId);
    await waitFor(async () => {
      try {
        await service.getParticipant(roomName, userIds[1]);
        return false;
      } catch {
        return true;
      }
    }, "O participante não saiu da sala de origem durante o move.");

    const destinationToken = await unwrap(
      memberApi.functions.invoke("livekit-token", {
        body: {
          channel_id: destinationChannelId,
          participant_name: "Member moved",
        },
      }),
      "token LiveKit do destino",
    );
    await movedMemberRoom.connect(
      destinationToken.server_url,
      destinationToken.participant_token,
    );
    await waitFor(async () => {
      try {
        await service.getParticipant(destinationToken.room_name, userIds[1]);
        return true;
      } catch {
        return false;
      }
    }, "O participante não entrou na sala de destino com uma nova sessão.");

    await unwrap(
      ownerApi.functions.invoke("livekit-moderate", {
        body: {
          channel_id: destinationChannelId,
          target_user_id: userIds[1],
          action: "disconnect",
        },
      }),
      "desconectar participante",
    );
    await waitFor(async () => {
      try {
        await service.getParticipant(destinationToken.room_name, userIds[1]);
        return false;
      } catch {
        return true;
      }
    }, "O participante permaneceu conectado após a moderação.");
    const audit = await unwrap(
      ownerApi
        .from("audit_logs")
        .select("action_type")
        .eq("server_id", serverId)
        .in("action_type", [
          "VOICE_MUTE",
          "VOICE_DEAFEN",
          "VOICE_UNDEAFEN",
          "VOICE_MOVE",
          "VOICE_DISCONNECT",
        ]),
      "verificar auditoria de voz",
    );
    expect(audit.map((entry) => entry.action_type).sort()).toEqual([
      "VOICE_DEAFEN",
      "VOICE_DISCONNECT",
      "VOICE_MOVE",
      "VOICE_MUTE",
      "VOICE_UNDEAFEN",
    ]);
  } finally {
    await Promise.allSettled([
      ownerRoom.disconnect(),
      memberRoom.disconnect(),
      movedMemberRoom.disconnect(),
    ]);
    await source?.close().catch(() => undefined);
    await dispose();
    if (serverId)
      await ownerApi.rpc("delete_server", { p_server_id: serverId });
    for (const userId of userIds.reverse())
      await admin.auth.admin.deleteUser(userId);
  }
});
