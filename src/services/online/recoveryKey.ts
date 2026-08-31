/**
 * A chave única que recupera o acesso.
 *
 * Ela substitui o link por e-mail. Isso é uma troca deliberada: e-mail exige
 * SMTP confiável, entrega ao provedor o mapa de quem usa o aplicativo e cria
 * um caminho de volta para dentro da conta que não passa pelo usuário. Aqui,
 * quem tem a chave entra; quem a perde perde a conta.
 *
 * O servidor guarda apenas o SHA-256 da chave normalizada. São 160 bits de
 * entropia: um hash rápido basta, porque não existe dicionário a atacar. E o
 * cadastro nunca transmite a chave — o hash é calculado aqui.
 */

/**
 * Alfabeto base32 de Crockford, sem `I`, `L`, `O` e `U`.
 *
 * As três primeiras somem porque se confundem com `1` e `0` quando alguém
 * copia a chave de um papel; `U` sai para que nenhuma chave sorteada vire
 * palavrão na mão do usuário.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 20 bytes = 160 bits = 32 caracteres exatos, sem sobra nem preenchimento. */
const KEY_BYTES = 20;
export const RECOVERY_KEY_LENGTH = 32;
const GROUP = 4;

/** Confusões que a pessoa comete ao transcrever, não variações válidas. */
const CONFUSIONS: Record<string, string> = {
  I: "1",
  L: "1",
  O: "0",
};

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

/** `AB12…` → `AB12-CD34-…`, oito grupos de quatro. */
export function formatRecoveryKey(key: string): string {
  return (key.match(new RegExp(`.{1,${GROUP}}`, "g")) ?? []).join("-");
}

/**
 * Aceita a chave como a pessoa a digitar: minúscula, sem hífen, com espaço
 * sobrando ou com o `O` que ela leu onde havia um zero.
 */
export function normalizeRecoveryKey(input: string): string {
  return [...input.toUpperCase()]
    .map((character) => CONFUSIONS[character] ?? character)
    .filter((character) => ALPHABET.includes(character))
    .join("");
}

export function isRecoveryKeyShaped(input: string): boolean {
  return normalizeRecoveryKey(input).length === RECOVERY_KEY_LENGTH;
}

/** Devolve a chave já agrupada, pronta para ser mostrada e copiada. */
export function generateRecoveryKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return formatRecoveryKey(encodeBase32(bytes));
}

/**
 * SHA-256 da chave normalizada, em base64url. É isto — e só isto — que sai
 * daqui para o servidor no cadastro.
 */
export async function hashRecoveryKey(key: string): Promise<string> {
  const normalized = normalizeRecoveryKey(key);
  if (normalized.length !== RECOVERY_KEY_LENGTH)
    throw new Error("A chave de recuperação precisa ter 32 caracteres.");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
