import {
  DEFAULT_NOISE_SUPPRESSION,
  type NoiseSuppressionMode,
} from "../services/noiseSuppression";

/**
 * O que fica gravado em disco entre uma sessão e outra, e como trazê-lo para o
 * formato atual.
 *
 * Módulo à parte, e não uma função dentro do `persist`: uma migração que erra
 * não quebra nada de forma visível — ela simplesmente deixa de alcançar as
 * pessoas, que é o modo de falhar mais difícil de perceber. Aqui ela é testada
 * sem arrastar o cliente do Supabase e o `localStorage` junto.
 */
export interface PersistedPreferences {
  accessibility?: {
    textScale: number;
    zoom: number;
    reducedMotion: boolean;
  };
  voice?: {
    noiseSuppression?: NoiseSuppressionMode;
    shareSystemAudio?: boolean;
  };
}

/**
 * 2 — o áudio do compartilhamento volta ligado, e o supressor padrão passa a
 * ser o GTC RN.
 *
 * As duas coisas pelo mesmo motivo: a preferência gravada vence o padrão do
 * código, e quase todo mundo já abriu o aplicativo alguma vez. Sem tocar no
 * que está salvo, mudar o padrão não alcançaria ninguém.
 *
 * O supressor só é reescrito para quem está no `"rnnoise"` — que era o padrão
 * anterior, e por isso é indistinguível de "nunca escolhi nada". Perde quem
 * tinha escolhido RNNoise de propósito, e é uma perda real; pesou mais que o
 * RNNoise era exatamente o modo com a voz duplicada e o timbre de lata. Quem
 * quiser volta pelo menu, agora sem os artefatos. Quem está em "desligada" ou
 * "padrão do sistema" escolheu algo que nenhum padrão produziria, e fica onde
 * está.
 */
export function migratePreferences(
  persisted: unknown,
  from: number,
): PersistedPreferences {
  const state = (persisted ?? {}) as PersistedPreferences;
  if (from >= 2) return state;
  return {
    ...state,
    voice: {
      ...state.voice,
      shareSystemAudio: true,
      noiseSuppression:
        !state.voice?.noiseSuppression ||
        state.voice.noiseSuppression === "rnnoise"
          ? DEFAULT_NOISE_SUPPRESSION
          : state.voice.noiseSuppression,
    },
  };
}
