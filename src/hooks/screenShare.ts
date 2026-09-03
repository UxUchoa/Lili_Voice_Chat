/**
 * Qualidade do compartilhamento de tela: o que se pede à fonte, o que se
 * permite ao encoder e o que se prefere sacrificar quando a rede aperta.
 *
 * Vive fora de `useLiveKitRtc` pelo mesmo motivo que `cameraModes`: são valores
 * e funções puras, e lá dentro qualquer teste sobre eles exigiria uma sala
 * conectada.
 *
 * ---
 *
 * Por que a transmissão rodava a ~15 quadros escolhesse o que escolhesse:
 *
 * Ninguém pedia 15. O padrão já era 1080p a 60. Os 15 eram o **resultado** de
 * duas decisões que se somavam.
 *
 * A primeira era `degradationPreference: "maintain-resolution"` junto de
 * `contentHint: "detail"`. As duas dizem a mesma coisa ao encoder: quando não
 * couber, preserve os pixels e jogue fora os quadros. Para texto parado é o
 * certo; para jogo, vídeo e qualquer coisa em movimento é exatamente o
 * contrário do que se quer.
 *
 * A segunda era o orçamento de bits: 6 Mb/s em 1080p, multiplicados por 1,7 a
 * 60 quadros — 10,2 Mb/s. Numa instância onde todos os servidores dividem a
 * mesma banda, o controle de congestionamento corta isso em segundos. E o corte
 * chegava na forma que a primeira decisão escolheu: menos quadros.
 *
 * Agora o pedido cabe no que a infraestrutura entrega, e o que cede primeiro é
 * o bitrate, depois a resolução, e só então a fluidez.
 */

export type ShareResolution = 720 | 1080;
export type ShareFrameRate = 30 | 60;

export interface ShareQuality {
  resolution: ShareResolution;
  frameRate: ShareFrameRate;
}

export interface SharePreset extends ShareQuality {
  width: number;
  height: number;
  /**
   * Teto de bits, não piso nem alvo constante.
   *
   * O WebRTC continua livre para usar menos quando a rede pede. O que o teto
   * evita é o pedido nascer acima do que a instância aguenta, que era como um
   * 1080p60 virava dez megabits e voltava como uma apresentação de slides.
   */
  bitrate: number;
  label: string;
}

/**
 * Os quatro modos oferecidos, do mais leve ao mais pesado.
 *
 * 15 quadros saiu da lista de propósito: não é qualidade, é o sintoma que
 * estávamos tentando eliminar. Deixá-lo como opção convidaria a escolher
 * justamente o estado que o bug produzia sozinho.
 */
export const SHARE_PRESETS: readonly SharePreset[] = [
  {
    resolution: 720,
    frameRate: 30,
    width: 1280,
    height: 720,
    bitrate: 1_500_000,
    label: "720p · 30 fps",
  },
  {
    resolution: 720,
    frameRate: 60,
    width: 1280,
    height: 720,
    // 2,3 → 2,2 Mb/s. Quatro por cento, de propósito: o 720p60 já estava bom e
    // o que se via eram picos ocasionais, não uma transmissão ruim. Quatro por
    // cento não se enxerga num quadro parado e devolve ~100 kb/s de folga para
    // o controle de congestionamento absorver um pico sem precisar cortar.
    // Cortar mais seria pagar em nitidez por um problema que não existe.
    bitrate: 2_200_000,
    label: "720p · 60 fps",
  },
  {
    resolution: 1080,
    frameRate: 30,
    width: 1920,
    height: 1080,
    bitrate: 2_500_000,
    label: "1080p · 30 fps",
  },
  {
    resolution: 1080,
    frameRate: 60,
    width: 1920,
    height: 1080,
    /**
     * 4,0 → 3,5 Mb/s. Doze e meio por cento — mais que no 720p60, e ainda
     * assim conservador.
     *
     * A diferença de tratamento é a diferença de sintoma. O 720p60 tinha
     * picos; o 1080p60 engasgava o tempo todo, e 4 Mb/s eram mais do que a
     * instância entrega de forma sustentada. Quando o pedido nasce acima do
     * que cabe, o controle de congestionamento corta em ciclos — e cada corte
     * é um engasgo visível.
     *
     * O que **não** muda: continuam 1920×1080 e 60 quadros. Baixar para 30
     * resolveria o número e destruiria a coisa que se está transmitindo.
     */
    bitrate: 3_500_000,
    label: "1080p · 60 fps",
  },
] as const;

