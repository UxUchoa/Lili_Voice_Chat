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
 * - GTC RN: rede convolucional-recorrente com máscara complexa por bin. É o
 *   padrão desde a 0.2.1.
 * - RNNoise: rede recorrente de 2018, ganho por banda de Bark. Mais barata,
 *   mais colorida.
 *
 * O modo continua sendo escolha do usuário porque nenhum supressor é de graça:
 * o filtro come parte das consoantes e, em quem canta ou toca algo perto do
 * microfone, atrapalha mais do que ajuda.
 *
 * ---
 *
 * **Uma pipeline viva por vez, e o porquê disso ser regra do módulo.**
 *
 * O sintoma era a "voz fantasma": a pessoa falando e, alguns milissegundos
 * depois, ela de novo — como se duas estivessem falando juntas. Não era o
 * modelo. Eram duas montagens deste grafo em cima de dois `getUserMedia`
 * diferentes, as duas publicadas ao mesmo tempo. Somadas no outro lado com uma
 * dezena de milissegundos de defasagem, dão exatamente as duas queixas de uma
 * vez: a duplicação audível e o timbre metálico — um sinal somado a uma cópia
 * atrasada de si mesmo é um filtro pente, e filtro pente soa como lata.
 *
 * Como se chegava lá: subir o WebAssembly e o worklet leva centenas de
 * milissegundos, e durante essa espera o botão do microfone continua mostrando
 * "silenciado". Quem clica de novo — que é o normal — dispara a segunda
 * captura.
 *
 * A defesa está em três camadas, de propósito: quem chama serializa as
 * operações de mídia, a chamada guarda uma track de áudio por vez, e aqui a
 * montagem anterior é desmontada antes que outra suba. Basta uma das três
 * falhar para o resto continuar de pé.
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
    value: "gtcrn",
    label: "GTC RN (recomendado)",
    hint: "Rede neural local. Corta teclado, ventilador e ruído de fundo mantendo a voz natural.",
  },
  {
    value: "rnnoise",
    label: "RNNoise (mais leve)",
    hint: "Modelo menor e mais barato de CPU. Segura menos ruído e colore mais a voz.",
  },
];

/**
 * O que roda quando ninguém escolheu nada.
 *
 * GTC RN e não RNNoise. Os dois rodam localmente e custam CPU parecida na
 * prática; a diferença está no que sobra da voz. O RNNoise é de 2018, trabalha
 * sobre 22 bandas de Bark e decide um ganho por banda — quando ele erra, erra
 * numa banda inteira de uma vez, e é isso que se ouve como voz de rádio velho.
 * O GTC RN estima máscara complexa por bin, então o que ele tira sai sem levar
 * junto o formante vizinho.
 *
 * Trocar o padrão alcança quem nunca abriu o menu, que é quase todo mundo — a
 * migração das preferências em `appStore` cuida de quem já tinha o antigo
 * gravado sem nunca ter escolhido nada.
 */
export const DEFAULT_NOISE_SUPPRESSION: NoiseSuppressionMode = "gtcrn";

/**
 * O que o `getUserMedia` deve pedir para cada modo.
 *
 * A cadeia inteira, escrita de uma vez para não voltar a crescer sozinha:
 *
 *     microfone
 *       → cancelamento de eco  (do navegador, sempre)
 *       → ganho automático     (do navegador, sempre)
 *       → GTC RN *ou* RNNoise  (um, nunca os dois)
 *       → Opus, sem DTX        (ver publishDefaults em useLiveKitRtc)
 *
 * E o que **não** está nela: o supressor do navegador quando um modelo assume,
 * nenhum portão de ruído, nenhum segundo modelo. Empilhar supressores não soma
 * qualidade — o segundo trabalha em cima do que o primeiro já mutilou, e o que
 * sobra é voz metálica e com buracos.
 *
 * Eco e ganho ficam porque resolvem outra coisa que nenhum supressor faz — o
 * alto-falante voltando para o microfone, e o volume da pessoa — e porque os
 * dois rodam dentro do processamento de captura do navegador, antes de existir
 * qualquer track para interceptar.
 *
 * `channelCount: 1` é o que faz o áudio sair nos dois ouvidos. Voz é mono, e o
 * modelo do RNNoise também: ele processa um canal só. Quando o driver entregava
 * o microfone em estéreo, o supressor filtrava o canal esquerdo e deixava o
 * direito intocado — silêncio — e a track publicada saía meio muda, que é o
 * "só toca no fone esquerdo".
 */
