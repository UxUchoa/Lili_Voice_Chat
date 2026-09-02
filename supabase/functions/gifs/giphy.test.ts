import { describe, expect, it } from "vitest";
import {
  GIF_MAX_LIMIT,
  clampLimit,
  giphyUrl,
  isGifMode,
  pickFull,
  pickPreview,
  toGifCategories,
  toGifResult,
  toGifResults,
  type GiphyItem,
} from "./giphy.ts";

const MB = 1024 * 1024;
const CAP = 30 * MB;

const rendition = (url: string, size: number, width = 200, height = 150) => ({
  url,
  size: String(size),
  width: String(width),
  height: String(height),
});

const item = (over: Partial<GiphyItem> = {}): GiphyItem => ({
  id: "abc123",
  alt_text: "gato caindo do sofá",
  title: "Canal do Gato",
  images: {
    original: rendition("https://giphy/original.gif", 4 * MB, 480, 270),
    downsized: rendition("https://giphy/downsized.gif", 1 * MB),
    fixed_width_small: rendition("https://giphy/small.gif", 120_000, 100, 75),
  },
  ...over,
});

describe("pickFull", () => {
  it("prefere o original, que é a qualidade vista no seletor", () => {
    expect(pickFull(item().images, CAP)?.url).toBe(
      "https://giphy/original.gif",
    );
  });

  it("cai para uma variante menor quando o original passa do teto", () => {
    // Sem isto um GIF grande simplesmente sumiria da busca.
    const grande = item({
      images: {
        original: rendition("https://giphy/original.gif", 60 * MB),
        downsized_medium: rendition("https://giphy/medium.gif", 8 * MB),
        downsized: rendition("https://giphy/downsized.gif", 1 * MB),
      },
    });
    expect(pickFull(grande.images, CAP)?.url).toBe("https://giphy/medium.gif");
  });

  it("devolve indefinido quando nenhuma variante cabe", () => {
    const enorme = item({
      images: { original: rendition("https://giphy/o.gif", 90 * MB) },
    });
    expect(pickFull(enorme.images, CAP)).toBeUndefined();
  });

  it("aceita variante sem tamanho legível em vez de descartá-la", () => {
    // O tamanho real ainda é conferido na hora de baixar; recusar por falta de
    // metadado jogaria fora GIFs válidos.
    const semTamanho = item({
      images: { original: { url: "https://giphy/o.gif" } },
    });
    expect(pickFull(semTamanho.images, CAP)?.url).toBe("https://giphy/o.gif");
  });

  it("ignora variante sem URL", () => {
    const quebrado = item({
      images: {
        original: { size: "100" },
        downsized: rendition("https://giphy/d.gif", 1 * MB),
      },
    });
    expect(pickFull(quebrado.images, CAP)?.url).toBe("https://giphy/d.gif");
  });

  it("não estoura quando não vem imagem nenhuma", () => {
    expect(pickFull(undefined, CAP)).toBeUndefined();
  });
});

describe("pickPreview", () => {
  it("escolhe a variante leve, porque a grade mostra dezenas de uma vez", () => {
    expect(pickPreview(item().images)?.url).toBe("https://giphy/small.gif");
  });

  it("cai para o que houver quando não existe variante pequena", () => {
    const item2 = item({
      images: { original: rendition("https://giphy/o.gif", 2 * MB) },
    });
    expect(pickPreview(item2.images)?.url).toBe("https://giphy/o.gif");
  });
});

describe("toGifResult", () => {
  it("descreve pelo alt_text, e não pelo título do canal", () => {
    // Para quem usa leitor de tela a diferença é tudo.
    expect(toGifResult(item(), CAP)?.description).toBe("gato caindo do sofá");
  });

  it("cai no título quando não há alt_text", () => {
    expect(
      toGifResult(item({ alt_text: "  " }), CAP)?.description,
    ).toBe("Canal do Gato");
  });

  it("usa um rótulo genérico quando não há nem título", () => {
    expect(
      toGifResult(item({ alt_text: undefined, title: undefined }), CAP)
        ?.description,
    ).toBe("GIF");
  });

  it("converte as dimensões e o tamanho, que chegam como texto", () => {
    expect(toGifResult(item(), CAP)).toMatchObject({
      id: "abc123",
      url: "https://giphy/original.gif",
      previewUrl: "https://giphy/small.gif",
      width: 480,
      height: 270,
      bytes: 4 * MB,
    });
  });

  it("descarta item sem id", () => {
    expect(toGifResult(item({ id: undefined }), CAP)).toBeNull();
  });

  it("descarta item cujo arquivo não cabe no chat", () => {
    const enorme = item({
      images: { original: rendition("https://giphy/o.gif", 90 * MB) },
    });
    expect(toGifResult(enorme, CAP)).toBeNull();
  });
});

