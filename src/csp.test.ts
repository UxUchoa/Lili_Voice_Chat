import { describe, expect, it } from "vitest";
import { productionCsp } from "../vite.config";

/**
 * A política de produção não tinha teste, e foi exatamente por onde o seletor
 * de GIFs quebrou: ela liberava o Tenor, o provedor anterior, muito depois de o
 * seletor ter passado a buscar no Giphy. Como `npm run dev` usa a política
 * permissiva, o furo era invisível na máquina de quem programava — só a Vercel
 * e o desktop empacotado rodam `productionCsp`.
 *
 * O que se protege aqui é a regra que faltava: toda origem que o navegador
 * busca precisa estar na diretiva certa. Um provedor trocado sem passar por
 * este arquivo derruba o teste.
 */
const SUPABASE = "https://exemplo.supabase.co";
const LIVEKIT = "wss://exemplo.livekit.cloud";

/** `img-src ...` de dentro da política, já separado em origens. */
function directive(policy: string, name: string): string[] {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  if (!found) throw new Error(`a política não tem ${name}`);
  return found.slice(name.length).trim().split(/\s+/);
}

describe("productionCsp", () => {
  const policy = productionCsp(SUPABASE, LIVEKIT);

  it("deixa a grade do seletor desenhar as prévias do Giphy", () => {
    // Sem isto o navegador recusa cada `100w.gif` antes de virar requisição, e
    // o seletor abre com dezenas de quadros quebrados.
    expect(directive(policy, "img-src")).toContain("https://*.giphy.com");
  });

  it("deixa o navegador baixar o GIF escolhido", () => {
    // `downloadGifAsFile` faz `fetch` no arquivo para reenviá-lo como anexo
    // nosso: é `connect-src`, e não `img-src`, que autoriza essa busca.
    expect(directive(policy, "connect-src")).toContain("https://*.giphy.com");
  });

  it("não carrega origem de provedor que o aplicativo não usa mais", () => {
    expect(policy).not.toMatch(/tenor/i);
  });

  it("libera o Storage, que entrega avatar, banner e anexo por URL assinada", () => {
    expect(directive(policy, "img-src")).toContain(SUPABASE);
    expect(directive(policy, "media-src")).toContain(SUPABASE);
  });

  it("mantém o WebSocket do Supabase e do LiveKit em connect-src", () => {
    const connect = directive(policy, "connect-src");
    expect(connect).toContain("wss://exemplo.supabase.co");
    expect(connect).toContain("wss://exemplo.livekit.cloud");
  });
});
