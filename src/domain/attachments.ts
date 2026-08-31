/** Teto por arquivo. O bucket e o check de `message_attachments` usam o mesmo. */
export const ATTACHMENT_MAX_BYTES = 100 * 1024 * 1024;

/** Quanto tempo o arquivo fica disponível antes de ser apagado do servidor. */
export const ATTACHMENT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Acima disto a prévia não é carregada sozinha: decifrar exige baixar o
 * arquivo inteiro, e não vale gastar a banda de quem só está lendo o histórico.
 */
export const ATTACHMENT_AUTOPLAY_MAX_BYTES = 8 * 1024 * 1024;

export type AttachmentKind = "image" | "video" | "audio" | "file";

export function attachmentKind(mime: string): AttachmentKind {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "file";
}

export function attachmentExpiresAt(createdAt: string | number) {
  return new Date(createdAt).getTime() + ATTACHMENT_TTL_MS;
}

export function isAttachmentExpired(createdAt: string | number, now = Date.now()) {
  return now >= attachmentExpiresAt(createdAt);
}

/** "3 h restantes", "12 min restantes" — o que sobra antes de o arquivo sumir. */
export function attachmentTimeLeft(createdAt: string | number, now = Date.now()) {
  const remaining = attachmentExpiresAt(createdAt) - now;
  if (remaining <= 0) return "expirado";
  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 1) return `${hours} h restantes`;
  const minutes = Math.max(1, Math.round(remaining / 60_000));
  return `${minutes} min restantes`;
}

export function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
