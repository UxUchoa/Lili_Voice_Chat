import { describe, expect, it } from "vitest";
import { describeInvite, inviteCodeFrom, invitePage } from "./invite.js";

const preview = {
  server_name: "Servidor da Galera",
  server_icon_path: "3de744ce/icone.png",
  server_description: "onde a gente joga",
  channel_name: "geral",
  member_count: 12,
};

describe("inviteCodeFrom", () => {
  it("aceita o código da query, que é como a Vercel reescreve", async () => {
    expect(await inviteCodeFrom({ url: "/api/invite?code=AEA2WKTa5Aln" })).toBe(
      "AEA2WKTa5Aln",
    );
  });

  it("lê o código do caminho quando ele vem direto", async () => {
    expect(await inviteCodeFrom({ url: "/invite/AEA2WKTa5Aln" })).toBe(
      "AEA2WKTa5Aln",
    );
  });

  /**
   * O código entra numa chamada ao banco e num endereço; nenhum dos dois pode
   * receber texto arbitrário vindo da rua.
   */
  it("recusa qualquer coisa que não pareça um código", async () => {
    expect(await inviteCodeFrom({ url: "/invite/../../etc/passwd" })).toBe("");
    expect(await inviteCodeFrom({ url: "/api/invite?code=%3Cscript%3E" })).toBe(
      "",
    );
    expect(await inviteCodeFrom({ url: "/invite/" })).toBe("");
    // Um caminho que não é o do convite não vira código só por terminar bem.
    expect(await inviteCodeFrom({ url: "/qualquer/AEA2WKTa5Aln" })).toBe("");
  });
});

describe("describeInvite", () => {
  it("conta as pessoas e diz onde a conversa cai", () => {
    expect(describeInvite({ ...preview, server_description: "" })).toBe(
      "12 membros · entra em #geral",
    );
  });

  it("não escreve '1 membros'", () => {
    expect(
      describeInvite({ ...preview, member_count: 1, server_description: "" }),
    ).toBe("1 membro · entra em #geral");
  });

  it("junta a descrição do servidor quando existe", () => {
    expect(describeInvite(preview)).toBe(
      "12 membros · entra em #geral — onde a gente joga",
    );
  });
});

describe("invitePage", () => {
  const html = invitePage({
    code: "AEA2WKTa5Aln",
    preview,
    origin: "https://lili.example",
  });
  const meta = (name) =>
    (new RegExp(`<meta property="og:${name}" content="([^"]*)"`).exec(html) ??
      [])[1];

  /**
   * O cartão era sempre "Lili — Voice Chat" nas duas linhas, porque o
   * fragmento `#/invite/CODE` nunca chega ao servidor e todo convite pedia a
   * página inicial. É esta troca que o arquivo inteiro existe para fazer.
   */
  it("põe o servidor no lugar do nome do produto", () => {
    expect(meta("title")).toBe("Servidor da Galera");
    expect(meta("description")).toBe(
      "12 membros · entra em #geral — onde a gente joga",
    );
  });

  it("aponta a imagem para o intermediário, não para o balde privado", () => {
    expect(meta("image")).toBe(
      "https://lili.example/api/invite-icon?code=AEA2WKTa5Aln",
    );
  });

  it("manda a pessoa para dentro do aplicativo", () => {
    expect(html).toContain(
      'location.replace("https://lili.example/#/invite/AEA2WKTa5Aln")',
    );
    expect(html).toContain(
      'content="0; url=https://lili.example/#/invite/AEA2WKTa5Aln"',
    );
  });

  /**
   * O nome do servidor é escrito por quem criou o servidor, e sai numa página
   * HTML. Sem escapar, um nome com aspas fecharia o atributo e o resto viraria
   * marcação — numa página servida do nosso domínio.
   */
  it("escapa o nome do servidor em vez de confiar nele", () => {
    const page = invitePage({
      code: "AEA2WKTa5Aln",
      preview: {
        ...preview,
        server_name: '"><script>alert(1)</script>',
        server_description: "",
      },
      origin: "https://lili.example",
    });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&quot;&gt;&lt;script&gt;");
  });

  it("sem prévia, avisa que o convite não vale e mesmo assim abre o aplicativo", () => {
    const page = invitePage({
      code: "AEA2WKTa5Aln",
      preview: null,
      origin: "https://lili.example",
    });
    expect(page).toContain("Convite para o Lili");
    expect(page).toContain("Este convite não vale mais");
    expect(page).toContain("/#/invite/AEA2WKTa5Aln");
  });
});
