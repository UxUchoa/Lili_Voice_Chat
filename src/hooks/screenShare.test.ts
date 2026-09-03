import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHARE_QUALITY,
  SCREEN_CONTENT_HINT,
  SCREEN_DEGRADATION,
  SHARE_PRESETS,
  screenShareBitrate,
  screenTrackConstraints,
  sharePreset,
  screenPublishOptions,
} from "./screenShare";

describe("os modos oferecidos", () => {
  it("são exatamente os quatro combinados", () => {
    expect(
      SHARE_PRESETS.map((preset) => `${preset.resolution}p${preset.frameRate}`),
    ).toEqual(["720p30", "720p60", "1080p30", "1080p60"]);
  });

  it("não oferece 15 quadros em nenhuma forma", () => {
    // 15 não é qualidade: é o sintoma que a correção eliminou. Oferecê-lo
    // convidaria a escolher justamente o estado que o bug produzia sozinho.
    expect(
      SHARE_PRESETS.some((preset) => (preset.frameRate as number) === 15),
    ).toBe(false);
  });

  it("pede a medida exata de cada modo", () => {
    expect(screenTrackConstraints({ resolution: 720, frameRate: 60 })).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
    });
    expect(screenTrackConstraints({ resolution: 1080, frameRate: 60 })).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 60 },
    });
    expect(screenTrackConstraints({ resolution: 1080, frameRate: 30 })).toEqual({
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      frameRate: { ideal: 30 },
    });
  });

  it("pede, não exige", () => {
    // Uma janela menor que o alvo não tem como crescer; com `exact` a captura
    // falharia em vez de entregar o tamanho que a fonte tem.
    expect(
      JSON.stringify(screenTrackConstraints(DEFAULT_SHARE_QUALITY)),
    ).not.toContain("exact");
  });
});

describe("o preset padrão", () => {
  it("é 720p a 60 quadros", () => {
    expect(DEFAULT_SHARE_QUALITY).toEqual({ resolution: 720, frameRate: 60 });
  });

  it("pede 1280×720 a 60", () => {
    expect(screenTrackConstraints(DEFAULT_SHARE_QUALITY)).toEqual({
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 60 },
    });
  });

  it("tem 2,3 Mb/s como teto", () => {
    expect(screenShareBitrate(DEFAULT_SHARE_QUALITY)).toBe(2_300_000);
  });
});

describe("o orçamento de bits", () => {
  it("segue a tabela combinada com a infraestrutura", () => {
    expect(screenShareBitrate({ resolution: 720, frameRate: 30 })).toBe(1_500_000);
    expect(screenShareBitrate({ resolution: 720, frameRate: 60 })).toBe(2_300_000);
    expect(screenShareBitrate({ resolution: 1080, frameRate: 30 })).toBe(2_500_000);
    expect(screenShareBitrate({ resolution: 1080, frameRate: 60 })).toBe(4_000_000);
  });

  it("nunca chega perto dos dez megabits de antes", () => {
    // 1080p60 pedia 10,2 Mb/s. O controle de congestionamento cortava isso em
    // segundos, e o corte aparecia como queda de quadros.
    for (const preset of SHARE_PRESETS)
      expect(preset.bitrate).toBeLessThanOrEqual(4_000_000);
  });

  it("dá um valor diferente para cada modo", () => {
    const valores = new Set(SHARE_PRESETS.map((preset) => preset.bitrate));
    expect(valores.size).toBe(SHARE_PRESETS.length);
  });
});

describe("o que cede quando a rede aperta", () => {
  it("preserva a fluidez antes da resolução", () => {
    expect(SCREEN_DEGRADATION).toBe("maintain-framerate");
  });

  it("descreve o conteúdo como movimento", () => {
    // `detail` dizia ao encoder que nitidez vale mais que continuidade, e era
    // a outra metade da causa dos quinze quadros.
    expect(SCREEN_CONTENT_HINT).toBe("motion");
  });
});

describe("sharePreset", () => {
  it("cai no padrão quando a combinação não existe mais", () => {
    // Uma escolha antiga guardada em estado — 1440p, 15 quadros — não pode
    // deixar a transmissão sem teto de bits.
    const antigo = { resolution: 1440, frameRate: 15 } as never;
    expect(sharePreset(antigo)).toMatchObject({
      resolution: 720,
      frameRate: 60,
      bitrate: 2_300_000,
    });
  });
});

describe("as opções de publicação da tela", () => {
  it("usam o campo que o LiveKit lê para tela", () => {
    // O bug não era de valor, era de nome: `videoEncoding` é ignorado em
    // silêncio numa track de tela, e valia o padrão do SDK — 15 quadros.
    const options = screenPublishOptions(DEFAULT_SHARE_QUALITY);
    expect(options).toHaveProperty("screenShareEncoding");
    expect(options).not.toHaveProperty("videoEncoding");
  });

  it("levam o preset escolhido para o encoder", () => {
    expect(
      screenPublishOptions({ resolution: 720, frameRate: 60 })
        .screenShareEncoding,
    ).toMatchObject({ maxFramerate: 60, maxBitrate: 2_300_000 });
    expect(
      screenPublishOptions({ resolution: 1080, frameRate: 30 })
        .screenShareEncoding,
    ).toMatchObject({ maxFramerate: 30, maxBitrate: 2_500_000 });
  });

  it("nunca publicam com quinze quadros", () => {
    for (const preset of SHARE_PRESETS)
      expect(
        screenPublishOptions(preset).screenShareEncoding.maxFramerate,
      ).toBeGreaterThanOrEqual(30);
  });

  it("preservam fluidez e tratam o conteúdo como movimento", () => {
    const options = screenPublishOptions(DEFAULT_SHARE_QUALITY);
    expect(options.degradationPreference).toBe("maintain-framerate");
    expect(options.contentHint).toBe("motion");
  });
});
