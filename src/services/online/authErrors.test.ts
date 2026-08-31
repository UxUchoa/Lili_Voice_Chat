import { describe, expect, it } from "vitest";
import { humanizeAuthError } from "./authErrors";

/**
 * O usuário via "email rate limit exceeded" numa caixa vermelha, em inglês e
 * no vocabulário do servidor de autenticação. Nada ali diz que o problema é
 * temporário, que não é culpa dele e que basta esperar.
 */
describe("humanizeAuthError", () => {
  const mensagemDe = (original: string) =>
    humanizeAuthError(new Error(original)).message;

  it("explica o limite de envio de e-mail como algo passageiro", () => {
    const texto = mensagemDe("email rate limit exceeded");
    expect(texto).toMatch(/limite de envios/i);
    expect(texto).toMatch(/minutos/i);
  });

  it("cobre o limite por segurança do Supabase", () => {
    expect(
      mensagemDe(
        "For security purposes, you can only request this after 51 seconds",
      ),
    ).toMatch(/espere um minuto/i);
  });

  it("diz o que fazer quando o e-mail ainda não foi confirmado", () => {
    expect(mensagemDe("Email not confirmed")).toMatch(/reenvio/i);
  });

  it("não expõe o vocabulário do servidor no caminho comum de login", () => {
    expect(mensagemDe("Invalid login credentials")).toBe(
      "E-mail ou senha não conferem.",
    );
  });

  it("avisa que a conta ja existe em vez de falar em user registered", () => {
    expect(mensagemDe("User already registered")).toMatch(
      /já existe uma conta/i,
    );
  });

  it("explica o banimento como o expurgo por inatividade que ele é", () => {
    expect(mensagemDe("User is banned")).toMatch(/inatividade/i);
  });

  it("deixa passar o que não tem tratamento, para não esconder de quem depura", () => {
    const desconhecido = "some brand new gotrue failure";
    expect(mensagemDe(desconhecido)).toBe(desconhecido);
  });

  it("aceita o que não é Error sem quebrar", () => {
    expect(humanizeAuthError("texto solto").message).toBe("texto solto");
  });
});
