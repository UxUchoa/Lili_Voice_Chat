import { describe, expect, it } from "vitest";
import { CAMERA_MODES, cameraMode } from "./cameraModes";

/**
 * A câmera oferecia até 4K a 12 Mb/s. Num plano gratuito, onde todos os
 * servidores dividem a mesma banda, um participante em 4K consome o que dez em
 * 720p consomem. Estes testes guardam a decisão de ter só dois modos e de eles
 * custarem quase o mesmo.
 */
describe("modos de câmera", () => {
  it("oferece exatamente dois modos", () => {
    expect(Object.keys(CAMERA_MODES)).toEqual(["720", "1080"]);
  });

  it("troca fluidez por detalhe, não banda por banda", () => {
    const pixelsPerSecond = (mode: { resolution: number; frameRate: number }) =>
      mode.resolution * (mode.resolution * (16 / 9)) * mode.frameRate;
    const fluido = pixelsPerSecond(CAMERA_MODES[720]);
    const detalhado = pixelsPerSecond(CAMERA_MODES[1080]);
    // Dentro de 30% um do outro: nenhum dos dois é "o caro".
    expect(
      Math.max(fluido, detalhado) / Math.min(fluido, detalhado),
    ).toBeLessThan(1.3);
  });

  it("mantém os dois abaixo do teto que derrubava a banda compartilhada", () => {
    for (const mode of Object.values(CAMERA_MODES))
      expect(mode.bitrate).toBeLessThanOrEqual(3_000_000);
  });

  it("720p é o modo de movimento e 1080p o de detalhe", () => {
    expect(CAMERA_MODES[720].frameRate).toBe(60);
    expect(CAMERA_MODES[1080].frameRate).toBe(30);
  });

  it("resolve qualquer resolução guardada para um dos dois modos", () => {
    expect(cameraMode(720)).toBe(CAMERA_MODES[720]);
    expect(cameraMode(1080)).toBe(CAMERA_MODES[1080]);
    // 1440p e 4K existiram; uma preferência antiga não pode ficar sem modo.
    expect(cameraMode(1440)).toBe(CAMERA_MODES[1080]);
    expect(cameraMode(2160)).toBe(CAMERA_MODES[1080]);
    expect(cameraMode(480)).toBe(CAMERA_MODES[720]);
  });
});
