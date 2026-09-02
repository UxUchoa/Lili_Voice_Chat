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
/**
 * O provedor de e-mail recusou o envio?
 *
 * É a única falha aqui que não é sobre o que a pessoa digitou: a conta existe,
 * o código foi gerado e só a mensagem não saiu. Quem chama trata diferente —
 * mandar de volta ao formulário faz a pessoa tentar de novo, e cada tentativa
 * gera outro código, cancelando o que talvez ainda esteja a caminho.
 */
export function isEmailDeliveryFailure(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return (
    message.includes("error sending confirmation email") ||
    message.includes("error sending recovery email") ||
    message.includes("error sending email") ||
    message.includes("error sending magic link email")
  );
}

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
  // O provedor de e-mail recusou o envio. O Supabase responde 500 e a conta
  // fica criada, porém sem confirmação — e, pior, o pedido regenera o código:
  // o que já estava na caixa de entrada para de valer. Sem esta tradução a
  // pessoa lia "Error sending confirmation email" e concluía que o código
  // recebido tinha vencido em segundos.
  if (isEmailDeliveryFailure(original))
    return new Error(
      "A conta existe, mas o servidor de e-mail recusou o envio do código. " +
        "Tente o reenvio em alguns minutos — e use sempre o código mais " +
        "recente, porque cada pedido cancela o anterior.",
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
      "O código não confere ou já expirou. Se você pediu outro, use o mais " +
        "recente: cada pedido cancela o código anterior. Peça um novo e " +
        "tente de novo.",
    );
  if (message.includes("password should be at least"))
    return new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (message.includes("user is banned"))
    return new Error("Esta conta foi encerrada por inatividade.");
  return original;
}
