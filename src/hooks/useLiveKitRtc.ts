import { useCallback, useEffect, useRef, useState } from "react";
import {
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";
import { ensureDevice } from "../services/online/messages";
import { setOnlineVoiceMediaState } from "../services/online/calls";
import { CAMERA_MODES, cameraMode } from "./cameraModes";
import { supabase } from "../services/online/client";
import { onlineConfig } from "../services/online/config";
import { playSound } from "../services/sounds";
import { useAppStore } from "../store/appStore";

export interface RemotePeer {
  peerId: string;
  displayName: string;
  stream: MediaStream;
  screenStream: MediaStream;
  /** Câmera publicada e não silenciada. */
  hasCamera: boolean;
  /** Compartilhamento de tela ativo. */
  hasScreen: boolean;
  /** Microfone ausente ou silenciado. */
  micMuted: boolean;
  speaking: boolean;
  state: RTCPeerConnectionState;
}

export type RtcConnectionState =
  | "idle"
  | "preparing"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

interface TokenResponse {
  server_url: string;
  participant_token: string;
  call_session_id: string;
  e2ee_epoch: number;
}

const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

function rtcErrorMessage(caught: unknown) {
  const message =
    caught instanceof Error
      ? caught.message
      : typeof caught === "object" &&
          caught !== null &&
          "message" in caught &&
          typeof caught.message === "string"
        ? caught.message
        : "Não foi possível conectar à sala LiveKit.";
  return message === "voice channel is full"
    ? "O canal de voz atingiu o limite de participantes."
    : message;
}

/**
 * Orçamento de bits do compartilhamento de tela. Conteúdo de tela é quase
 * estático mas cheio de bordas duras (texto, UI), então precisa de mais bits
 * por pixel que uma webcam para não “derreter” nas letras.
 */
/**
 * Orçamento de bits da câmera por altura de vídeo. Os valores acompanham o que
 * plataformas de vídeo usam para conteúdo com movimento: abaixo disso o
 * encoder prefere derrubar a resolução a manter a nitidez.
 */

function screenShareBitrate({
  resolution,
  frameRate,
}: {
  resolution: number;
  frameRate: number;
}) {
  // O teto do compartilhamento é 1080p: 1440p custava dez megabits para uma
  // diferença que some num tile de meia tela, e a banda é dividida entre todos
  // os servidores da instância.
  const base = resolution >= 1080 ? 6_000_000 : 3_000_000;
  return frameRate >= 60
    ? Math.round(base * 1.7)
    : frameRate <= 15
      ? Math.round(base * 0.7)
      : base;
}

export function useLiveKitRtc(roomId: string, enabled = true) {
  const currentUserId = useAppStore((state) => state.currentUserId);
  const participantName = useAppStore((state) => {
    const profile = state.profiles.find(
      (item) => item.id === state.currentUserId,
    );
    return profile?.displayName ?? profile?.username ?? "Lili";
  });
  const roomRef = useRef<Room | null>(null);
  const leaveSessionRef = useRef<() => Promise<void>>(async () => {});
  const desiredTracksRef = useRef(
    new Map<string, { track: MediaStreamTrack; source: "camera" | "screen" }>(),
  );
  // Serializa publicação/despublicação: chamadas concorrentes (reconexão +
  // toggle do usuário) corrompiam o conjunto publicado.
  const publishQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [remotePeers, setRemotePeers] = useState<RemotePeer[]>([]);
  const [speakingIds, setSpeakingIds] = useState<string[]>([]);
  const [connectionState, setConnectionState] =
    useState<RtcConnectionState>("idle");
  const [connectionError, setConnectionError] = useState("");

  // Sessão e dispositivo desta chamada, para publicar o que está no ar. Vive
  // num ref porque quem precisa disso é `publishDesiredTracks`, que roda fora
  // do escopo da conexão.
  const voiceIdentityRef = useRef<{
    sessionId: string;
    deviceId: string;
  } | null>(null);
  const screenQualityRef = useRef({ resolution: 1080, frameRate: 30 });
  const cameraQualityRef = useRef(1080);
  const publishDesiredTracks = useCallback((room: Room) => {
    const run = async () => {
      const desired = desiredTracksRef.current;
      const currentPublications = [
        ...room.localParticipant.trackPublications.values(),
      ];
      for (const publication of currentPublications) {
        const track = publication.track?.mediaStreamTrack;
        if (track && !desired.has(track.id))
          await room.localParticipant.unpublishTrack(track, false);
      }
      const published = new Set(
        [...room.localParticipant.trackPublications.values()]
          .map((publication) => publication.track?.mediaStreamTrack?.id)
          .filter(Boolean),
      );
      for (const { track, source } of desired.values()) {
        if (published.has(track.id)) continue;
        await room.localParticipant.publishTrack(track, {
          source:
            source === "screen"
              ? track.kind === "audio"
                ? Track.Source.ScreenShareAudio
                : Track.Source.ScreenShare
              : track.kind === "audio"
                ? Track.Source.Microphone
                : Track.Source.Camera,
          ...(track.kind === "video"
            ? source === "screen"
              ? {
                  // Conteúdo de tela precisa de nitidez: mantemos a resolução e
                  // deixamos a taxa de quadros ceder quando a banda aperta.
                  videoEncoding: {
                    maxBitrate: screenShareBitrate(screenQualityRef.current),
                    maxFramerate: screenQualityRef.current.frameRate,
                    priority: "high",
                  },
                  degradationPreference: "maintain-resolution",
                  simulcast: false,
                  contentHint: "detail",
                }
              : {
                  // A câmera é publicada com o orçamento de bits da resolução
                  // escolhida. Sem isso o encoder recebia 1080p e só 3 Mbps
                  // para todas as camadas, e derrubava a resolução na primeira
                  // cena com movimento — a imagem "borrada" que o usuário via.
                  videoEncoding: {
                    maxBitrate: cameraMode(cameraQualityRef.current).bitrate,
                    maxFramerate: cameraMode(cameraQualityRef.current)
                      .frameRate,
                    priority: "high",
                  },
                  degradationPreference: "maintain-resolution",
                  simulcast: true,
                  videoSimulcastLayers: [VideoPresets.h540],
                  contentHint: "motion",
                }
            : {}),
        });
      }

      // A barra lateral precisa saber quem está com câmera ou transmitindo
      // sem entrar no canal, e o LiveKit só conta o que acontece na sala em
      // que este cliente está. Por isso o estado sobe para o banco.
      const identity = voiceIdentityRef.current;
      if (identity) {
        const sources = [...desiredTracksRef.current.values()].map(
          (entry) => entry.source,
        );
        await setOnlineVoiceMediaState({
          ...identity,
          cameraOn: sources.includes("camera"),
          screenOn: sources.includes("screen"),
        });
      }
    };
    const next = publishQueueRef.current.then(run, run);
    publishQueueRef.current = next.catch(() => undefined);
    return next;
  }, []);

  useEffect(() => {
    if (!enabled || !roomId || !currentUserId) {
      setConnectionState("idle");
      return;
    }
    let disposed = false;
    let room: Room | undefined;
    let heartbeatTimer: number | undefined;
    let callSessionId: string | undefined;
    let markedLeft = false;
    let leaving: Promise<void> | undefined;
    // Quem já foi anunciado nesta sessão. O som de entrada e o de saída
    // pertencem a uma transição real de presença: reconexão, renegociação de
    // track ou um segundo evento do mesmo participante não podem tocá-los.
    const announced = new Set<string>();
    let presenceSoundsMuted = true;
    const isDisposed = () => disposed;
    const markLeft = async () => {
      if (!callSessionId || markedLeft) return;
      if (leaving) return leaving;
      leaving = (async () => {
        const { error } = await supabase.rpc("leave_call_session", {
          p_session_id: callSessionId,
          p_device_id: engineDeviceId,
        });
        if (error) throw error;
        markedLeft = true;
      })().finally(() => {
        leaving = undefined;
      });
      return leaving;
    };
    let engineDeviceId = "";
    leaveSessionRef.current = markLeft;

    setConnectionState("preparing");
    setConnectionError("");
    setRemotePeers([]);
    setSpeakingIds([]);

    void (async () => {
      const deviceId = await ensureDevice(currentUserId);
      engineDeviceId = deviceId;
      if (disposed) return;
      room = new Room({
        // adaptiveStream só sabe dimensionar a camada recebida quando os
        // elementos <video> são registrados via track.attach(). Esta interface
        // monta os MediaStream manualmente, então o adaptive ficava cego e
        // travava a recepção na camada mais baixa (180p num tile de 500px).
        // Com ele desligado, o assinante recebe a camada cheia e o dynacast
        // continua evitando enviar camadas que ninguém consome.
        adaptiveStream: false,
        dynacast: true,
        // Sem isto o tratamento fica por conta do padrão do navegador, que
        // varia entre eles e some por completo em alguns caminhos de captura.
        // Ventilador, teclado e o eco de quem está sem fone são o barulho
        // normal de uma chamada, e o navegador já sabe removê-los quando lhe
        // pedem explicitamente.
        audioCaptureDefaults: {
          noiseSuppression: true,
          echoCancellation: true,
          autoGainControl: true,
        },
        // O aplicativo captura por conta própria com `getUserMedia` e publica
        // o MediaStream pronto; este padrão só valeria se o LiveKit abrisse a
        // câmera sozinho. Mantido no preset alto de propósito: restringi-lo
        // aqui não impõe teto nenhum e já mascarou um problema de captura.
        videoCaptureDefaults: {
          resolution: VideoPresets.h1080.resolution,
        },
        publishDefaults: {
          simulcast: true,
          // Escada 540p/1080p: o piso precisa ser alto o bastante para nunca
          // parecer borrado num tile grande, e a camada cheia entrega o 1080p.
          // Os valores reais são definidos por track em publishDesiredTracks.
          videoSimulcastLayers: [VideoPresets.h540],
          videoEncoding: {
            maxBitrate: CAMERA_MODES[720].bitrate,
            maxFramerate: CAMERA_MODES[720].frameRate,
          },
          degradationPreference: "maintain-resolution",
          dtx: true,
          red: true,
        },
      });
      const syncParticipant = (
        participant: RemoteParticipant,
        excludedTrackId?: string,
      ) => {
        const primaryTracks: MediaStreamTrack[] = [];
        const screenTracks: MediaStreamTrack[] = [];
        let hasCamera = false;
        let hasScreen = false;
        let micMuted = true;
        for (const publication of participant.trackPublications.values()) {
          const track = publication.track?.mediaStreamTrack;
          // A track que acabou de ser cancelada ainda aparece na publicação por
          // um instante; ignorá-la desde já evita que o tile de tela (ou de
          // câmera) continue visível depois de o remetente parar de publicar.
          const gone = !track || track.id === excludedTrackId;
          if (publication.source === Track.Source.Camera)
            hasCamera = !gone && !publication.isMuted;
          if (publication.source === Track.Source.ScreenShare)
            hasScreen = !gone && !publication.isMuted;
          if (publication.source === Track.Source.Microphone)
            micMuted = gone || publication.isMuted;
          if (gone) continue;
          if (
            publication.source === Track.Source.ScreenShare ||
            publication.source === Track.Source.ScreenShareAudio
          )
            screenTracks.push(track);
          else primaryTracks.push(track);
        }
        const stream = new MediaStream(primaryTracks);
        const screenStream = new MediaStream(screenTracks);
        setRemotePeers((current) => {
          const peer: RemotePeer = {
            peerId: participant.identity,
            displayName: participant.name || participant.identity,
            stream,
            screenStream,
            hasCamera,
            hasScreen,
            micMuted,
            speaking: participant.isSpeaking,
            state: "connected",
          };
          return [
            ...current.filter((item) => item.peerId !== participant.identity),
            peer,
          ].sort((left, right) => left.peerId.localeCompare(right.peerId));
        });
      };
      const onTrackSubscribed = (
        _track: RemoteTrack,
        _publication: unknown,
        participant: RemoteParticipant,
      ) => syncParticipant(participant);
      const onTrackUnsubscribed = (
        track: RemoteTrack,
        _publication: unknown,
        participant: RemoteParticipant,
      ) => syncParticipant(participant, track.mediaStreamTrack.id);
      const onTrackMuteChanged = (
        _publication: unknown,
        participant: Participant,
      ) => {
        if (participant.identity !== currentUserId)
          syncParticipant(participant as RemoteParticipant);
      };
      room.on(RoomEvent.ParticipantConnected, (participant) => {
        if (!announced.has(participant.identity)) {
          announced.add(participant.identity);
          if (!presenceSoundsMuted) playSound("join");
        }
        syncParticipant(participant);
      });
      room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
      room.on(RoomEvent.TrackUnsubscribed, onTrackUnsubscribed);
      // TrackUnpublished é o evento que chega quando o remetente para de
      // compartilhar a tela ou desliga a câmera; sem ele o tile ficava preso.
      room.on(RoomEvent.TrackUnpublished, (publication, participant) =>
        syncParticipant(
          participant,
          publication.track?.mediaStreamTrack.id ?? publication.trackSid,
        ),
      );
      room.on(RoomEvent.TrackPublished, (_publication, participant) =>
        syncParticipant(participant),
      );
      room.on(RoomEvent.TrackMuted, onTrackMuteChanged);
      room.on(RoomEvent.TrackUnmuted, onTrackMuteChanged);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (disposed) return;
        const ids = speakers.map((speaker) => speaker.identity);
        setSpeakingIds(ids);
        setRemotePeers((current) =>
          current.map((peer) => ({
            ...peer,
            speaking: ids.includes(peer.peerId),
          })),
        );
      });
      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (announced.delete(participant.identity) && !presenceSoundsMuted)
          playSound("leave");
        setRemotePeers((current) =>
          current.filter((peer) => peer.peerId !== participant.identity),
        );
      });
      room.on(RoomEvent.Reconnecting, () => {
        // Durante a reconexão o SDK reemite presença; silenciamos até a lista
        // ser resincronizada para ninguém "entrar de novo" nos ouvidos.
        presenceSoundsMuted = true;
        if (!disposed) setConnectionState("reconnecting");
      });
      room.on(RoomEvent.Reconnected, () => {
        announced.clear();
        room?.remoteParticipants.forEach((participant) =>
          announced.add(participant.identity),
        );
        presenceSoundsMuted = false;
        if (!disposed) {
          setConnectionState("connected");
          void publishDesiredTracks(room!).catch((caught) => {
            if (!disposed)
              setConnectionError(
                `Reconectado, mas a mídia local não foi republicada: ${rtcErrorMessage(caught)}`,
              );
          });
        }
      });
      room.on(RoomEvent.Disconnected, () => {
        void markLeft().catch(console.error);
        if (!disposed) setConnectionState("disconnected");
      });

      const { data, error } = await supabase.functions.invoke<TokenResponse>(
        "livekit-token",
        {
          body: {
            channel_id: roomId,
            participant_name: participantName,
          },
        },
      );
      if (error) throw error;
      if (!data?.server_url || !data.participant_token || !data.call_session_id)
        throw new Error("Resposta de token LiveKit inválida.");
      callSessionId = data.call_session_id;
      if (disposed) return;
      setConnectionState("connecting");
      roomRef.current = room;
      await room.connect(data.server_url, data.participant_token, {
        autoSubscribe: true,
        rtcConfig: onlineConfig.forceTurn
          ? { iceTransportPolicy: "relay" }
          : undefined,
      });
      if (disposed) return;
      const { error: historyError } = await supabase.rpc("join_call_session", {
        p_session_id: callSessionId,
        p_device_id: deviceId,
      });
      if (historyError) throw historyError;
      voiceIdentityRef.current = {
        sessionId: callSessionId,
        deviceId,
      };
      const heartbeat = async () => {
        const { error: heartbeatError } = await supabase.rpc(
          "heartbeat_call_session",
          {
            p_session_id: callSessionId,
            p_device_id: deviceId,
          },
        );
        if (heartbeatError) throw heartbeatError;
      };
      heartbeatTimer = window.setInterval(
        () =>
          void heartbeat().catch((caught) => {
            if (!disposed)
              setConnectionError(
                `Falha ao confirmar presença na chamada: ${rtcErrorMessage(caught)}`,
              );
          }),
        10_000,
      );
      room.remoteParticipants.forEach((participant) => {
        // Quem já estava na sala não "entrou agora": entra na lista sem som.
        announced.add(participant.identity);
        syncParticipant(participant);
      });
      await publishDesiredTracks(room);
      setConnectionState("connected");
      playSound("self-join");
      presenceSoundsMuted = false;

    })().catch(async (caught) => {
      if (disposed) return;
      console.error("Falha ao conectar à sala do LiveKit", caught);
      await room?.disconnect();
      if (disposed) return;
      const message = rtcErrorMessage(caught);
      setConnectionError(message);
      setConnectionState("error");
    });
    return () => {
      disposed = true;
      // Sem isto, uma publicação em voo depois da saída tentaria carimbar o
      // estado numa sessão que já acabou.
      voiceIdentityRef.current = null;
      void markLeft().catch(console.error);
      if (heartbeatTimer !== undefined) window.clearInterval(heartbeatTimer);
      roomRef.current = null;
      room?.disconnect();
      setRemotePeers([]);
      setSpeakingIds([]);
    };
  }, [currentUserId, enabled, participantName, publishDesiredTracks, roomId]);

  const setScreenQuality = useCallback(
    (quality: { resolution: number; frameRate: number }) => {
      screenQualityRef.current = quality;
    },
    [],
  );

  const setCameraQuality = useCallback((resolution: number) => {
    cameraQualityRef.current = resolution;
  }, []);

  const publishStreams = useCallback(
    (
      streams: Array<{
        stream: MediaStream;
        source: "camera" | "screen";
      }>,
    ) => {
      desiredTracksRef.current = new Map(
        streams.flatMap(({ stream, source }) =>
          stream
            .getTracks()
            .map((track) => [track.id, { track, source }] as const),
        ),
      );
      const room = roomRef.current;
      if (!room) return;
      void publishDesiredTracks(room).catch((caught) => {
        console.error("Falha ao publicar mídia local", caught);
        setConnectionError(
          caught instanceof Error ? caught.message : "Falha ao publicar mídia.",
        );
      });
    },
    [publishDesiredTracks],
  );

  // Propaga silenciar/ativar aos remotos via sinalização LiveKit — sem isto o
  // outro lado nunca sabe que o microfone ou a câmera foram desligados.
  const setLocalTrackMuted = useCallback(
    async (source: "mic" | "camera", muted: boolean) => {
      const room = roomRef.current;
      if (!room) return;
      const publications = [
        ...room.localParticipant.trackPublications.values(),
      ];
      for (const publication of publications) {
        const matches =
          (source === "mic" &&
            publication.source === Track.Source.Microphone) ||
          (source === "camera" && publication.source === Track.Source.Camera);
        if (!matches) continue;
        if (muted) await publication.mute();
        else await publication.unmute();
      }
    },
    [],
  );

  const leaveRoom = useCallback(async () => {
    if (!roomRef.current) return;
    playSound("self-leave");
    await leaveSessionRef.current();
    roomRef.current?.disconnect();
  }, []);

  return {
    peerId: currentUserId,
    remotePeers,
    speakingIds,
    publishStreams,
    setScreenQuality,
    setCameraQuality,
    setLocalTrackMuted,
    connectionState,
    connectionError,
    leaveRoom,
  };
}
