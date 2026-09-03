/**
 * O que a transmissão está realmente fazendo, lido do WebRTC.
 *
 * Ajustar bitrate e taxa de quadros no olho não funciona: "está engasgando"
 * descreve pelo menos quatro causas diferentes — encoder sem CPU, banda que
 * não cabe, perda de pacotes e a própria fonte entregando menos quadros do que
 * se pediu. As quatro se parecem na tela e pedem correções opostas.
 *
 * `qualityLimitationReason` é o campo que separa uma da outra, e é por isso que
 * ele existe. Quando ele diz `cpu`, baixar o bitrate não resolve nada; quando
 * diz `bandwidth`, mexer no encoder não resolve nada.
 *
 * Funções puras, sobre uma lista de entradas de estatística, para poderem ser
 * testadas sem uma sala conectada — mesmo motivo de `screenShare` e
 * `publishPlan` viverem fora de `useLiveKitRtc`.
 */

/** O punhado de campos que este módulo lê de um relatório do WebRTC. */
export interface OutboundSample {
  type: string;
  kind?: string;
  id?: string;
  codecId?: string;
  mimeType?: string;
  timestamp?: number;
  bytesSent?: number;
  packetsSent?: number;
  framesSent?: number;
  framesEncoded?: number;
  framesPerSecond?: number;
  frameWidth?: number;
  frameHeight?: number;
  totalEncodeTime?: number;
  qualityLimitationReason?: string;
  /** Vem do par `remote-inbound-rtp`. */
  packetsLost?: number;
  roundTripTime?: number;
  jitter?: number;
}

export interface ShareStats {
  width: number;
  height: number;
  /** Quadros por segundo realmente saindo do encoder. */
  fps: number;
  /** Kb/s medidos entre duas amostras, não o teto pedido. */
  kbps: number;
  /**
   * O que está segurando a qualidade: `none`, `cpu`, `bandwidth` ou `other`.
   * É o campo que decide se o problema é de encoder ou de rede.
   */
  limitedBy: string;
  /** Milissegundos de CPU por quadro codificado. Acima de ~16 ms não cabe 60. */
  encodeMsPerFrame: number | null;
  lostPercent: number | null;
  rttMs: number | null;
  jitterMs: number | null;
  codec: string;
}

const RTP = "outbound-rtp";

function outboundVideo(samples: OutboundSample[]) {
  return samples.find(
    (sample) => sample.type === RTP && (sample.kind ?? "video") === "video",
  );
}

/**
 * Compara duas leituras e devolve o que aconteceu entre elas.
 *
 * Bitrate e quadros por segundo são taxas: só existem entre duas amostras.
 * `framesPerSecond` já vem calculado pelo navegador, mas some quando o encoder
 * fica um intervalo inteiro sem produzir nada — e é exatamente aí que se quer
 * saber. Por isso a taxa é recalculada a partir de `framesSent` quando dá, e o
 * campo do navegador serve de reserva.
 *
 * Devolve `null` quando não há vídeo saindo ou quando falta a amostra anterior:
 * uma taxa inventada a partir de uma leitura só seria pior que nenhuma.
 */
