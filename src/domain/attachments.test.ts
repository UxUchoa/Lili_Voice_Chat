import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_LABEL,
  attachmentSizeError,
  partitionBySize,
} from "./attachments";

const file = (name: string, size: number) => ({ name, size });

describe("limite de anexo", () => {
  it("é de 30 MB", () => {
    expect(ATTACHMENT_MAX_BYTES).toBe(30 * 1024 * 1024);
    expect(ATTACHMENT_MAX_LABEL).toBe("30 MB");
  });

  it("aceita exatamente o teto", () => {
    expect(attachmentSizeError(file("a.png", ATTACHMENT_MAX_BYTES))).toBeUndefined();
  });

  it("recusa um byte além do teto, dizendo o limite", () => {
    expect(attachmentSizeError(file("filme.mp4", ATTACHMENT_MAX_BYTES + 1))).toBe(
      "filme.mp4 não foi anexado. O tamanho máximo permitido é 30 MB.",
    );
  });

  it("separa o que cabe do que foi recusado, preservando a ordem", () => {
    const { accepted, errors } = partitionBySize([
      file("ok-1.png", 1024),
      file("grande.mp4", ATTACHMENT_MAX_BYTES * 2),
      file("ok-2.png", 2048),
    ]);

    expect(accepted.map((item) => item.name)).toEqual(["ok-1.png", "ok-2.png"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("30 MB");
  });
});
