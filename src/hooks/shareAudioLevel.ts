/**
 * A prova de que o compartilhamento está levando som.
 *
 * Quem compartilha vê a própria tela num tile dentro do Lili, mas o `<video>`
 * dele é `muted` por necessidade: com o loopback do sistema, tocar esse áudio
 * de volta realimentaria a captura — alto-falante, loopback, alto-falante. O
 * resultado é que a imagem tem prova e o som não tem nenhuma. Olha-se o tile,
 * vê-se a janela mexendo, conclui-se que está tudo certo — e a transmissão
 * pode estar muda desde o primeiro segundo.
 *
 * Foi assim duas vezes. Na 0.2.0 o áudio nem era pedido por padrão; na 0.2.1 a
 * via do desktop tinha morrido e a captura caía para vídeo-só sozinha. As duas
 * duraram uma versão inteira porque **a única pessoa que não ouve o resultado é
 * justamente quem escolhe compartilhar**.
 *
 * O medidor fecha esse buraco: lê a faixa que está sendo publicada e transforma
 * "tem som saindo" em algo visível. Não substitui os testes — diz a verdade na
 * máquina de quem está usando, que é onde as duas falhas moraram.
 *
 * Funções puras aqui, Web Audio no componente: o mesmo motivo de `screenShare`
 * e `screenShareStats` viverem fora dos hooks — dá para testar a régua sem uma
 * sala conectada e sem um `AudioContext`.
 */

/**
 * Abaixo disto, é silêncio digital.
 *
 * Na escala de `levelFromSamples`, 0,05 fica em torno de -57 dBFS: mais baixo
 * que qualquer som que alguém pretendesse transmitir, e ainda assim acima do
 * zero absoluto que o loopback devolve quando nada está tocando. A pergunta que
 * este número responde não é "está alto?", é "saiu alguma coisa?".
 */
export const SOUND_FLOOR = 0.05;

/**
 * Quanto se espera antes de afirmar que nunca saiu som.
 *
 * Oito segundos porque o começo é legitimamente silencioso: a pessoa escolhe a
 * janela, volta para o jogo, tira o vídeo da pausa. Avisar antes disso seria
 * gritar no caso normal, e um aviso que aparece à toa é um aviso que se aprende
 * a ignorar — que é como ele deixaria de servir para o caso real.
 */
export const SILENT_START_MS = 8_000;

export type ShareAudioStatus =
  /** Nenhuma faixa de áudio na transmissão: o pedido de som não foi atendido. */
  | "sem-faixa"
  /** Tem faixa, ainda não veio som, e ainda é cedo para dizer algo. */
  | "aguardando"
  /** Tem faixa e nada saiu desde o início. */
  | "sem-som"
  /** Já saiu som. */
  | "com-som";

/**
 * O nível de um bloco de amostras, de 0 a 1.
 *
 * RMS, e não pico: pico pula com um estalo isolado e faz a barra piscar sem
 * relação com o que se está ouvindo. E a escala é em decibéis porque a linear
 * é inútil aqui — som de aplicativo vive entre -40 e -10 dBFS, o que numa barra
 * linear são todos os valores colados no chão, indistinguíveis entre si e
 * indistinguíveis do silêncio. A janela de 60 dB espalha justamente essa faixa
 * ao longo da barra inteira.
 */
export function levelFromSamples(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/**
 * O que dizer sobre o áudio da transmissão.
 *
 * `peak` é o **maior nível já visto desde o início**, e não o de agora: a
 * pergunta é se algum som chegou a sair alguma vez. Um jogo em silêncio por dez
 * segundos no meio da partida é normal e não merece aviso nenhum; o que merece
 * é a transmissão que nunca teve som — essa não melhora sozinha, e é a que
 * ninguém percebe.
 */
export function shareAudioStatus({
  hasTrack,
  peak,
  elapsedMs,
}: {
  hasTrack: boolean;
  peak: number;
  elapsedMs: number;
}): ShareAudioStatus {
  if (!hasTrack) return "sem-faixa";
  if (peak >= SOUND_FLOOR) return "com-som";
  return elapsedMs < SILENT_START_MS ? "aguardando" : "sem-som";
}

/**
 * O aviso que acompanha o medidor, ou `null` quando não há o que avisar.
 *
 * `badge` cabe no tile; `detail` é o texto longo, que vai para o `title` e para
 * quem usa leitor de tela. Os dois casos ruins são diferentes e pedem consertos
 * diferentes: sem faixa, o Windows recusou entregar o som; com faixa e sem som,
 * a fonte escolhida é que não está tocando nada.
 */
export function describeShareAudio(
  status: ShareAudioStatus,
): { badge: string; detail: string } | null {
  if (status === "sem-faixa")
    return {
      badge: "SEM ÁUDIO",
      detail:
        "A transmissão está sem áudio: o Windows não entregou o som do sistema. Deixe a saída padrão em 2 canais, 16 bits, 48000 Hz — ou escolha outra saída.",
    };
  if (status === "sem-som")
    return {
      badge: "SEM SOM",
      detail:
        "O áudio está na transmissão, mas nenhum som saiu desde o início. Confira se a fonte escolhida está mesmo tocando.",
    };
  return null;
}
