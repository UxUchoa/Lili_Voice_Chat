/**
 * O que vai ao ar, e a garantia de que cada coisa vai uma vez só.
 *
 * `publishStreams` recebia os MediaStream locais e virava um mapa por
 * `track.id`. Ids diferentes são tracks diferentes, então duas capturas do
 * mesmo microfone entravam as duas — e as duas eram publicadas. Do outro lado
 * isso chega como a mesma pessoa falando duas vezes, defasada pelo tanto que a
 * segunda captura demorou a subir: a "voz fantasma", e o timbre de lata que
 * vem junto quando um sinal se soma a uma cópia atrasada de si mesmo.
 *
 * A causa real estava antes, em quem capturava (ver a fila de mídia em
 * `CallView`). Isto aqui é a última camada: mesmo que um caminho novo volte a
 * entregar duas tracks do mesmo tipo, só uma é publicada. Chegar mudo por um
 * bug é ruim; chegar dobrado é pior, porque ninguém percebe do próprio lado.
 *
 * Vive fora de `useLiveKitRtc` porque é função pura — lá dentro, testar isto
 * exigiria uma sala conectada.
 */

/** De onde a track veio, do ponto de vista de quem captura. */
export type LocalTrackOrigin = "camera" | "screen";

/**
 * A vaga que a track ocupa na publicação. Uma vaga, uma track.
 *
 * São os quatro papéis que o LiveKit distingue; o mapeamento para
 * `Track.Source` fica em `useLiveKitRtc`, que é quem fala com o SDK.
 */
export type PublicationSlot =
  "microphone" | "camera" | "screen" | "screen-audio";

export interface PlannedTrack {
  track: MediaStreamTrack;
  origin: LocalTrackOrigin;
  slot: PublicationSlot;
}

export function publicationSlot(
  kind: string,
  origin: LocalTrackOrigin,
): PublicationSlot {
  if (origin === "screen") return kind === "audio" ? "screen-audio" : "screen";
  return kind === "audio" ? "microphone" : "camera";
}

/**
 * Monta o conjunto a publicar a partir dos streams locais.
 *
 * Continua indexado por `track.id` — é assim que a publicação compara o que já
 * está no ar com o que deveria estar. O que muda é o filtro: a primeira track
 * de cada vaga entra, as seguintes ficam de fora.
 *
 * A primeira, e não a última, de propósito: a track que já está publicada e
 * funcionando é a primeira: preferir a recém-chegada trocaria uma transmissão
 * boa por uma duvidosa toda vez que a duplicata aparecesse.
 */
export function planPublications(
  streams: Array<{ stream: MediaStream; origin: LocalTrackOrigin }>,
): Map<string, PlannedTrack> {
  const planned = new Map<string, PlannedTrack>();
  const taken = new Set<PublicationSlot>();
  for (const { stream, origin } of streams) {
    for (const track of stream.getTracks()) {
      const slot = publicationSlot(track.kind, origin);
      if (taken.has(slot)) continue;
      taken.add(slot);
      planned.set(track.id, { track, origin, slot });
    }
  }
  return planned;
}
