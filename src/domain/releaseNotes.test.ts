import { describe, expect, it } from "vitest";
import {
  htmlNotesToMarkdown,
  looksLikeHtmlNotes,
  normalizeReleaseNotes,
} from "./releaseNotes";

/**
 * O HTML que o GitHub entrega, recortado do que apareceu na tela do usuário.
 *
 * Foi assim, com as etiquetas à mostra, que a tela de novidades da 0.2.1 saiu:
 * o `electron-updater` lê o feed Atom, o `<content>` de lá é o corpo da release
 * já convertido, e o painel só sabia Markdown.
 */
const DO_GITHUB = `<h3>Correções</h3>
<ul>
<li><strong>GIFs e imagens não apareciam no chat aberto durante a chamada.</strong> A mensagem<br>
chegava, a legenda aparecia e a mídia não &mdash; e ela voltava inteira assim que<br>
você saía da chamada.</li>
<li><strong>A voz chegava duplicada.</strong> Ligar o microfone leva um tempo &#8212; o filtro de<br>
ruído precisa carregar.</li>
</ul>`;

describe("looksLikeHtmlNotes", () => {
  it("reconhece o HTML do GitHub", () => {
    expect(looksLikeHtmlNotes(DO_GITHUB)).toBe(true);
  });

  it("deixa o Markdown do changelog em paz", () => {
    expect(looksLikeHtmlNotes("### Correções\n\n- **Algo.** Explicação.")).toBe(
      false,
    );
  });

  /**
   * O changelog fala de `<video>`, de `file://` e compara números com `<`. Um
   * `<` solto não pode fazer o texto inteiro ser tratado como marcação — seria
   * trocar um defeito visível por outro pior, que come pedaços do texto.
   */
  it("não confunde um sinal de menor com etiqueta", () => {
    expect(looksLikeHtmlNotes("o elemento <video> é mudo de propósito")).toBe(
      false,
    );
    expect(looksLikeHtmlNotes("quando encode < 16 ms, cabe em 60 fps")).toBe(
      false,
    );
  });
});

describe("htmlNotesToMarkdown", () => {
  const convertido = htmlNotesToMarkdown(DO_GITHUB);

  it("vira o Markdown que o painel já sabe desenhar", () => {
    expect(convertido).toBe(
      [
        "### Correções",
        "",
        "- **GIFs e imagens não apareciam no chat aberto durante a chamada.** A mensagem chegava, a legenda aparecia e a mídia não — e ela voltava inteira assim que você saía da chamada.",
        "- **A voz chegava duplicada.** Ligar o microfone leva um tempo — o filtro de ruído precisa carregar.",
      ].join("\n"),
    );
  });

  it("não deixa etiqueta nenhuma para trás", () => {
    expect(convertido).not.toMatch(/<[a-z/]/i);
  });

  /**
   * `<br>` existe aqui porque o changelog quebra em 80 colunas e o GitHub
   * preserva a quebra. Virar linha nova partiria cada item em vários itens.
   */
  it("emenda as quebras de 80 colunas em vez de partir o item", () => {
    expect(htmlNotesToMarkdown("<ul><li>uma<br>frase só</li></ul>")).toBe(
      "- uma frase só",
    );
  });

  it("traduz código e mantém o endereço de um link", () => {
    expect(htmlNotesToMarkdown("<p>use <code>npm test</code> antes</p>")).toBe(
      "use `npm test` antes",
    );
    expect(
      htmlNotesToMarkdown('<p>veja <a href="https://a.b/c">as notas</a></p>'),
    ).toBe("veja as notas (https://a.b/c)");
  });

  it("não repete o endereço quando o texto do link já é ele", () => {
    expect(
      htmlNotesToMarkdown('<p><a href="https://a.b/c">https://a.b/c</a></p>'),
    ).toBe("https://a.b/c");
  });

  /**
   * Decodificar antes de tirar as etiquetas transformaria um `&lt;h3&gt;`
   * escrito de propósito numa etiqueta de verdade — que a limpeza seguinte
   * apagaria, comendo o texto que a pessoa quis mostrar.
   */
  it("preserva uma etiqueta que estava escapada no texto", () => {
    expect(htmlNotesToMarkdown("<p>escreva &lt;h3&gt; assim</p>")).toBe(
      "escreva <h3> assim",
    );
  });

  it("entende entidade numérica, decimal e hexadecimal", () => {
    expect(htmlNotesToMarkdown("<p>&#8212;&#x2014;&amp;</p>")).toBe("——&");
  });

  it("não deixa linha em branco sobrando entre os blocos", () => {
    expect(htmlNotesToMarkdown("<h3>A</h3><ul><li>b</li></ul>")).toBe(
      "### A\n\n- b",
    );
  });
});

describe("normalizeReleaseNotes", () => {
  it("devolve o Markdown do changelog sem tocar", () => {
    const markdown =
      "### Correções\n\n- **Algo.** Explicação em duas\n  linhas.";
    expect(normalizeReleaseNotes(markdown)).toBe(markdown);
  });

  it("converte quando vem do feed do GitHub", () => {
    expect(normalizeReleaseNotes(DO_GITHUB)).toContain("### Correções");
    expect(normalizeReleaseNotes(DO_GITHUB)).not.toContain("<li>");
  });
});