export function summarizeOutboundVideo(
  current: OutboundSample[],
  previous: OutboundSample[] | null,
): ShareStats | null {
  const now = outboundVideo(current);
  if (!now) return null;
  const before = previous ? outboundVideo(previous) : undefined;
  // `!== undefined`, e não um teste de verdade: um contador vale zero no
  // começo, e zero é falso.
  const seconds =
    before?.timestamp !== undefined && now.timestamp !== undefined
      ? (now.timestamp - before.timestamp) / 1000
      : 0;

  const kbps =
    seconds > 0 &&
    now.bytesSent !== undefined &&
    before?.bytesSent !== undefined
      ? Math.max(0, ((now.bytesSent - before.bytesSent) * 8) / seconds / 1000)
      : 0;

  const sentDelta =
    seconds > 0 &&
    now.framesSent !== undefined &&
    before?.framesSent !== undefined
      ? (now.framesSent - before.framesSent) / seconds
      : null;
  const fps = sentDelta ?? now.framesPerSecond ?? 0;

  const encodedDelta =
    now.framesEncoded !== undefined && before?.framesEncoded !== undefined
      ? now.framesEncoded - before.framesEncoded
      : 0;
  const encodeDelta =
    now.totalEncodeTime !== undefined && before?.totalEncodeTime !== undefined
      ? now.totalEncodeTime - before.totalEncodeTime
      : 0;
  const encodeMsPerFrame =
    encodedDelta > 0 ? (encodeDelta / encodedDelta) * 1000 : null;

  // A perda de pacotes é relatada pelo outro lado, num `remote-inbound-rtp`.
  const remote = current.find(
    (sample) =>
      sample.type === "remote-inbound-rtp" &&
      (sample.kind ?? "video") === "video",
  );
  const remoteBefore = previous?.find(
    (sample) =>
      sample.type === "remote-inbound-rtp" &&
      (sample.kind ?? "video") === "video",
  );
  const lostDelta =
    remote?.packetsLost !== undefined && remoteBefore?.packetsLost !== undefined
      ? remote.packetsLost - remoteBefore.packetsLost
      : null;
  const sentPacketsDelta =
    now.packetsSent !== undefined && before?.packetsSent !== undefined
      ? now.packetsSent - before.packetsSent
      : null;
  const lostPercent =
    lostDelta !== null && sentPacketsDelta !== null && sentPacketsDelta > 0
      ? Math.max(0, (lostDelta / sentPacketsDelta) * 100)
      : null;

  const codecEntry = current.find(
    (sample) => sample.type === "codec" && sample.id === now.codecId,
  );

  return {
    width: now.frameWidth ?? 0,
    height: now.frameHeight ?? 0,
    fps: Math.round(fps),
    kbps: Math.round(kbps),
    limitedBy: now.qualityLimitationReason ?? "none",
    encodeMsPerFrame:
      encodeMsPerFrame === null ? null : Math.round(encodeMsPerFrame * 10) / 10,
    lostPercent:
      lostPercent === null ? null : Math.round(lostPercent * 10) / 10,
    rttMs:
      remote?.roundTripTime === undefined
        ? null
        : Math.round(remote.roundTripTime * 1000),
    jitterMs:
      remote?.jitter === undefined ? null : Math.round(remote.jitter * 1000),
    codec: codecEntry?.mimeType?.replace("video/", "") ?? "?",
  };
}

/**
 * A leitura em uma linha, para a interface e para o console.
 *
 * O formato importa: quem está diagnosticando um engasgo precisa ver a
 * resolução real ao lado dos quadros reais. Um 1080p60 que virou 1280×720 na
 * prática não se distingue de um 720p60 sem esse par escrito junto.
 */
export function describeShareStats(stats: ShareStats): string {
  const limit =
    stats.limitedBy === "none"
      ? "sem limite"
      : stats.limitedBy === "cpu"
        ? "limitado por CPU"
        : stats.limitedBy === "bandwidth"
          ? "limitado por banda"
          : `limitado (${stats.limitedBy})`;
  const parts = [
    `${stats.width}×${stats.height}`,
    `${stats.fps} fps`,
    `${stats.kbps} kb/s`,
    stats.codec,
    limit,
  ];
  if (stats.encodeMsPerFrame !== null)
    parts.push(`${stats.encodeMsPerFrame} ms/quadro`);
  if (stats.lostPercent !== null) parts.push(`${stats.lostPercent}% perdidos`);
  if (stats.rttMs !== null) parts.push(`RTT ${stats.rttMs} ms`);
  if (stats.jitterMs !== null) parts.push(`jitter ${stats.jitterMs} ms`);
  return parts.join(" · ");
}
