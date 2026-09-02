/**
 * Traduz os erros do Supabase Auth que o usuário realmente encontra.
 *
 * O texto original chega em inglês e no vocabulário do servidor de
 * autenticação — "email rate limit exceeded" não diz a ninguém que o problema
 * é temporário e não é culpa dele. Só o que tem tratamento conhecido é
 * traduzido; o resto passa como veio, porque inventar uma mensagem genérica
 * esconderia a informação de quem está depurando.
 *
 * Vive fora de `auth.ts` porque é função pura: lá dentro, importá-la arrastava
 * o cliente Supabase junto, e um teste que só confere texto passaria a exigir
 * uma instância configurada.
 */
export function humanizeAuthError(error: unknown): Error {
  const original = error instanceof Error ? error : new Error(String(error));
  const message = original.message.toLowerCase();

  if (message.includes("email rate limit exceeded"))
    return new Error(
      "O servidor de e-mail atingiu o limite de envios por hora. " +
        "Espere alguns minutos e tente de novo.",
    );
  if (
    message.includes("over_email_send_rate_limit") ||
    message.includes("for security purposes")
  )
    return new Error(
      "Muitos e-mails pedidos em sequência. Espere um minuto e tente de novo.",
    );
  if (message.includes("user already registered"))
    return new Error("Já existe uma conta com esse e-mail.");
  if (message.includes("invalid login credentials"))
    return new Error("E-mail ou senha não conferem.");
  if (message.includes("email not confirmed"))
    return new Error(
      "Confirme o e-mail antes de entrar. Se o código não chegou, peça o reenvio.",
    );
  // O Supabase usa a mesma resposta para código errado e código vencido, de
  // propósito: separar os dois diria a quem está tentando adivinhar que o
  // número existia. A mensagem mantém a ambiguidade e oferece a saída.
  if (
    message.includes("token has expired or is invalid") ||
    message.includes("otp_expired") ||
    message.includes("invalid or expired") ||
    message.includes("token not found")
  )
    return new Error(
      "O código não confere ou já expirou. Peça um novo e tente de novo.",
    );
  if (message.includes("password should be at least"))
    return new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (message.includes("user is banned"))
    return new Error("Esta conta foi encerrada por inatividade.");
  return original;
}
