import { describe, expect, it } from "vitest";
import {
  activeMentionQuery,
  applyMention,
  containsMention,
  segmentMentions,
  suggestMentions,
  type MentionTarget,
} from "./mentions";

const targets: MentionTarget[] = [
  { id: "u1", token: "ana", label: "Ana", kind: "user", hint: "@ana" },
  {
    id: "u2",
    token: "anapaula",
    label: "Ana Paula",
    kind: "user",
    hint: "@anapaula",
  },
  { id: "u3", token: "bruno", label: "Bruno", kind: "user", hint: "@bruno" },
  {
    id: "eu",
    token: "trauts",
    label: "Trauts",
    kind: "user",
    hint: "@trauts",
    self: true,
  },
  { id: "r1", token: "Moderação", label: "Moderação", kind: "role", mentionable: true },
  {
    id: "r2",
    token: "Time de Suporte",
    label: "Time de Suporte",
    kind: "role",
    mentionable: false,
  },
];

describe("containsMention", () => {
  it("casa a menção isolada", () => {
    expect(containsMention("oi @ana", "ana")).toBe(true);
    expect(containsMention("oi @ana, tudo bem?", "ana")).toBe(true);
  });

  it("não casa o @ colado em outra palavra", () => {
    expect(containsMention("fulano@ana", "ana")).toBe(false);
  });

  it("não casa quando o token é só prefixo", () => {
    expect(containsMention("@anabela", "ana")).toBe(false);
  });

  it("ignora maiúsculas e aceita nome com espaço", () => {
    expect(containsMention("chama a @MODERAÇÃO", "Moderação")).toBe(true);
    expect(containsMention("@Time de Suporte ajuda", "Time de Suporte")).toBe(
      true,
    );
  });
});

describe("activeMentionQuery", () => {
  it("abre a lista assim que o @ é digitado", () => {
    expect(activeMentionQuery("oi @", 4)).toEqual({ query: "", start: 3 });
  });

  it("acompanha o trecho digitado depois do @", () => {
    expect(activeMentionQuery("oi @an", 6)).toEqual({ query: "an", start: 3 });
  });

  it("ignora o @ de um e-mail", () => {
    expect(activeMentionQuery("fulano@dominio", 14)).toBeUndefined();
  });

  it("desiste quando o texto já passou de um nome plausível", () => {
    expect(activeMentionQuery("@um dois tres quatro", 20)).toBeUndefined();
  });

  it("desiste na quebra de linha", () => {
    expect(activeMentionQuery("@ana\noutra linha", 16)).toBeUndefined();
  });

  it("usa o @ mais próximo do cursor, e não o primeiro da mensagem", () => {
    expect(activeMentionQuery("@ana e @bru", 11)).toEqual({
      query: "bru",
      start: 7,
    });
  });
});

describe("applyMention", () => {
  it("insere o token e deixa um espaço depois", () => {
    // O que entra no texto é o username, porque é o que a resolução procura.
    expect(applyMention("oi @an", 6, { token: "anapaula" })).toEqual({
      text: "oi @anapaula ",
      caret: 13,
    });
  });

  it("preserva o que vinha depois do cursor", () => {
    expect(applyMention("oi @an, tudo bem?", 6, { token: "ana" })).toEqual({
      text: "oi @ana , tudo bem?",
      caret: 8,
    });
  });

  it("não mexe no texto quando não há menção em curso", () => {
    expect(applyMention("sem arroba aqui", 5, { token: "ana" })).toEqual({
      text: "sem arroba aqui",
      caret: 5,
    });
  });

  it("o texto resultante é reconhecido pelo casamento do envio", () => {
    // A garantia que importa: o que a lista insere é o que notifica.
    const { text } = applyMention("oi @an", 6, { token: "anapaula" });
    expect(containsMention(text, "anapaula")).toBe(true);
  });
});

