import { describe, expect, it } from "vitest";
import {
  describeShareStats,
  summarizeOutboundVideo,
  type OutboundSample,
} from "./screenShareStats";

const base = (over: Partial<OutboundSample> = {}): OutboundSample => ({
  type: "outbound-rtp",
  kind: "video",
  id: "out",
  codecId: "c",
  timestamp: 0,
  bytesSent: 0,
  packetsSent: 0,
  framesSent: 0,
  framesEncoded: 0,
  frameWidth: 1280,
  frameHeight: 720,
  totalEncodeTime: 0,
  qualityLimitationReason: "none",
  ...over,
});
const codec = {
  type: "codec",
  id: "c",
  mimeType: "video/VP8",
} as OutboundSample;

describe("summarizeOutboundVideo", () => {
  it("mede quadros e bits entre duas leituras, não numa só", () => {
    // Uma leitura sozinha só tem contadores acumulados; taxa é diferença.
    const antes = [base(), codec];
    const agora = [
      base({
        timestamp: 1000,
        bytesSent: 275_000, // 2,2 Mb/s durante um segundo
        framesSent: 60,
        framesEncoded: 60,
        totalEncodeTime: 0.36,
        packetsSent: 200,
      }),
      codec,
    ];
    const stats = summarizeOutboundVideo(agora, antes)!;
    expect(stats.fps).toBe(60);
    expect(stats.kbps).toBe(2200);
    expect(stats.width).toBe(1280);
    expect(stats.height).toBe(720);
    expect(stats.codec).toBe("VP8");
    // 360 ms de encoder para 60 quadros: 6 ms por quadro, cabe em 60 fps.
    expect(stats.encodeMsPerFrame).toBe(6);
  });

  it("separa engasgo de CPU de engasgo de banda", () => {
    // As duas causas se parecem na tela e pedem correções opostas: baixar o
    // bitrate não faz nada quando o gargalo é o encoder.
    const cpu = summarizeOutboundVideo(
      [base({ timestamp: 1000, qualityLimitationReason: "cpu" }), codec],
      [base()],
    )!;
    const banda = summarizeOutboundVideo(
      [base({ timestamp: 1000, qualityLimitationReason: "bandwidth" }), codec],
      [base()],
    )!;
    expect(cpu.limitedBy).toBe("cpu");
    expect(banda.limitedBy).toBe("bandwidth");
    expect(describeShareStats(cpu)).toContain("limitado por CPU");
    expect(describeShareStats(banda)).toContain("limitado por banda");
  });

  it("mostra a resolução real, e não a pedida", () => {
    // Um 1080p60 que o encoder derrubou para 1280×720 é indistinguível de um
    // 720p60 sem este par escrito junto dos quadros.
    const stats = summarizeOutboundVideo(
      [
        base({
          timestamp: 1000,
          frameWidth: 1280,
          frameHeight: 720,
          framesSent: 60,
          qualityLimitationReason: "bandwidth",
        }),
        codec,
      ],
      [base({ frameWidth: 1920, frameHeight: 1080 })],
    )!;
    expect(describeShareStats(stats)).toContain("1280×720");
  });

  it("calcula perda a partir do relatório do outro lado", () => {
    const antes = [
      base(),
      { type: "remote-inbound-rtp", kind: "video", packetsLost: 0 },
    ] as OutboundSample[];
    const agora = [
      base({ timestamp: 1000, packetsSent: 1000 }),
      {
        type: "remote-inbound-rtp",
        kind: "video",
        packetsLost: 25,
        roundTripTime: 0.042,
        jitter: 0.008,
      },
      codec,
    ] as OutboundSample[];
    const stats = summarizeOutboundVideo(agora, antes)!;
    expect(stats.lostPercent).toBe(2.5);
    expect(stats.rttMs).toBe(42);
    expect(stats.jitterMs).toBe(8);
  });

  it("não inventa taxa quando falta a leitura anterior", () => {
    const stats = summarizeOutboundVideo([base(), codec], null)!;
    expect(stats.fps).toBe(0);
    expect(stats.kbps).toBe(0);
  });

  it("devolve nada quando não há vídeo saindo", () => {
    expect(
      summarizeOutboundVideo(
        [{ type: "outbound-rtp", kind: "audio" }] as OutboundSample[],
        null,
      ),
    ).toBeNull();
  });

  /**
   * Os contadores que explicam um pico.
   *
   * Um pico de bits não se explica pelo bitrate médio — ele já passou quando a
   * média fecha. O que sobra dele são os rastros: a troca de resolução que o
   * causou, o keyframe que a troca exigiu, os pacotes que não couberam e o
   * pedido de reparo que veio em seguida. Sem esses números, ajustar bitrate é
   * palpite; era assim que se estava trabalhando.
   */
  it("conta trocas de resolução, keyframes e reparos do intervalo", () => {
    const antes = [
      base({
        keyFramesEncoded: 10,
        hugeFramesSent: 2,
        qualityLimitationResolutionChanges: 3,
        nackCount: 100,
        pliCount: 5,
        firCount: 1,
        retransmittedPacketsSent: 40,
      }),
    ];
    const agora = [
      base({
        timestamp: 1000,
        packetsSent: 1000,
        keyFramesEncoded: 12,
        hugeFramesSent: 5,
        qualityLimitationResolutionChanges: 5,
        nackCount: 130,
        pliCount: 7,
        firCount: 1,
        retransmittedPacketsSent: 65,
      }),
      codec,
    ];
    const stats = summarizeOutboundVideo(agora, antes)!;
    expect(stats.keyFrames).toBe(2);
    // O pico com nome: três quadros passaram de 2,5 vezes a média no intervalo.
    expect(stats.hugeFrames).toBe(3);
    expect(stats.resolutionChanges).toBe(2);
    expect(stats.nack).toBe(30);
    expect(stats.pli).toBe(2);
    // O contador que não andou não vira ruído na linha.
    expect(stats.fir).toBe(0);
    expect(stats.retransmittedPercent).toBe(2.5);
    const linha = describeShareStats(stats);
    expect(linha).toContain("2 trocas de resolução");
    expect(linha).toContain("3 quadros enormes");
    expect(linha).toContain("NACK 30");
    expect(linha).not.toContain("FIR");
  });

  it("separa o que a captura entregou do que o encoder deu conta de mandar", () => {
    // Sessenta quadros capturados e trinta enviados é encoder; trinta
    // capturados e trinta enviados é a tela que não mudou. Sem os dois números
    // as duas situações são a mesma linha.
    const media = (over: Partial<OutboundSample>) =>
      ({ type: "media-source", kind: "video", ...over }) as OutboundSample;
    const stats = summarizeOutboundVideo(
      [
        base({ timestamp: 1000, framesSent: 30 }),
        media({ frames: 60, framesDropped: 5 }),
        codec,
      ],
      [base({ framesSent: 0 }), media({ frames: 0, framesDropped: 0 })],
    )!;
    expect(stats.captureFps).toBe(60);
    expect(stats.fps).toBe(30);
    expect(stats.droppedFps).toBe(5);
    expect(describeShareStats(stats)).toContain("captura 60 fps");
  });

  /**
   * Um fallback do encoder de hardware para a CPU é a causa que nenhuma outra
   * medida revela: o tempo de codificação sobe, os quadros atrasam, a fila
   * cresce e o sintoma chega como congestionamento de rede. Registrar qual
   * encoder está rodando é a diferença entre achar isso e mexer no bitrate à
   * toa.
   */
  it("registra qual encoder está rodando e se ele é o de hardware", () => {
    const stats = summarizeOutboundVideo(
      [
        base({
          timestamp: 1000,
          encoderImplementation: "libvpx",
          powerEfficientEncoder: false,
          targetBitrate: 2_200_000,
        }),
        {
          type: "candidate-pair",
          availableOutgoingBitrate: 3_100_000,
        } as OutboundSample,
        codec,
      ],
      [base()],
    )!;
    expect(stats.encoder).toBe("libvpx");
    expect(stats.hardwareEncoder).toBe(false);
    expect(stats.targetKbps).toBe(2200);
    expect(stats.availableKbps).toBe(3100);
    expect(describeShareStats(stats)).toContain("libvpx (CPU)");
  });

  it("não afirma nada sobre o encoder quando o navegador não conta", () => {
    // O Chromium só expõe esses dois campos com alguma permissão de mídia
    // concedida. Inventar "CPU" na ausência deles seria pior que o traço.
    const stats = summarizeOutboundVideo(
      [base({ timestamp: 1000 }), codec],
      [base()],
    )!;
    expect(stats.encoder).toBeNull();
    expect(stats.hardwareEncoder).toBeNull();
    expect(stats.availableKbps).toBeNull();
    expect(describeShareStats(stats)).not.toContain("CPU");
  });
});
