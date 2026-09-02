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

/**
 * O maior código que o servidor tem como mandar.
 *
 * `otp_length` aceita de 6 a 10 dígitos, e em produção ele mora no painel do
 * projeto — fora deste repositório, onde já divergiu do `config.toml`: o
 * servidor mandava oito dígitos enquanto o campo cortava em seis. O código
 * chegava inteiro no e-mail, era truncado antes de sair daqui, e o Supabase
 * respondia `otp_expired` — a mesma resposta de código vencido. Nada na tela
 * dizia que faltavam dois dígitos.
 *
 * Aceitar a faixa inteira faz o campo sobreviver a essa divergência. Conferir
 * o tamanho exato é de quem gerou o código, não de quem o digita.
 */
export const OTP_MAX_LENGTH = 10;

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
  return input.replace(/\D/g, "").slice(0, OTP_MAX_LENGTH);
}

/** O código está completo e pode ser enviado para conferência? */
export function isCompleteOtp(input: string): boolean {
  return normalizeOtp(input).length >= OTP_LENGTH;
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
    return `O código tem pelo menos ${OTP_LENGTH} dígitos.`;
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

/**
 * A frase que explica o que fazer, com o endereço no meio.
 *
 * Sem dizer quantos dígitos: quem decide isso é o `otp_length` do servidor, e
 * uma frase que promete seis enquanto chegam oito manda a pessoa desconfiar do
 * e-mail em vez da configuração.
 */
export function otpInstruction(purpose: OtpPurpose, email: string): string {
  return purpose === "signup"
    ? `Enviamos um código para ${email}. Digite abaixo para ativar sua conta.`
    : `Enviamos um código para ${email}. Digite abaixo para escolher uma senha nova.`;
}