export function captureConstraints(mode: NoiseSuppressionMode) {
  return {
    channelCount: 1,
    echoCancellation: mode !== "off",
    autoGainControl: mode !== "off",
    noiseSuppression: mode === "browser",
  };
}

export interface MicPipeline {
  /** Track que deve ser publicada no lugar da original. */
  track: MediaStreamTrack;
  /** Modelo que está de fato rodando nesta montagem. */
  mode: "rnnoise" | "gtcrn";
  /** Libera o worklet e o contexto. Não para a track de origem. */
  stop: () => Promise<void>;
}

/**
 * A montagem que está no ar, se houver.
 *
 * Módulo e não parâmetro: o processo tem um microfone e uma chamada, então
 * "quantas pipelines existem" é um fato global. Guardá-lo em quem chama já foi
 * tentado — e é justamente o que uma corrida entre dois cliques burla.
 */
let live: MicPipeline | null = null;

/** Desmonta a pipeline no ar, se existir. Idempotente. */
export async function stopMicPipeline() {
  const current = live;
  if (!current) return;
  live = null;
  await current.stop();
}

/** Só para os testes: quantas montagens estão vivas neste processo. */
export function livePipelineCount() {
  return live ? 1 : 0;
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
 *
 * Montar uma segunda pipeline desmonta a primeira, sempre. Ver o cabeçalho do
 * módulo: duas no ar ao mesmo tempo era a voz fantasma.
 */
export async function createMicPipeline(
  source: MediaStreamTrack,
  mode: NoiseSuppressionMode,
): Promise<MicPipeline | null> {
  // Antes de qualquer coisa, inclusive nos modos sem worklet: trocar para
  // "desligada" ou "padrão do sistema" também tem que derrubar o que estava
  // rodando, senão o contexto anterior fica vivo consumindo CPU.
  await stopMicPipeline();
  if (mode !== "rnnoise" && mode !== "gtcrn") return null;
  if (typeof AudioContext === "undefined") return null;
  let context: AudioContext | undefined;
  try {
    context = new AudioContext({ sampleRate: SAMPLE_RATE });
    // O contexto nasce suspenso quando a página ainda não teve interação; sem
    // isto o worklet não roda e a track sai muda.
    if (context.state === "suspended") await context.resume();
    const worklet = await createWorklet(context, mode);
    /**
     * Trava o grafo em mono, do supressor até o destino.
     *
     * `captureConstraints` já pede um canal só, mas constraint de canal é um
     * pedido: um driver que só entrega estéreo continua entregando. E o nó do
     * supressor nasce sem `outputChannelCount`, então o número de canais de
     * saída acompanha o da entrada — com dois canais na entrada ele filtrava o
     * esquerdo e nunca escrevia no direito, que saía mudo.
     *
     * `explicit` com um canal força a mistura da entrada antes do processamento;
     * `speakers` é o que soma os dois lados em vez de descartar um.
     */
    worklet.channelCount = 1;
    worklet.channelCountMode = "explicit";
    worklet.channelInterpretation = "speakers";
    const input = context.createMediaStreamSource(
      new MediaStream([source]),
    );
    const output = context.createMediaStreamDestination();
    // O destino nasce com dois canais; um canal só publica a track em mono, e
    // mono toca igual nos dois ouvidos.
    output.channelCount = 1;
    output.channelCountMode = "explicit";
    output.channelInterpretation = "speakers";
    input.connect(worklet);
    worklet.connect(output);
    const track = output.stream.getAudioTracks()[0];
    if (!track) throw new Error("O destino de áudio não produziu track.");
    const pipeline: MicPipeline = {
      track,
      mode,
      stop: async () => {
        // A referência do módulo só some quando é esta montagem que está
        // saindo: fechar uma pipeline antiga, tarde, não pode apagar o
        // registro da que subiu no lugar dela.
        if (live === pipeline) live = null;
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
    live = pipeline;
    return pipeline;
  } catch (caught) {
    console.error("[audio] supressor de ruído indisponível", caught);
    await context?.close().catch(() => undefined);
    return null;
  }
}
