/**
 * Menções — item 5.
 *
 * A resolução de quem é notificado já existia em `useOnlineMessages`, que casa
 * `@username` para pessoas e `@Cargo` para cargos e ainda expande `@here` para
 * quem está online. O que faltava era a interface: nada abria a lista ao digitar
 * `@`, e a menção chegava na tela como texto cru.
 *
 * Este módulo é a parte que faltava — sugestão, inserção e destaque — e é também
 * o dono do casamento, que o hook passa a importar daqui. Duas expressões
 * regulares para a mesma pergunta acabariam destacando uma menção que não
 * notifica ninguém, ou o contrário.
 *
 * O corpo guarda o texto literal (`@fulano`). Guardar só o id (`<@uuid>`)
 * sobreviveria a uma troca de nome, mas quebraria a busca, a edição e a citação,
 * que hoje trabalham direto sobre o corpo — e mudaria o formato de tudo que já
 * está gravado.
 */

/** Alguém ou algum cargo que pode ser mencionado. */
export interface MentionTarget {
  id: string;
  /**
   * O que vai depois do `@` no texto da mensagem.
   *
   * Para pessoas é o `username`, e não o nome de exibição: é isso que a
   * resolução do envio procura. Inserir o nome de exibição deixaria a menção
   * bonita na tela e sem notificar ninguém.
   */
  token: string;
  /** Como aparece na lista de sugestões e no destaque. */
  label: string;
  kind: "user" | "role";
  /** Segunda linha da sugestão — o `@username`, para pessoas. */
  hint?: string;
  /** Cargo com menção desligada aparece na lista, mas não notifica. */
  mentionable?: boolean;
  /**
   * É a própria pessoa que está lendo.
   *
   * Ela precisa estar na lista para que o `@fulano` que alguém escreveu para
   * ela seja destacado — sem isso, a única menção que a pessoa mais quer ver
   * chegava como texto cru, mesmo tendo notificado. Fica de fora só das
   * sugestões, onde oferecer a si mesmo não serve para nada.
   */
  self?: boolean;
}

/** As duas menções de alcance amplo, que não são pessoa nem cargo. */
export const BROADCAST_MENTIONS = ["everyone", "here"] as const;

/**
 * Um nome de cargo pode ter espaço ("Time de Suporte"), então a busca em curso
 * aceita até três palavras. Parar na primeira impediria de achá-lo; aceitar até
 * o fim da linha manteria a lista aberta pela mensagem inteira.
 */
const QUERY_MAX_WORDS = 3;

const escapeRegExp = (value: string) =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * O `@token` aparece no texto como menção de verdade?
 *
 * Exige espaço (ou início) antes, e espaço, pontuação ou fim depois. É o que
 * separa `@ana` de `fulano@ana` e de `@anabela`.
 */
export function containsMention(text: string, token: string): boolean {
  return new RegExp(
    `(?:^|\\s)@${escapeRegExp(token)}(?=$|\\s|[.,!?;:])`,
    "i",
  ).test(text);
}

/**
 * Trecho que está sendo digitado agora, para abrir a lista de sugestões.
 *
 * Devolve `undefined` quando o cursor não está logo depois de um `@` — inclusive
 * quando o `@` faz parte de um e-mail (`fulano@dominio`), onde sugerir menção só
 * atrapalharia quem escreve um endereço.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { query: string; start: number } | undefined {
  const upToCaret = text.slice(0, caret);
  const at = upToCaret.lastIndexOf("@");
  if (at < 0) return undefined;
  // A mesma fronteira do casamento: sem espaço antes, é e-mail ou handle.
  if (at > 0 && !/\s/.test(upToCaret[at - 1])) return undefined;
  const query = upToCaret.slice(at + 1);
  if (/\n/.test(query)) return undefined;
  if (query.split(" ").length > QUERY_MAX_WORDS) return undefined;
  return { query, start: at };
}

/** Troca o `@trecho` em curso pelo alvo escolhido, e deixa o cursor depois. */
export function applyMention(
  text: string,
  caret: number,
  target: Pick<MentionTarget, "token">,
): { text: string; caret: number } {
  const active = activeMentionQuery(text, caret);
  if (!active) return { text, caret };
  const inserted = `@${target.token} `;
  const next = text.slice(0, active.start) + inserted + text.slice(caret);
  return { text: next, caret: active.start + inserted.length };
}

/**
 * A menção já está pronta — não há mais o que sugerir.
 *
 * O trecho em curso aceita espaço porque um cargo pode se chamar "Time de
 * Suporte"; sem isso, a lista fechava na primeira tecla de espaço e o cargo
 * ficava inalcançável. O efeito colateral era este: depois de escolher alguém,
 * `applyMention` deixa `@fulano ` com o cursor no fim, e o trecho "fulano "
 * continuava sendo uma busca em curso. A lista reabria sozinha, com a mesma
 * pessoa que acabou de ser escolhida.
 *
 * Para quem estava escrevendo, isso significava não ter sinal nenhum de que a
 * menção pegou: escolher não mudava nada na tela — o mesmo nome continuava
 * flutuando ali, agora sugerindo o que já tinha sido feito. E o texto inserido
 * é o `username`, que nem sempre é o nome que a lista mostra ("itozo" na
 * lista, `@ito` no campo), então nem o campo confirmava a escolha.
 *
 * A regra é o espaço no fim: `@fulano` ainda pode virar `@fulaninho`, mas
 * `@fulano ` é uma menção fechada. Um cargo de várias palavras não se fecha por
 * engano porque "Time de " não é o nome de ninguém.
 */
