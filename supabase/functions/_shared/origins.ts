/**
 * Decide quais origens podem chamar as funções de borda.
 *
 * Separado de `cors.ts` porque aquele módulo lê `Deno.env` no topo e não
 * carrega fora do runtime das funções — esta parte é a que precisa de teste.
 */

/** `"https://a.app, null , "` → `["https://a.app", "null"]`. */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Formatos aceitos:
 *   - origem exata      `https://lili.app`
 *   - subdomínio        `https://*.vercel.app`
 *   - `null`            Electron empacotado, que carrega `dist/` por file://
 */
export function originMatches(pattern: string, origin: string): boolean {
  if (pattern === origin) return true;
  const wildcard = /^(https?:\/\/)\*\.(.+)$/.exec(pattern);
  if (!wildcard) return false;
  const [, scheme, domain] = wildcard;
  if (!origin.startsWith(scheme)) return false;
  const host = origin.slice(scheme.length);
  // `*.vercel.app` cobre `abc.vercel.app` e não `vercel.app.attacker.com`.
  // A barra é recusada porque `https://a.vercel.app/x` não é uma origem, e
  // aceitá-la deixaria passar `https://attacker.com/.vercel.app`.
  return host.endsWith(`.${domain}`) && !host.includes("/");
}

export function findAllowedOrigin(
  patterns: string[],
  origin: string | null,
): string | null {
  if (!origin) return null;
  return patterns.some((pattern) => originMatches(pattern, origin))
    ? origin
    : null;
}