/**
 * O que vale quando ninguém escolheu nada.
 *
 * 720p a 60 quadros, e não 1080p: conteúdo em movimento — jogo, vídeo,
 * navegação — é lido pela fluidez, e meia resolução a sessenta quadros custa
 * quase metade de 1080p a trinta. Fluidez por padrão, densidade por escolha.
 */
export const DEFAULT_SHARE_QUALITY: ShareQuality = {
  resolution: 720,
  frameRate: 60,
};

/** O preset de uma escolha; o padrão quando a combinação não existe mais. */
export function sharePreset(quality: ShareQuality): SharePreset {
  return (
    SHARE_PRESETS.find(
      (preset) =>
        preset.resolution === quality.resolution &&
        preset.frameRate === quality.frameRate,
    ) ??
    SHARE_PRESETS.find(
      (preset) =>
        preset.resolution === DEFAULT_SHARE_QUALITY.resolution &&
        preset.frameRate === DEFAULT_SHARE_QUALITY.frameRate,
    )!
  );
}

/** Teto de bits do preset escolhido. */
export function screenShareBitrate(quality: ShareQuality): number {
  return sharePreset(quality).bitrate;
}

/**
 * Restrições de captura para a qualidade escolhida.
 *
 * `ideal`, e não `exact`: uma janela menor que o alvo não tem como crescer, e
 * exigir o tamanho faria a captura falhar em vez de entregar o que a fonte tem.
 * O mesmo texto serve para começar a compartilhar e para mudar de ideia no
 * meio — é a mesma pergunta feita à mesma fonte.
 */
export function screenTrackConstraints(
  quality: ShareQuality,
): MediaTrackConstraints {
  const preset = sharePreset(quality);
  return {
    width: { ideal: preset.width },
    height: { ideal: preset.height },
    frameRate: { ideal: preset.frameRate },
  };
}

/**
 * O que ceder primeiro quando a banda não dá conta.
 *
 * `maintain-framerate` faz o encoder derrubar resolução antes de quadros. É o
 * oposto do que estava configurado, e é o que a tela de um jogo pede: 720p
 * fluido se lê, 1080p aos trancos não.
 */
export const SCREEN_DEGRADATION: RTCDegradationPreference =
  "maintain-framerate";

/**
 * A dica de conteúdo que acompanha essa escolha.
 *
 * `detail` diz ao encoder que a nitidez importa mais que a continuidade, e era
 * metade do motivo dos quinze quadros. `motion` inverte isso.
 */
export const SCREEN_CONTENT_HINT = "motion";

/**
 * As opções de publicação de uma track de tela.
 *
 * O nome do campo é o ponto: para uma track de tela o LiveKit lê
 * `screenShareEncoding` e **ignora `videoEncoding` em silêncio**. Enquanto
 * passávamos o segundo, valia o padrão do SDK —
 * `ScreenSharePresets.h1080fps15`, ou seja 15 quadros e 2,5 Mb/s — e nada do
 * que a interface oferecia chegava ao encoder. Nenhum erro, nenhum aviso: só
 * uma transmissão que rodava a quinze quadros escolhesse a pessoa o que
 * escolhesse.
 *
 * Existe como função para poder ser conferida por teste. O erro anterior não
 * era de valor, era de nome de campo, e nenhum tipo o pegava.
 */
export function screenPublishOptions(quality: ShareQuality) {
  return {
    screenShareEncoding: {
      maxBitrate: screenShareBitrate(quality),
      maxFramerate: quality.frameRate,
      priority: "high" as const,
    },
    degradationPreference: SCREEN_DEGRADATION,
    simulcast: false,
    contentHint: SCREEN_CONTENT_HINT,
  };
}
