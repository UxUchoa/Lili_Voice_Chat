import { randomBytes, randomUUID } from "node:crypto";
import {
  AudioFrame,
  AudioSource,
  AudioStream,
  ContinualGatheringPolicy,
  IceTransportType,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

const url = process.env.LIVEKIT_URL ?? "ws://127.0.0.1:7880";
const apiKey = process.env.LIVEKIT_API_KEY ?? "lili_local_key";
const apiSecret =
  process.env.LIVEKIT_API_SECRET ??
  "lili_local_secret_change_before_any_remote_deployment";
const forceTurn = process.env.LILI_FORCE_TURN !== "false";
const roomName = `lili-e2ee-${randomUUID()}`;
const sharedKey = randomBytes(32);

const timeout = (promise, milliseconds, label) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} excedeu ${milliseconds} ms`)),
        milliseconds,
      ),
    ),
  ]);

const tokenFor = async (identity) => {
  const token = new AccessToken(apiKey, apiSecret, {
    identity,
    name: identity,
    ttl: "10m",
  });
  token.addGrant({
    room: roomName,
    roomJoin: true,
    roomCreate: true,
    canPublish: true,
    canSubscribe: true,
  });
  return token.toJwt();
};

const roomOptions = {
  autoSubscribe: true,
  dynacast: false,
  encryption: {
    keyProviderOptions: {
      sharedKey,
      ratchetWindowSize: 16,
    },
  },
  ...(forceTurn
    ? {
        rtcConfig: {
          iceTransportType: IceTransportType.TRANSPORT_RELAY,
          continualGatheringPolicy: ContinualGatheringPolicy.GATHER_CONTINUALLY,
          iceServers: [],
        },
      }
    : {}),
};

const publisher = new Room();
const subscriber = new Room();
let source;
let stream;
let reader;

try {
  const startedAt = performance.now();
  await Promise.all([
    publisher.connect(url, await tokenFor("publisher"), roomOptions),
    subscriber.connect(url, await tokenFor("subscriber"), roomOptions),
  ]);

  await timeout(
    new Promise((resolve) => {
      const ready = () => {
        if (
          publisher.remoteParticipants.has("subscriber") &&
          subscriber.remoteParticipants.has("publisher")
        )
          resolve();
      };
      ready();
      publisher.on(RoomEvent.ParticipantConnected, ready);
      subscriber.on(RoomEvent.ParticipantConnected, ready);
    }),
    10_000,
    "visibilidade entre participantes",
  );

  const subscribed = timeout(
    new Promise((resolve) =>
      subscriber.on(
        RoomEvent.TrackSubscribed,
        (track, _publication, participant) => {
          if (participant.identity === "publisher") resolve(track);
        },
      ),
    ),
    15_000,
    "assinatura da faixa E2EE",
  );

  const sampleRate = 48_000;
  const samplesPerFrame = 480;
  source = new AudioSource(sampleRate, 1);
  const track = LocalAudioTrack.createAudioTrack(
    "lili-synthetic-tone",
    source,
  );
  const publishOptions = new TrackPublishOptions();
  publishOptions.source = TrackSource.SOURCE_MICROPHONE;
  await publisher.localParticipant.publishTrack(track, publishOptions);

  const remoteTrack = await subscribed;
  stream = new AudioStream(remoteTrack, { sampleRate, numChannels: 1 });
  reader = stream.getReader();

  let publishing = true;
  const publishFrames = (async () => {
    let offset = 0;
    while (publishing) {
      const frame = AudioFrame.create(sampleRate, 1, samplesPerFrame);
      for (let index = 0; index < samplesPerFrame; index++) {
        frame.data[index] = Math.round(
          20_000 * Math.sin((2 * Math.PI * 440 * offset++) / sampleRate),
        );
      }
      await source.captureFrame(frame);
    }
  })();

  let peak = 0;
  try {
    await timeout(
      (async () => {
        for (let frameNumber = 0; frameNumber < 150; frameNumber++) {
          const { done, value } = await reader.read();
          if (done)
            throw new Error("faixa de áudio terminou antes de receber mídia");
          for (const sample of value.data)
            peak = Math.max(peak, Math.abs(sample));
          if (peak > 5_000) return;
        }
        throw new Error(`áudio E2EE permaneceu silencioso (pico ${peak})`);
      })(),
      20_000,
      "recepção do áudio E2EE",
    );
  } finally {
    publishing = false;
    await publishFrames.catch(() => undefined);
  }

  const stats = await publisher.getRtcStats();
  const candidateTypes = [...stats.publisherStats, ...stats.subscriberStats]
    .filter((entry) => entry.stats.case === "localCandidate")
    .map((entry) => entry.stats.value.candidate?.candidateType)
    .filter((value) => value !== undefined);
  if (forceTurn && !candidateTypes.includes(3))
    throw new Error(
      `TURN forçado sem candidato relay; tipos observados: ${candidateTypes.join(",")}`,
    );

  console.log(
    JSON.stringify({
      ok: true,
      room: roomName,
      participants: 2,
      media: "synthetic-audio",
      e2ee: true,
      forceTurn,
      relayCandidate: candidateTypes.includes(3),
      peak,
      connectedInMs: Math.round(performance.now() - startedAt),
    }),
  );
} finally {
  await reader?.cancel().catch(() => undefined);
  await source?.close().catch(() => undefined);
  await Promise.all([
    publisher.disconnect().catch(() => undefined),
    subscriber.disconnect().catch(() => undefined),
  ]);
  await dispose();
}