export function mentionIsComplete(
  query: string,
  targets: MentionTarget[],
): boolean {
  // Sem o espaço no fim ainda se está digitando, e a lista tem que ficar.
  if (!/\s$/.test(query)) return false;
  const settled = query.trim().toLowerCase();
  if (!settled) return false;
  return (
    BROADCAST_MENTIONS.some((name) => name === settled) ||
    targets.some((target) => target.token.toLowerCase() === settled)
  );
}

/** Sugestões para o trecho digitado, com os prefixos antes dos miolos. */
export function suggestMentions(
  query: string,
  targets: MentionTarget[],
  limit = 8,
): MentionTarget[] {
  // Uma menção fechada não abre lista: é aqui que a escolha vira silêncio na
  // tela, que é o único sinal de "pronto" que o campo de texto sabe dar.
  if (mentionIsComplete(query, targets)) return [];
  const needle = query.trim().toLowerCase();
  // A pessoa não se sugere; ela está na lista pelo destaque, não pela busca.
  const offered = targets.filter((target) => !target.self);
  const fieldsOf = (target: MentionTarget) =>
    [target.token, target.label, target.hint ?? ""].map((value) =>
      value.toLowerCase(),
    );
  return offered
    .map((target, index) => ({ target, index, fields: fieldsOf(target) }))
    .filter(
      (entry) => !needle || entry.fields.some((value) => value.includes(needle)),
    )
    .sort((a, b) => {
      // Quem começa com o que foi digitado vem antes de quem só contém.
      const rank = (entry: { fields: string[] }) =>
        !needle || entry.fields.some((value) => value.startsWith(needle))
          ? 0
          : 1;
      return rank(a) - rank(b) || a.index - b.index;
    })
    .slice(0, limit)
    .map((entry) => entry.target);
}

export type MentionSegment =
  | { type: "text"; value: string }
  | {
      type: "mention";
      /** O texto original, para reconstruir a mensagem sem perdas. */
      value: string;
      /** O que aparece na tela — nome de exibição, e não o `username`. */
      label: string;
      kind: "user" | "role" | "broadcast";
      id?: string;
      /** A menção é de quem está lendo, para o destaque próprio. */
      self?: boolean;
    };

/**
 * Alvos do token mais longo para o mais curto: com "ana" e "anapaula" na
 * lista, casar o curto primeiro deixaria "paula" como sobra solta.
 *
 * O resultado fica em cache pela identidade do array. `segmentMentions` roda
 * uma vez por trecho de texto de cada mensagem, a cada render — reordenar a
 * lista inteira de membros em toda chamada era trabalho repetido para sempre
 * chegar ao mesmo resultado. O `WeakMap` não segura o array na memória, e
 * `useMentionTargets` já devolve a mesma referência entre renders.
 */
const byTokenLengthCache = new WeakMap<MentionTarget[], MentionTarget[]>();

function byTokenLength(targets: MentionTarget[]): MentionTarget[] {
  const cached = byTokenLengthCache.get(targets);
  if (cached) return cached;
  const sorted = [...targets].sort((a, b) => b.token.length - a.token.length);
  byTokenLengthCache.set(targets, sorted);
  return sorted;
}

/**
 * Quebra o texto em partes comuns e menções, para a renderização destacar cada
 * uma sem `dangerouslySetInnerHTML`.
 *
 * Um `@` que não casa com ninguém volta como texto puro: destacar de todo jeito
 * faria `@qualquercoisa` parecer que notifica alguém.
 */
export function segmentMentions(
  text: string,
  targets: MentionTarget[],
): MentionSegment[] {
  const byLength = byTokenLength(targets);
  const segments: MentionSegment[] = [];
  let buffer = "";
  let index = 0;

  const flush = () => {
    if (buffer) segments.push({ type: "text", value: buffer });
    buffer = "";
  };
  /** Mesma fronteira de `containsMention`: espaço, pontuação ou fim. */
  const closes = (rest: string, length: number) => {
    const after = rest[length];
    return after === undefined || /[\s.,!?;:]/.test(after);
  };

  while (index < text.length) {
    const char = text[index];
    const opens = index === 0 || /\s/.test(text[index - 1]);
    if (char !== "@" || !opens) {
      buffer += char;
      index += 1;
      continue;
    }

    const rest = text.slice(index + 1);
    const lower = rest.toLowerCase();
    const broadcast = BROADCAST_MENTIONS.find(
      (name) => lower.startsWith(name) && closes(rest, name.length),
    );
    if (broadcast) {
      flush();
      segments.push({
        type: "mention",
        value: `@${rest.slice(0, broadcast.length)}`,
        label: `@${broadcast}`,
        kind: "broadcast",
      });
      index += 1 + broadcast.length;
      continue;
    }

    const target = byLength.find(
      (candidate) =>
        lower.startsWith(candidate.token.toLowerCase()) &&
        closes(rest, candidate.token.length),
    );
    if (!target) {
      buffer += char;
      index += 1;
      continue;
    }

    flush();
    segments.push({
      type: "mention",
      value: `@${rest.slice(0, target.token.length)}`,
      label: `@${target.label}`,
      kind: target.kind,
      id: target.id,
      self: target.self,
    });
    index += 1 + target.token.length;
  }

  flush();
  return segments;
}
