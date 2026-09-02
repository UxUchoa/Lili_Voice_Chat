import { describe, expect, it } from "vitest";
import {
  OTP_LENGTH,
  OTP_RESEND_SECONDS,
  isCompleteOtp,
  normalizeOtp,
  otpError,
  otpInstruction,
  otpTitle,
  resendCooldown,
  resendLabel,
} from "./otp";

describe("normalizeOtp", () => {
  it("aceita o código colado com espaço ou hífen", () => {
    // Quem cola do e-mail traz a formatação junto; recusar seria implicância.
    expect(normalizeOtp("123 456")).toBe("123456");
    expect(normalizeOtp("123-456")).toBe("123456");
  });

  it("descarta o texto que veio grudado na cópia", () => {
    expect(normalizeOtp("Seu código é 123456.")).toBe("123456");
  });

  it("corta o que passa do tamanho, em vez de recusar", () => {
    expect(normalizeOtp("1234567890")).toBe("123456");
  });

  it("devolve vazio quando não há dígito nenhum", () => {
    expect(normalizeOtp("abc")).toBe("");
    expect(normalizeOtp("")).toBe("");
  });
});

describe("isCompleteOtp", () => {
  it("só aceita o código inteiro", () => {
    expect(isCompleteOtp("123456")).toBe(true);
    expect(isCompleteOtp("12345")).toBe(false);
    expect(isCompleteOtp("12 34 56")).toBe(true);
  });
});

describe("otpError", () => {
  it("pede o código quando o campo está vazio", () => {
    expect(otpError("")).toMatch(/Digite o código/);
    expect(otpError("   ")).toMatch(/Digite o código/);
  });

  it("diz o tamanho esperado quando falta dígito", () => {
    expect(otpError("123")).toBe(`O código tem ${OTP_LENGTH} dígitos.`);
  });

  it("não reclama de um código completo", () => {
    // Se está certo ou vencido, quem responde é o servidor.
    expect(otpError("123456")).toBeUndefined();
  });
});

describe("resendCooldown", () => {
  const agora = 1_000_000;

  it("não faz esperar quando nada foi enviado ainda", () => {
    expect(resendCooldown(undefined, agora)).toBe(0);
  });

  it("conta a espera desde o último envio", () => {
    expect(resendCooldown(agora - 10_000, agora)).toBe(
      OTP_RESEND_SECONDS - 10,
    );
  });

  it("zera quando a espera acabou", () => {
    expect(resendCooldown(agora - 120_000, agora)).toBe(0);
  });

  it("não prende o botão quando o relógio anda para trás", () => {
    // Ajuste de horário do sistema não pode deixar o reenvio travado.
    expect(resendCooldown(agora + 60_000, agora)).toBe(0);
  });
});

describe("resendLabel", () => {
  it("mostra a contagem enquanto há espera", () => {
    expect(resendLabel(42)).toBe("Reenviar em 42s");
  });

  it("libera o texto quando a espera acaba", () => {
    expect(resendLabel(0)).toBe("Reenviar código");
  });
});

describe("textos por finalidade", () => {
  it("distingue confirmar cadastro de recuperar senha", () => {
    expect(otpTitle("signup")).not.toBe(otpTitle("recovery"));
    expect(otpInstruction("signup", "a@b.com")).toMatch(/ativar sua conta/);
    expect(otpInstruction("recovery", "a@b.com")).toMatch(/senha nova/);
  });

  it("põe o endereço na instrução, para conferir se está certo", () => {
    expect(otpInstruction("signup", "ana@exemplo.com")).toContain(
      "ana@exemplo.com",
    );
  });
});
