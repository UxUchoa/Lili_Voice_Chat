import { describe, expect, it } from "vitest";
import { resolveSiteUrl } from "./config";

describe("resolveSiteUrl", () => {
  it("usa a origem quando o aplicativo é servido pela web", () => {
    expect(resolveSiteUrl("", "https://lili.app")).toBe("https://lili.app");
    expect(resolveSiteUrl("", "http://127.0.0.1:5173")).toBe(
      "http://127.0.0.1:5173",
    );
  });

  // O desktop empacotado abre o dist por file://, e ali `location.origin` é a
  // string "file://". Sem o valor configurado, o convite copiado viraria
  // `file:///#/invite/CODE` — um endereço que não leva a lugar nenhum.
  it("ignora a origem do desktop empacotado", () => {
    expect(resolveSiteUrl("https://lili.app", "file://")).toBe(
      "https://lili.app",
    );
    expect(resolveSiteUrl("", "file://")).toBe("");
    expect(resolveSiteUrl("", "null")).toBe("");
  });

  it("prefere o endereço configurado à origem", () => {
    expect(
      resolveSiteUrl("https://lili.app", "https://previa.vercel.app"),
    ).toBe("https://lili.app");
  });

  it("tira a barra final, para não gerar endereço com barra dupla", () => {
    expect(resolveSiteUrl("https://lili.app/", "")).toBe("https://lili.app");
    expect(resolveSiteUrl("  https://lili.app//  ", "")).toBe(
      "https://lili.app",
    );
  });

  it("recusa valor que não é http(s)", () => {
    expect(resolveSiteUrl("lili://auth", "https://lili.app")).toBe(
      "https://lili.app",
    );
    expect(resolveSiteUrl("lili.app", "")).toBe("");
  });
});
