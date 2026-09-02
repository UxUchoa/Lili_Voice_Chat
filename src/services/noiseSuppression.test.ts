import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOISE_SUPPRESSION,
  NOISE_SUPPRESSION_MODES,
  captureConstraints,
  type NoiseSuppressionMode,
} from "./noiseSuppression";

const MODES: NoiseSuppressionMode[] = ["off", "browser", "rnnoise", "gtcrn"];

describe("captureConstraints", () => {
  it("pede um canal só em todos os modos", () => {
    // Isto é o que faz o áudio sair nos dois ouvidos. O modelo do RNNoise
    // processa um canal; com o microfone em estéreo ele filtrava o esquerdo e
    // deixava o direito mudo, e a track publicada saía meio silenciosa.
    for (const mode of MODES)
      expect(captureConstraints(mode).channelCount).toBe(1);
  });

  it("desliga o filtro do navegador quando um modelo assume", () => {
    // Encadear os dois deixa o modelo recebendo um sinal já mutilado.
    expect(captureConstraints("rnnoise").noiseSuppression).toBe(false);
    expect(captureConstraints("gtcrn").noiseSuppression).toBe(false);
    expect(captureConstraints("browser").noiseSuppression).toBe(true);
  });

  it("mantém eco e ganho automático fora do modo desligado", () => {
    // Resolvem outra coisa que nenhum supressor de ruído faz.
    for (const mode of MODES.filter((item) => item !== "off")) {
      expect(captureConstraints(mode).echoCancellation).toBe(true);
      expect(captureConstraints(mode).autoGainControl).toBe(true);
    }
    expect(captureConstraints("off").echoCancellation).toBe(false);
    expect(captureConstraints("off").autoGainControl).toBe(false);
  });

  it("não pede processamento nenhum no modo desligado", () => {
    expect(captureConstraints("off")).toEqual({
      channelCount: 1,
      echoCancellation: false,
      autoGainControl: false,
      noiseSuppression: false,
    });
  });
});

describe("NOISE_SUPPRESSION_MODES", () => {
  it("cobre exatamente os modos que o pipeline conhece", () => {
    // Uma opção na interface sem modo correspondente viraria um seletor que
    // não muda nada.
    expect(NOISE_SUPPRESSION_MODES.map((option) => option.value).sort()).toEqual(
      [...MODES].sort(),
    );
  });

  it("o modo padrão é um dos modos oferecidos", () => {
    expect(MODES).toContain(DEFAULT_NOISE_SUPPRESSION);
  });
});
