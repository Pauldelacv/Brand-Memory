/**
 * Shared between the upload form (client) and the extractor (server), so this
 * module stays free of server-only imports.
 */

export const TEXT_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "text/csv",
  "text/html",
  "application/json",
  "application/xml",
  "text/xml",
] as const;

export const IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const ACCEPTED_MIME_TYPES = [
  "application/pdf",
  ...TEXT_MIME_TYPES,
  ...IMAGE_MIME_TYPES,
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export function isAcceptedMimeType(mimeType: string): boolean {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(mimeType);
}
