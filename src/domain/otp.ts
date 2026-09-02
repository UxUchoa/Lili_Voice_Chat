/**
 * Código de verificação por e-mail.
 *
 * O código é gerado, expirado e conferido pelo Supabase Auth; aqui mora só o
 * que a interface precisa saber para não fazer uma viagem inútil ao servidor —
 * formato, limpeza do que foi digitado e a espera entre reenvios.
 *
 * Nada disto substitui a checagem do servidor. Um código com o formato certo
 * continua sendo recusado lá se estiver errado ou vencido; o que estas regras
 * evitam é a pessoa esperar uma resposta de rede para descobrir que digitou
 * cinco dígitos.
 */

/** Quantos dígitos o Supabase manda. Espelha `otp_length` no config.toml. */
export const OTP_LENGTH = 6;

/** Segundos entre um envio e o próximo, espelhando o limite do servidor. */
export const OTP_RESEND_SECONDS = 60;

/**
 * Tira do que foi digitado tudo que não é dígito.
 *
 * Quem cola o código do e-mail costuma trazer espaço, hífen ou o texto em
 * volta. Recusar por causa disso seria implicância: o que importa são os
 * dígitos, na ordem em que vieram.
 */
export function normalizeOtp(input: string): string {
  return input.replace(/\D/g, "").slice(0, OTP_LENGTH);
}

/** O código está completo e pode ser enviado para conferência? */
export function isCompleteOtp(input: string): boolean {
  return normalizeOtp(input).length === OTP_LENGTH;
}

/**
 * Por que este código não pode ser enviado ainda.
 *
 * Devolve `undefined` quando está pronto. A mensagem é sobre o formato, nunca
 * sobre estar certo ou errado — só o servidor sabe disso.
 */
export function otpError(input: string): string | undefined {
  const digits = normalizeOtp(input);
  if (digits.length === 0) return "Digite o código que enviamos por e-mail.";
  if (digits.length < OTP_LENGTH)
    return `O código tem ${OTP_LENGTH} dígitos.`;
  return undefined;
}

/**
 * Segundos que ainda faltam para poder reenviar.
 *
 * `sentAt` é o instante do último envio, ou `undefined` quando nada foi
 * enviado ainda — aí não há espera nenhuma.
 */
export function resendCooldown(
  sentAt: number | undefined,
  now = Date.now(),
): number {
  if (!sentAt) return 0;
  const elapsed = Math.floor((now - sentAt) / 1000);
  // Relógio que andou para trás não pode prender o botão para sempre.
  if (elapsed < 0) return 0;
  return Math.max(0, OTP_RESEND_SECONDS - elapsed);
}

/** `Reenviar em 42s` ou `Reenviar`, conforme a espera. */
export function resendLabel(remaining: number): string {
  return remaining > 0 ? `Reenviar em ${remaining}s` : "Reenviar código";
}

/** O que o código faz quando confere — decide o texto e o passo seguinte. */
export type OtpPurpose = "signup" | "recovery";

/** Título da tela de código, por finalidade. */
export function otpTitle(purpose: OtpPurpose): string {
  return purpose === "signup"
    ? "Confirme seu e-mail"
    : "Recuperar a senha";
}

/** A frase que explica o que fazer, com o endereço no meio. */
export function otpInstruction(purpose: OtpPurpose, email: string): string {
  return purpose === "signup"
    ? `Enviamos um código de ${OTP_LENGTH} dígitos para ${email}. Digite abaixo para ativar sua conta.`
    : `Enviamos um código de ${OTP_LENGTH} dígitos para ${email}. Digite abaixo para escolher uma senha nova.`;
}
