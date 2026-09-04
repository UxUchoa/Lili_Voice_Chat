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
  /**
   * Retransmissão e pedidos de reparo. Sobem juntos quando um pico de bitrate
   * não coube: o receptor perde pacote, pede de volta (NACK) e, quando isso não
   * basta, pede um quadro inteiro (PLI/FIR) — que é o pico seguinte.
   */
  retransmittedPacketsSent?: number;
  nackCount?: number;
  pliCount?: number;
  firCount?: number;
  keyFramesEncoded?: number;
  /**
   * Quadros que saíram muito maiores que a média — o WebRTC conta como
   * "enorme" o que passa de 2,5 vezes o tamanho médio.
   *
   * É a definição exata do pico que se estava procurando. Medido nesta versão,
   * 1080p60 com teto de 3,5 Mb/s, dois clientes de verdade no LiveKit local:
   *
   *     cena sempre em movimento   média 3490 · pico 3657 kb/s   (1,0×)
   *     cena sempre parada         média 2365 · pico 3813 kb/s   (1,6×)
   *     cena alternando as duas    média 3302 · pico 5696 kb/s   (1,7×)
   *
   * Com conteúdo constante o teto é respeitado quase exatamente. O pico só
   * aparece na **transição** — e aparece sem nenhum keyframe, sem
   * retransmissão, sem troca de resolução e sem limitação de banda. Não é o
   * codec, não é a estimativa de banda, não é a CPU: é o controlador de taxa
   * gastando à vontade no primeiro quadro depois de a tela mudar inteira.
   */
  hugeFramesSent?: number;
  /** Quantas vezes o encoder trocou de resolução. Cada troca custa um keyframe. */
  qualityLimitationResolutionChanges?: number;
  /** Segundos acumulados em cada motivo de limitação. */
  qualityLimitationDurations?: Record<string, number>;
  /** O alvo do controlador de taxa agora, em bits por segundo. */
  targetBitrate?: number;
  /**
   * Qual encoder saiu escolhido, e se ele é o de hardware.
   *
   * O Chromium só expõe os dois depois de alguma permissão de mídia concedida;
   * numa chamada de voz isso já aconteceu. Um fallback inesperado para software
   * aparece aqui antes de aparecer como engasgo.
   *
   * Uma expectativa a calibrar antes de chamar de defeito: o codec negociado é
   * VP8, e VP8 **não tem encoder de hardware** em placa nenhuma no Windows —
   * NVENC, Quick Sync e AMF fazem H.264, HEVC e AV1, não VP8. Então
   * `powerEfficientEncoder: false` aqui é o esperado, e não sinal de que a
   * aceleração caiu. O que importa medir é o `encodeMsPerFrame` que vem junto:
   * acima de ~16 ms não cabem 60 quadros, e aí sim há um problema.
   */
  encoderImplementation?: string;
  powerEfficientEncoder?: boolean;
  /** Vem do par `remote-inbound-rtp`. */
  packetsLost?: number;
  roundTripTime?: number;
  jitter?: number;
  /** Vem do `media-source`: o que a captura entregou, antes do encoder. */
  frames?: number;
  framesDropped?: number;
  /** Vem do `candidate-pair`: o teto que o controle de congestionamento estima. */
  availableOutgoingBitrate?: number;
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
  /** Quadros que a fonte entregou por segundo, antes de passar pelo encoder. */
  captureFps: number | null;
  /** Quadros que a captura descartou por segundo. */
  droppedFps: number | null;
  /** Keyframes no intervalo. Um por troca de resolução, mais os pedidos. */
  keyFrames: number;
  /**
   * Quadros "enormes" no intervalo: os que passaram de 2,5 vezes a média.
   *
   * É o pico com nome e sobrenome. Um bitrate médio bem-comportado ao lado de
   * um punhado destes é a assinatura de uma transmissão que engasga em toda
   * mudança brusca de tela — e distingue isso de falta de banda, que apareceria
   * em `limitedBy`, e de perda, que apareceria em `lostPercent`.
   */
  hugeFrames: number;
  /**
   * Trocas de resolução no intervalo.
   *
   * É o sintoma que o encoder mostra quando está caçando o ponto de operação, e
   * cada troca custa um keyframe — que é justamente um pico de bits. Um número
   * teimosamente diferente de zero é o pico se explicando sozinho.
   */
  resolutionChanges: number;
  /** Pacotes retransmitidos no intervalo, em % dos enviados. */
  retransmittedPercent: number | null;
  nack: number;
  pli: number;
  fir: number;
  /** Alvo do controlador de taxa, em kb/s. */
  targetKbps: number | null;
  /** Teto estimado pelo controle de congestionamento, em kb/s. */
  availableKbps: number | null;
  /** Qual encoder está rodando, e se é o de hardware. */
  encoder: string | null;
  hardwareEncoder: boolean | null;
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

  /**
   * Uma diferença de contador entre as duas leituras.
   *
   * Contadores acumulam desde o começo da transmissão; o total não diz nada
   * sobre agora. Dois keyframes num intervalo de dois segundos é um problema em
   * curso; dois keyframes em dez minutos é o começo da transmissão.
   */
  const delta = (field: keyof OutboundSample) => {
    const a = now[field];
    const b = before?.[field];
    return typeof a === "number" && typeof b === "number"
      ? Math.max(0, a - b)
      : 0;
  };

  // A captura vive num `media-source`: é o que a fonte entregou antes do
  // encoder. Comparar com os quadros que saíram separa "a tela não mudou" de
  // "o encoder não deu conta" — duas coisas que a tela do outro lado mostra
  // igual.
  const source = (samples?: OutboundSample[]) =>
    samples?.find(
      (sample) =>
        sample.type === "media-source" && (sample.kind ?? "video") === "video",
    );
  const mediaNow = source(current);
  const mediaBefore = source(previous ?? undefined);
  const perSecond = (a?: number, b?: number) =>
    seconds > 0 && typeof a === "number" && typeof b === "number"
      ? Math.max(0, (a - b) / seconds)
      : null;
  const captureFps = perSecond(mediaNow?.frames, mediaBefore?.frames);
  const droppedFps = perSecond(
    mediaNow?.framesDropped,
    mediaBefore?.framesDropped,
  );

  const retransmittedDelta = delta("retransmittedPacketsSent");
  const retransmittedPercent =
    sentPacketsDelta !== null && sentPacketsDelta > 0
      ? (retransmittedDelta / sentPacketsDelta) * 100
      : null;

  // O par de candidatos em uso é quem carrega a estimativa de banda. Vários
  // pares aparecem no relatório; só o nomeado pela transporte está de pé.
  const pair = current.find(
    (sample) =>
      sample.type === "candidate-pair" &&
      sample.availableOutgoingBitrate !== undefined,
  );

  const kb = (bits?: number) =>
    typeof bits === "number" ? Math.round(bits / 1000) : null;
  const round1 = (value: number) => Math.round(value * 10) / 10;

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
    captureFps: captureFps === null ? null : Math.round(captureFps),
    droppedFps: droppedFps === null ? null : round1(droppedFps),
    keyFrames: delta("keyFramesEncoded"),
    hugeFrames: delta("hugeFramesSent"),
    resolutionChanges: delta("qualityLimitationResolutionChanges"),
    retransmittedPercent:
      retransmittedPercent === null ? null : round1(retransmittedPercent),
    nack: delta("nackCount"),
    pli: delta("pliCount"),
    fir: delta("firCount"),
    targetKbps: kb(now.targetBitrate),
    availableKbps: kb(pair?.availableOutgoingBitrate),
    encoder: now.encoderImplementation ?? null,
    hardwareEncoder: now.powerEfficientEncoder ?? null,
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
  if (stats.encoder)
    parts.push(
      `${stats.encoder}${stats.hardwareEncoder === false ? " (CPU)" : stats.hardwareEncoder ? " (GPU)" : ""}`,
    );
  if (stats.encodeMsPerFrame !== null)
    parts.push(`${stats.encodeMsPerFrame} ms/quadro`);
  if (stats.captureFps !== null)
    parts.push(
      `captura ${stats.captureFps} fps${stats.droppedFps ? ` (−${stats.droppedFps} descartados)` : ""}`,
    );
  if (stats.targetKbps !== null) parts.push(`alvo ${stats.targetKbps} kb/s`);
  if (stats.availableKbps !== null)
    parts.push(`banda ${stats.availableKbps} kb/s`);
  // Só quando existe: uma linha com "0 keyframes · 0 trocas" a cada dois
  // segundos esconde a linha em que eles aparecem, que é a única que interessa.
  if (stats.keyFrames) parts.push(`${stats.keyFrames} keyframes`);
  if (stats.hugeFrames) parts.push(`${stats.hugeFrames} quadros enormes`);
  if (stats.resolutionChanges)
    parts.push(`${stats.resolutionChanges} trocas de resolução`);
  if (stats.lostPercent !== null) parts.push(`${stats.lostPercent}% perdidos`);
  if (stats.retransmittedPercent)
    parts.push(`${stats.retransmittedPercent}% retransmitidos`);
  if (stats.nack) parts.push(`NACK ${stats.nack}`);
  if (stats.pli) parts.push(`PLI ${stats.pli}`);
  if (stats.fir) parts.push(`FIR ${stats.fir}`);
  if (stats.rttMs !== null) parts.push(`RTT ${stats.rttMs} ms`);
  if (stats.jitterMs !== null) parts.push(`jitter ${stats.jitterMs} ms`);
  return parts.join(" · ");
}