describe("suggestMentions", () => {
  it("lista todo mundo enquanto nada foi digitado", () => {
    expect(suggestMentions("", targets)).toHaveLength(targets.length - 1);
  });

  it("não oferece a própria pessoa", () => {
    expect(suggestMentions("trauts", targets)).toEqual([]);
  });

  it("põe quem começa com o trecho antes de quem só contém", () => {
    expect(suggestMentions("an", targets).map((item) => item.id).slice(0, 2)).toEqual(
      ["u1", "u2"],
    );
  });

  it("casa também pelo nome de exibição", () => {
    expect(suggestMentions("Ana P", targets).map((item) => item.id)).toEqual([
      "u2",
    ]);
  });

  it("respeita o limite pedido", () => {
    expect(suggestMentions("", targets, 2)).toHaveLength(2);
  });
});

describe("segmentMentions", () => {
  it("separa texto de menção e mostra o nome de exibição", () => {
    expect(segmentMentions("oi @ana tudo bem", targets)).toEqual([
      { type: "text", value: "oi " },
      { type: "mention", value: "@ana", label: "@Ana", kind: "user", id: "u1" },
      { type: "text", value: " tudo bem" },
    ]);
  });

  it("prefere o token mais longo", () => {
    // Casar "ana" primeiro deixaria "paula" como sobra solta.
    expect(
      segmentMentions("@anapaula chegou", targets)[0],
    ).toMatchObject({ id: "u2", label: "@Ana Paula" });
  });

  it("deixa como texto o @ que não casa com ninguém", () => {
    expect(segmentMentions("@ninguem", targets)).toEqual([
      { type: "text", value: "@ninguem" },
    ]);
  });

  it("não destaca o @ colado em e-mail", () => {
    expect(segmentMentions("fulano@ana", targets)).toEqual([
      { type: "text", value: "fulano@ana" },
    ]);
  });

  it("destaca a menção a quem está lendo, e a marca como própria", () => {
    expect(segmentMentions("oi @trauts", targets)).toEqual([
      { type: "text", value: "oi " },
      {
        type: "mention",
        value: "@trauts",
        label: "@Trauts",
        kind: "user",
        id: "eu",
        self: true,
      },
    ]);
  });

  it("marca everyone como alcance amplo", () => {
    expect(segmentMentions("@everyone!", targets)).toEqual([
      {
        type: "mention",
        value: "@everyone",
        label: "@everyone",
        kind: "broadcast",
      },
      { type: "text", value: "!" },
    ]);
  });

  it("reconstrói o texto original ao juntar os pedaços", () => {
    // Sem isso, uma mensagem editada perderia o que o destaque não soube ler.
    const texto = "oi @ana, fale com @Moderação ou fulano@ana e @everyone";
    const juntado = segmentMentions(texto, targets)
      .map((segment) => segment.value)
      .join("");
    expect(juntado).toBe(texto);
  });

  it("concorda com o casamento do envio em cada menção destacada", () => {
    const texto = "oi @ana e @Moderação";
    for (const segment of segmentMentions(texto, targets)) {
      if (segment.type !== "mention" || segment.kind === "broadcast") continue;
      const target = targets.find((item) => item.id === segment.id)!;
      expect(containsMention(texto, target.token)).toBe(true);
    }
  });
});

describe("cache de ordenação", () => {
  it("não deixa o cache atrapalhar quando a lista muda de conteúdo", () => {
    // O cache é pela identidade do array; uma lista nova tem que ser reordenada
    // do zero, senão um membro recém-chegado nunca seria destacado.
    const antes: MentionTarget[] = [
      { id: "u1", token: "ana", label: "Ana", kind: "user" },
    ];
    expect(segmentMentions("@anapaula", antes)).toEqual([
      { type: "text", value: "@anapaula" },
    ]);
    const depois: MentionTarget[] = [
      ...antes,
      { id: "u2", token: "anapaula", label: "Ana Paula", kind: "user" },
    ];
    expect(segmentMentions("@anapaula", depois)[0]).toMatchObject({
      id: "u2",
    });
  });

  it("devolve o mesmo resultado quando chamado de novo com a mesma lista", () => {
    const alvos: MentionTarget[] = [
      { id: "u1", token: "ana", label: "Ana", kind: "user" },
      { id: "u2", token: "anapaula", label: "Ana Paula", kind: "user" },
    ];
    const primeira = segmentMentions("oi @anapaula", alvos);
    expect(segmentMentions("oi @anapaula", alvos)).toEqual(primeira);
  });
});
