import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TTL_MS,
  attachmentKind,
  attachmentTimeLeft,
  formatBytes,
  isAttachmentExpired,
} from "./attachments";

const base = Date.parse("2026-08-29T12:00:00.000Z");

describe("attachmentKind", () => {
  it("separa o que o chat sabe exibir do que só dá para baixar", () => {
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("image/gif")).toBe("image");
    expect(attachmentKind("video/mp4")).toBe("video");
    expect(attachmentKind("audio/ogg")).toBe("audio");
    expect(attachmentKind("application/pdf")).toBe("file");
    expect(attachmentKind("")).toBe("file");
  });
});

describe("validade de um dia", () => {
  it("continua válido até o instante do vencimento", () => {
    expect(isAttachmentExpired(base, base + ATTACHMENT_TTL_MS - 1)).toBe(false);
  });

  it("vence exatamente em 24 h", () => {
    expect(isAttachmentExpired(base, base + ATTACHMENT_TTL_MS)).toBe(true);
  });

  it("aceita tanto ISO quanto epoch, que é o que chega da mensagem", () => {
    const iso = "2026-08-29T12:00:00.000Z";
    expect(isAttachmentExpired(iso, base + ATTACHMENT_TTL_MS + 1)).toBe(true);
    expect(isAttachmentExpired(iso, base)).toBe(false);
  });

  it("conta o tempo restante em horas e depois em minutos", () => {
    expect(attachmentTimeLeft(base, base)).toBe("24 h restantes");
    expect(attachmentTimeLeft(base, base + 23 * 3_600_000)).toBe(
      "1 h restantes",
    );
    expect(attachmentTimeLeft(base, base + 23.5 * 3_600_000)).toBe(
      "30 min restantes",
    );
    // Nunca "0 min": enquanto houver arquivo, sobra pelo menos um minuto.
    expect(attachmentTimeLeft(base, base + ATTACHMENT_TTL_MS - 1_000)).toBe(
      "1 min restantes",
    );
    expect(attachmentTimeLeft(base, base + ATTACHMENT_TTL_MS)).toBe("expirado");
  });
});

describe("formatBytes", () => {
  it("troca de unidade nos limites certos", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(ATTACHMENT_MAX_BYTES)).toBe("100.0 MB");
  });
});
