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

describe("código de verificação", () => {
  it("junta código errado e código vencido na mesma resposta", () => {
    // Separar os dois diria a quem está adivinhando que o número existia.
    const errado = humanizeAuthError(
      new Error("Token has expired or is invalid"),
    );
    const vencido = humanizeAuthError(new Error("otp_expired"));
    expect(errado.message).toBe(vencido.message);
    expect(errado.message).toMatch(/não confere ou já expirou/);
  });

  it("oferece a saída em vez de só apontar o erro", () => {
    expect(
      humanizeAuthError(new Error("Token not found")).message,
    ).toMatch(/Peça um novo/);
  });

  it("fala em código, e não em link, no e-mail não confirmado", () => {
    expect(
      humanizeAuthError(new Error("Email not confirmed")).message,
    ).toMatch(/código/);
  });
});
