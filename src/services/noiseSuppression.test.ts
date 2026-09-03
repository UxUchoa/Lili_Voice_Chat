import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOISE_SUPPRESSION,
  NOISE_SUPPRESSION_MODES,
  captureConstraints,
  createMicPipeline,
  livePipelineCount,
  stopMicPipeline,
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

  it("o padrão é o GTC RN", () => {
    // Não é preferência de gosto: o RNNoise decide um ganho por banda de Bark,
    // e quando erra apaga a banda inteira — é o que se ouve como voz de lata.
    expect(DEFAULT_NOISE_SUPPRESSION).toBe("gtcrn");
  });

  it("marca o GTC RN como o recomendado na lista", () => {
    // A etiqueta e o padrão são duas fontes da mesma decisão; divergindo, o
    // menu recomenda uma coisa e o aplicativo roda outra.
    const recomendado = NOISE_SUPPRESSION_MODES.find((mode) =>
      mode.label.toLowerCase().includes("recomendado"),
    );
    expect(recomendado?.value).toBe(DEFAULT_NOISE_SUPPRESSION);
  });
});

describe("uma pipeline por vez", () => {
  it("não monta nada nos modos sem modelo", async () => {
    // "desligada" e "padrão do sistema" publicam a track crua; quem chama
    // conta com `null` para saber disso.
    const track = {} as MediaStreamTrack;
    expect(await createMicPipeline(track, "off")).toBeNull();
    expect(await createMicPipeline(track, "browser")).toBeNull();
  });

  it("não deixa montagem viva depois de um modo sem modelo", async () => {
    // Trocar para "desligada" tem que derrubar o worklet que estava rodando,
    // e não só parar de usá-lo.
    await createMicPipeline({} as MediaStreamTrack, "off");
    expect(livePipelineCount()).toBe(0);
  });

  it("desmontar é idempotente", async () => {
    await stopMicPipeline();
    await stopMicPipeline();
    expect(livePipelineCount()).toBe(0);
  });
});
