import { describe, expect, it } from "vitest";
import {
  SILENT_START_MS,
  SOUND_FLOOR,
  describeShareAudio,
  levelFromSamples,
  shareAudioStatus,
} from "./shareAudioLevel";

/** Um bloco de onda senoidal na amplitude pedida. */
const tone = (amplitude: number, length = 1024) =>
  Float32Array.from({ length }, (_, index) =>
    Math.sin((index / length) * Math.PI * 2 * 8) * amplitude,
  );

describe("o nível medido", () => {
  it("é zero no silêncio digital", () => {
    expect(levelFromSamples(new Float32Array(1024))).toBe(0);
  });

  it("é zero sem amostra nenhuma", () => {
    // O analisador pode ser lido antes de o primeiro bloco chegar.
    expect(levelFromSamples(new Float32Array(0))).toBe(0);
  });

  it("cresce com o volume", () => {
    const baixo = levelFromSamples(tone(0.01));
    const medio = levelFromSamples(tone(0.1));
    const alto = levelFromSamples(tone(0.9));
    expect(baixo).toBeLessThan(medio);
    expect(medio).toBeLessThan(alto);
  });

  it("nunca passa de um, nem no clipe", () => {
    expect(levelFromSamples(tone(1))).toBeLessThanOrEqual(1);
    expect(levelFromSamples(tone(4))).toBe(1);
  });

  it("espalha a faixa de um aplicativo pela barra, em vez de colá-la no chão", () => {
    // O motivo da escala em decibéis: som de aplicativo vive entre -40 e -10
    // dBFS. Numa barra linear isso é tudo indistinguível de zero, que é
    // exatamente a diferença que este medidor existe para mostrar.
    const nivel = levelFromSamples(tone(0.03)); // ≈ -33 dBFS
    expect(nivel).toBeGreaterThan(0.3);
    expect(nivel).toBeLessThan(0.8);
  });

  it("deixa som de verdade acima do piso de silêncio", () => {
    expect(levelFromSamples(tone(0.005))).toBeGreaterThan(SOUND_FLOOR);
    expect(levelFromSamples(new Float32Array(1024))).toBeLessThan(SOUND_FLOOR);
  });
});

describe("o que dizer sobre o áudio da transmissão", () => {
  it("acusa a falta da faixa na hora", () => {
    // Sem faixa não há o que esperar: o pedido de som já não foi atendido, e
    // segurar o aviso oito segundos só atrasaria a única chance de perceber.
    expect(shareAudioStatus({ hasTrack: false, peak: 0, elapsedMs: 0 })).toBe(
      "sem-faixa",
    );
  });

  it("segura o julgamento no começo, que é legitimamente silencioso", () => {
    expect(shareAudioStatus({ hasTrack: true, peak: 0, elapsedMs: 0 })).toBe(
      "aguardando",
    );
    expect(
      shareAudioStatus({
        hasTrack: true,
        peak: 0,
        elapsedMs: SILENT_START_MS - 1,
      }),
    ).toBe("aguardando");
  });

  it("acusa a transmissão que nunca teve som", () => {
    expect(
      shareAudioStatus({ hasTrack: true, peak: 0, elapsedMs: SILENT_START_MS }),
    ).toBe("sem-som");
  });

  it("não reclama de um trecho quieto depois de já ter saído som", () => {
    // Um jogo em silêncio no meio da partida é normal. O aviso é sobre a
    // transmissão que nasceu muda — essa não melhora sozinha.
    expect(
      shareAudioStatus({
        hasTrack: true,
        peak: 0.6,
        elapsedMs: 10 * SILENT_START_MS,
      }),
    ).toBe("com-som");
  });

  it("aceita som fraco como som", () => {
    expect(
      shareAudioStatus({
        hasTrack: true,
        peak: SOUND_FLOOR,
        elapsedMs: SILENT_START_MS,
      }),
    ).toBe("com-som");
  });
});

describe("o aviso", () => {
  it("não existe quando está tudo bem", () => {
    expect(describeShareAudio("com-som")).toBeNull();
    expect(describeShareAudio("aguardando")).toBeNull();
  });

  it("separa os dois problemas, que pedem consertos diferentes", () => {
    // Sem faixa, o conserto está no som do Windows; sem som, na fonte
    // escolhida. Um texto só para os dois mandaria metade das pessoas mexer no
    // lugar errado.
    const semFaixa = describeShareAudio("sem-faixa");
    const semSom = describeShareAudio("sem-som");
    expect(semFaixa?.detail).toContain("Windows");
    expect(semSom?.detail).toContain("fonte");
    expect(semFaixa?.badge).not.toBe(semSom?.badge);
  });
});
