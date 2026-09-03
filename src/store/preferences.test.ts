import { describe, expect, it } from "vitest";
import { migratePreferences } from "./preferences";
import { DEFAULT_NOISE_SUPPRESSION } from "../services/noiseSuppression";

/**
 * A preferência gravada vence o padrão do código, e quase todo mundo já abriu
 * o aplicativo alguma vez. Sem migração, mudar um padrão não alcança ninguém —
 * e a falha é silenciosa: nada quebra, a mudança só não acontece.
 */
describe("migratePreferences", () => {
  it("liga o áudio do compartilhamento para quem tinha desligado pelo padrão antigo", () => {
    const next = migratePreferences(
      { voice: { shareSystemAudio: false, noiseSuppression: "browser" } },
      1,
    );
    expect(next.voice?.shareSystemAudio).toBe(true);
  });

  it("move quem estava no padrão anterior para o GTC RN", () => {
    // "rnnoise" era o padrão de antes, então é indistinguível de "nunca
    // escolhi nada" — e era justamente o modo com a voz duplicada.
    const next = migratePreferences(
      { voice: { noiseSuppression: "rnnoise" } },
      1,
    );
    expect(next.voice?.noiseSuppression).toBe(DEFAULT_NOISE_SUPPRESSION);
    expect(next.voice?.noiseSuppression).toBe("gtcrn");
  });

  it("respeita quem escolheu desligar ou usar o filtro do navegador", () => {
    // Nenhum padrão jamais produziu esses dois valores: quem os tem, escolheu.
    for (const escolha of ["off", "browser"] as const)
      expect(
        migratePreferences({ voice: { noiseSuppression: escolha } }, 1).voice
          ?.noiseSuppression,
      ).toBe(escolha);
  });

  it("preenche o padrão quando não havia preferência de voz nenhuma", () => {
    const next = migratePreferences({}, 0);
    expect(next.voice?.noiseSuppression).toBe(DEFAULT_NOISE_SUPPRESSION);
    expect(next.voice?.shareSystemAudio).toBe(true);
  });

  it("não mexe em nada que já esteja na versão atual", () => {
    const atual = {
      voice: { noiseSuppression: "rnnoise" as const, shareSystemAudio: false },
    };
    expect(migratePreferences(atual, 2)).toEqual(atual);
  });

  it("preserva as preferências de acessibilidade", () => {
    const next = migratePreferences(
      { accessibility: { textScale: 1.2, zoom: 1, reducedMotion: true } },
      1,
    );
    expect(next.accessibility).toEqual({
      textScale: 1.2,
      zoom: 1,
      reducedMotion: true,
    });
  });
});