describe("toGifResults", () => {
  it("mantém só o que serve, sem deixar buraco na lista", () => {
    const payload = {
      data: [
        item(),
        item({ id: undefined }),
        item({
          id: "grande",
          images: { original: rendition("https://giphy/x.gif", 90 * MB) },
        }),
      ],
    };
    expect(toGifResults(payload, CAP).map((gif) => gif.id)).toEqual(["abc123"]);
  });

  it("aguenta resposta vazia ou malformada", () => {
    expect(toGifResults(undefined, CAP)).toEqual([]);
    expect(toGifResults({}, CAP)).toEqual([]);
  });
});

describe("toGifCategories", () => {
  it("usa name_encoded como termo de busca", () => {
    // É o termo que a busca do Giphy espera receber de volta.
    const payload = {
      data: [
        {
          name: "Reações",
          name_encoded: "reactions",
          gif: { images: { fixed_width_small: rendition("https://g/c.gif", 1) } },
        },
      ],
    };
    expect(toGifCategories(payload)).toEqual([
      {
        searchTerm: "reactions",
        label: "Reações",
        imageUrl: "https://g/c.gif",
      },
    ]);
  });

  it("cai no rótulo quando não há name_encoded", () => {
    expect(
      toGifCategories({ data: [{ name: "Memes" }] })[0].searchTerm,
    ).toBe("Memes");
  });

  it("descarta categoria sem nome, que viraria um botão vazio", () => {
    expect(toGifCategories({ data: [{ name: "  " }, {}] })).toEqual([]);
  });
});

describe("isGifMode", () => {
  it("aceita só os três modos conhecidos", () => {
    expect(isGifMode("search")).toBe(true);
    expect(isGifMode("trending")).toBe(true);
    expect(isGifMode("categories")).toBe(true);
    expect(isGifMode("random")).toBe(false);
    expect(isGifMode(undefined)).toBe(false);
  });
});

describe("clampLimit", () => {
  it("segura o teto para o proxy não virar raspador de catálogo", () => {
    expect(clampLimit(500)).toBe(GIF_MAX_LIMIT);
  });

  it("usa o padrão para valor ausente ou inválido", () => {
    expect(clampLimit(undefined)).toBe(30);
    expect(clampLimit("abc")).toBe(30);
    expect(clampLimit(0)).toBe(30);
    expect(clampLimit(-5)).toBe(30);
  });

  it("respeita um limite menor pedido pelo cliente", () => {
    expect(clampLimit(12)).toBe(12);
  });
});

describe("giphyUrl", () => {
  it("põe a chave e o filtro de conteúdo na busca", () => {
    const url = new URL(
      giphyUrl("search", { apiKey: "K", query: "gato", limit: 12 }),
    );
    expect(url.pathname).toBe("/v1/gifs/search");
    expect(url.searchParams.get("api_key")).toBe("K");
    expect(url.searchParams.get("q")).toBe("gato");
    expect(url.searchParams.get("limit")).toBe("12");
    expect(url.searchParams.get("rating")).toBe("pg-13");
  });

  it("não manda q em trending", () => {
    const url = new URL(giphyUrl("trending", { apiKey: "K", limit: 30 }));
    expect(url.pathname).toBe("/v1/gifs/trending");
    expect(url.searchParams.has("q")).toBe(false);
  });

  it("categorias não levam limite nem rating", () => {
    const url = new URL(giphyUrl("categories", { apiKey: "K" }));
    expect(url.pathname).toBe("/v1/gifs/categories");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("rating")).toBe(false);
  });

  it("escapa o termo em vez de concatenar cru na URL", () => {
    const url = new URL(
      giphyUrl("search", { apiKey: "K", query: "a&b=c gato" }),
    );
    expect(url.searchParams.get("q")).toBe("a&b=c gato");
  });
});
