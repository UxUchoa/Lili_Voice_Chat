import { describe, expect, it } from "vitest";
import { CAMERA_MODES, cameraMode } from "./cameraModes";

/**
 * A câmera oferecia até 4K a 12 Mb/s. Num plano gratuito, onde todos os
 * servidores dividem a mesma banda, um participante em 4K consome o que dez em
 * 720p consomem. Estes testes guardam o teto único e a razão dele.
 */
describe("modo de câmera", () => {
  it("oferece um modo só", () => {
    expect(Object.keys(CAMERA_MODES)).toEqual(["720"]);
  });

  it("privilegia fluidez: rosto em movimento pede quadros, não pixels", () => {
    expect(CAMERA_MODES[720].resolution).toBe(720);
    expect(CAMERA_MODES[720].frameRate).toBe(60);
  });

  it("mantém a conta de banda por participante previsível", () => {
    expect(CAMERA_MODES[720].bitrate).toBeLessThanOrEqual(2_500_000);
  });

  it("resolve qualquer preferência antiga para o modo que existe", () => {
    // 1080p, 1440p e 4K existiram. Uma preferência guardada não pode deixar a
    // câmera sem modo definido.
    for (const antiga of [480, 720, 1080, 1440, 2160])
      expect(cameraMode(antiga)).toBe(CAMERA_MODES[720]);
    expect(cameraMode()).toBe(CAMERA_MODES[720]);
  });
});
