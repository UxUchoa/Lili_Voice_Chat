/**
 * Qualidade do compartilhamento de tela: o que se pede à fonte e o que se
 * permite ao encoder.
 *
 * Vive fora de `useLiveKitRtc` pelo mesmo motivo que `cameraModes`: lá dentro,
 * importá-la arrastava o cliente do LiveKit e o do Supabase junto, e um teste
 * que só quisesse conferir um orçamento de bits passava a exigir uma sala
 * conectada.
 */
/**
 * Restrições de captura para a qualidade escolhida.
 *
 * `ideal`, e não `exact`: uma janela menor que o alvo não tem como crescer, e
 * exigir o tamanho faria a captura falhar em vez de entregar o que a fonte
 * tem. O mesmo texto serve para começar a compartilhar e para mudar de ideia
 * no meio — é a mesma pergunta feita à mesma fonte.
 */
export function screenTrackConstraints({
  resolution,
  frameRate,
}: {
  resolution: number;
  frameRate: number;
}): MediaTrackConstraints {
  return {
    width: { ideal: Math.round((resolution * 16) / 9) },
    height: { ideal: resolution },
    frameRate: { ideal: frameRate },
  };
}

export function screenShareBitrate({
  resolution,
  frameRate,
}: {
  resolution: number;
  frameRate: number;
}) {
  // O teto do compartilhamento é 1080p: 1440p custava dez megabits para uma
  // diferença que some num tile de meia tela, e a banda é dividida entre todos
  // os servidores da instância.
  const base = resolution >= 1080 ? 6_000_000 : 3_000_000;
  return frameRate >= 60
    ? Math.round(base * 1.7)
    : frameRate <= 15
      ? Math.round(base * 0.7)
      : base;
}
