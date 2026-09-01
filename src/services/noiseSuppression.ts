/**
 * Supressão de ruído do microfone.
 *
 * O que o navegador oferece (`noiseSuppression: true` no getUserMedia) é um
 * filtro estatístico: segura chiado constante e pouco mais que isso. Teclado,
 * ventilador, clique de mouse e a televisão do outro cômodo passam inteiros —
 * era esse o microfone "cru" que se ouvia nas chamadas.
 *
 * Aqui a track passa por um AudioWorklet antes de ser publicada. Dois modelos,
 * ambos rodando localmente em WebAssembly, sem serviço externo e sem áudio
 * saindo da máquina para ser processado:
 *
 * - RNNoise: rede recorrente pequena, custo baixo, corta bem ruído de fundo
 *   estacionário e boa parte do teclado.
 * - GTCRN: rede convolucional-recorrente, mais recente e mais agressiva, ao
 *   preço de mais CPU.
 *
 * O modo continua sendo escolha do usuário porque nenhum supressor é de graça:
 * o filtro come parte das consoantes e, em quem canta ou toca algo perto do
 * microfone, atrapalha mais do que ajuda.
 */

export type NoiseSuppressionMode = "off" | "browser" | "rnnoise" | "gtcrn";

export const NOISE_SUPPRESSION_MODES: Array<{
  value: NoiseSuppressionMode;
  label: string;
  hint: string;
}> = [
  {
    value: "off",
    label: "Desligada",
    hint: "Microfone cru, sem nenhum tratamento.",
  },
  {
    value: "browser",
    label: "Padrão do sistema",
    hint: "O filtro do próprio navegador. Leve, segura só o chiado.",
  },
  {
    value: "rnnoise",
    label: "RNNoise (recomendado)",
    hint: "Rede neural local. Corta teclado, ventilador e ruído de fundo.",
  },
  {
    value: "gtcrn",
    label: "GTCRN (agressiva)",
    hint: "Mais forte que o RNNoise e mais pesada na CPU.",
  },
];

export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionMode = "rnnoise";

/**
 * O que o `getUserMedia` deve pedir para cada modo.
 *
 * Com um modelo ligado o filtro do navegador **sai**: encadear os dois deixa o
 * RNNoise recebendo um sinal já mutilado, e o resultado é uma voz metálica e
 * com buracos. Cancelamento de eco e ganho automático continuam nos dois casos
 * — eles resolvem outra coisa (o alto-falante voltando para o microfone e o
 * volume da pessoa), que nenhum supressor de ruído faz.
 */
export function captureConstraints(mode: NoiseSuppressionMode) {
  return {
    echoCancellation: mode !== "off",
    autoGainControl: mode !== "off",
    noiseSuppression: mode === "browser",
  };
}

export interface MicPipeline {
  /** Track que deve ser publicada no lugar da original. */
  track: MediaStreamTrack;
  /** Libera o worklet e o contexto. Não para a track de origem. */
  stop: () => Promise<void>;
}

/** O worklet do RNNoise assume 48 kHz; o contexto é criado nessa taxa. */
const SAMPLE_RATE = 48_000;

type WorkletNodeWithDestroy = AudioNode & { destroy?: () => void };

async function createWorklet(
  context: AudioContext,
  mode: "rnnoise" | "gtcrn",
): Promise<WorkletNodeWithDestroy> {
  const suppressor = await import("@sapphi-red/web-noise-suppressor");
  if (mode === "gtcrn") {
    const [workletUrl, wasmUrl] = await Promise.all([
      import("@sapphi-red/web-noise-suppressor/gtcrnWorklet.js?url"),
      import("@sapphi-red/web-noise-suppressor/gtcrn.wasm?url"),
    ]);
    const wasmBinary = await suppressor.loadGtcrn({ url: wasmUrl.default });
    await context.audioWorklet.addModule(workletUrl.default);
    return new suppressor.GtcrnWorkletNode(context, {
      wasmBinary,
      maxChannels: 1,
    });
  }
  const [workletUrl, wasmUrl, simdWasmUrl] = await Promise.all([
    import("@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise.wasm?url"),
    import("@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url"),
  ]);
  const wasmBinary = await suppressor.loadRnnoise({
    url: wasmUrl.default,
    simdUrl: simdWasmUrl.default,
  });
  await context.audioWorklet.addModule(workletUrl.default);
  return new suppressor.RnnoiseWorkletNode(context, {
    wasmBinary,
    maxChannels: 1,
  });
}

/**
 * Monta o filtro em cima de uma track de microfone.
 *
 * Devolve `null` quando o modo não pede processamento — quem chama publica a
 * track original nesse caso. Uma falha aqui (WebAssembly bloqueado, worklet
 * que não carrega, CPU sem SIMD) também devolve `null`: ficar sem microfone
 * porque o supressor não subiu seria pior do que falar com ruído.
 */
export async function createMicPipeline(
  source: MediaStreamTrack,
  mode: NoiseSuppressionMode,
): Promise<MicPipeline | null> {
  if (mode !== "rnnoise" && mode !== "gtcrn") return null;
  if (typeof AudioContext === "undefined") return null;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    // O contexto nasce suspenso quando a página ainda não teve interação; sem
    // isto o worklet não roda e a track sai muda.
    if (context.state === "suspended") await context.resume();
    const worklet = await createWorklet(context, mode);
    const input = context.createMediaStreamSource(
      new MediaStream([source]),
    );
    const output = context.createMediaStreamDestination();
    input.connect(worklet);
    worklet.connect(output);
    const track = output.stream.getAudioTracks()[0];
    if (!track) throw new Error("O destino de áudio não produziu track.");
    return {
      track,
      stop: async () => {
        try {
          input.disconnect();
          worklet.disconnect();
          worklet.destroy?.();
          track.stop();
        } finally {
          await context?.close().catch(() => undefined);
        }
      },
    };
  } catch (caught) {
    console.error("[audio] supressor de ruído indisponível", caught);
    await context?.close().catch(() => undefined);
    return null;
  }
}
