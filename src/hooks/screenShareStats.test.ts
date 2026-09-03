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
});
