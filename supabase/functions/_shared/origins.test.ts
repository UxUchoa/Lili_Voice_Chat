import { describe, expect, it } from "vitest";
import {
  findAllowedOrigin,
  originMatches,
  parseAllowedOrigins,
} from "./origins";

describe("parseAllowedOrigins", () => {
  it("separa por vírgula e ignora espaço e item vazio", () => {
    expect(parseAllowedOrigins(" https://a.app , ,null ")).toEqual([
      "https://a.app",
      "null",
    ]);
  });

  it("trata ausência como lista vazia", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
  });
});

describe("originMatches", () => {
  it("aceita a origem exata", () => {
    expect(originMatches("https://janja.app", "https://janja.app")).toBe(true);
  });

  it("recusa porta e esquema diferentes", () => {
    expect(originMatches("https://janja.app", "https://janja.app:8443")).toBe(
      false,
    );
    expect(originMatches("https://janja.app", "http://janja.app")).toBe(false);
  });

  it("aceita subdomínio no curinga", () => {
    expect(originMatches("https://*.vercel.app", "https://x-y.vercel.app")).toBe(
      true,
    );
  });

  it("recusa o domínio nu e o sufixo forjado", () => {
    expect(originMatches("https://*.vercel.app", "https://vercel.app")).toBe(
      false,
    );
    expect(
      originMatches("https://*.vercel.app", "https://evil-vercel.app"),
    ).toBe(false);
    expect(
      originMatches("https://*.vercel.app", "https://vercel.app.attacker.com"),
    ).toBe(false);
    expect(
      originMatches("https://*.vercel.app", "https://attacker.com/.vercel.app"),
    ).toBe(false);
  });

  it("só libera o desktop quando `null` está na lista", () => {
    expect(originMatches("null", "null")).toBe(true);
    expect(originMatches("https://janja.app", "null")).toBe(false);
  });
});

describe("findAllowedOrigin", () => {
  const patterns = parseAllowedOrigins(
    "https://janja.app,https://*.vercel.app,null",
  );

  it("devolve a origem que casou, nunca a lista inteira", () => {
    expect(findAllowedOrigin(patterns, "https://a.vercel.app")).toBe(
      "https://a.vercel.app",
    );
  });

  it("devolve null para origem de fora", () => {
    expect(findAllowedOrigin(patterns, "https://attacker.com")).toBeNull();
  });

  it("devolve null quando não há Origin (cron, curl)", () => {
    expect(findAllowedOrigin(patterns, null)).toBeNull();
  });
});
