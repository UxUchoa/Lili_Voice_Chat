import { describe, expect, it } from "vitest";
import { screenShareBitrate, screenTrackConstraints } from "./screenShare";

describe("screenTrackConstraints", () => {
  it("pede 16:9 na altura escolhida", () => {
    expect(screenTrackConstraints({ resolution: 720, frameRate: 30 })).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 },
    });
  });

  it("acompanha a taxa de quadros escolhida", () => {
    const constraints = screenTrackConstraints({
      resolution: 1080,
      frameRate: 60,
    });
    expect(constraints.height).toEqual({ ideal: 1080 });
    expect(constraints.frameRate).toEqual({ ideal: 60 });
  });

  it("pede, não exige", () => {
    // Uma janela menor que o alvo não tem como crescer. Com `exact` a captura
    // falharia em vez de entregar o tamanho que a fonte tem.
    const constraints = screenTrackConstraints({
      resolution: 1080,
      frameRate: 30,
    });
    expect(JSON.stringify(constraints)).not.toContain("exact");
  });
});

describe("screenShareBitrate", () => {
  it("dá mais bits para mais pixels", () => {
    expect(
      screenShareBitrate({ resolution: 1080, frameRate: 30 }),
    ).toBeGreaterThan(screenShareBitrate({ resolution: 720, frameRate: 30 }));
  });

  it("dá mais bits para mais quadros, e menos para menos", () => {
    const base = screenShareBitrate({ resolution: 1080, frameRate: 30 });
    expect(screenShareBitrate({ resolution: 1080, frameRate: 60 })).toBeGreaterThan(base);
    expect(screenShareBitrate({ resolution: 1080, frameRate: 15 })).toBeLessThan(base);
  });

  it("muda de valor quando a qualidade muda", () => {
    // O menu de qualidade reaplica este orçamento no `sender` da transmissão em
    // curso. Um valor que não acompanhasse a escolha deixaria o ajuste sem
    // efeito, que era o sintoma relatado.
    const valores = new Set(
      [15, 30, 60].map((frameRate) =>
        screenShareBitrate({ resolution: 1080, frameRate }),
      ),
    );
    expect(valores.size).toBe(3);
  });
});
