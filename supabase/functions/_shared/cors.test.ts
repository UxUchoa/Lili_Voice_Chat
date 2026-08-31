import { beforeAll, describe, expect, it } from "vitest";

/**
 * `cors.ts` lê `Deno.env` no momento em que é carregado, então o stub precisa
 * existir antes do import — daí o `await import` dentro do `beforeAll`.
 *
 * Vale o teste porque a pilha local não consegue mostrar o resultado: o Kong
 * do Supabase local responde ao preflight sozinho e reescreve o
 * `Access-Control-Allow-Origin` para `*`. O que sai da função só aparece de
 * verdade no projeto hospedado.
 */
const ALLOWED = "https://lili.app,https://*.vercel.app,null";

let withCors: typeof import("./cors.ts").withCors;
let json: typeof import("./cors.ts").json;

beforeAll(async () => {
  (globalThis as unknown as { Deno: unknown }).Deno = {
    env: { get: (name: string) => (name === "ALLOWED_ORIGIN" ? ALLOWED : "") },
  };
  const module = await import("./cors.ts");
  withCors = module.withCors;
  json = module.json;
});

const post = (origin?: string) =>
  new Request("https://project.functions.supabase.co/whatever", {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });

const preflight = (origin: string) =>
  new Request("https://project.functions.supabase.co/whatever", {
    method: "OPTIONS",
    headers: { Origin: origin },
  });

describe("withCors", () => {
  it("devolve a origem que casou, não a lista nem `*`", async () => {
    const handler = withCors(() => json({ ok: true }));
    const response = await handler(post("https://lili.app"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://lili.app",
    );
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("aceita a pré-visualização pelo curinga", async () => {
    const handler = withCors(() => json({ ok: true }));
    const response = await handler(post("https://lili-git-x.vercel.app"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://lili-git-x.vercel.app",
    );
  });

  it("libera o desktop empacotado, que manda Origin: null", async () => {
    const handler = withCors(() => json({ ok: true }));
    const response = await handler(post("null"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("null");
  });

  it("não devolve origem nenhuma para quem está fora da lista", async () => {
    const handler = withCors(() => json({ ok: true }));
    const response = await handler(post("https://attacker.example"));
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    // O corpo continua saindo; quem bloqueia é o navegador, e o cron (que não
    // manda Origin) precisa que a resposta chegue inteira.
    expect(response.status).toBe(200);
  });

  it("responde ao preflight sem chamar o handler", async () => {
    let called = false;
    const handler = withCors(() => {
      called = true;
      return json({ ok: true });
    });
    const response = await handler(preflight("https://lili.app"));
    expect(called).toBe(false);
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://lili.app",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain(
      "x-cron-secret",
    );
  });

  it("carimba a origem também numa resposta de erro do handler", async () => {
    const handler = withCors(() => json({ error: "unauthorized" }, 401));
    const response = await handler(post("https://lili.app"));
    expect(response.status).toBe(401);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://lili.app",
    );
  });

  it("não inventa cabeçalho para chamada sem Origin (cron, curl)", async () => {
    const handler = withCors(() => json({ ok: true }));
    const response = await handler(post());
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
