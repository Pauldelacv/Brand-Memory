export const SOURCE_BUCKET = "brand-sources";

/** Path convention the storage policy relies on: <brandId>/<sourceId>-<safe filename>. */
export function storagePathFor(brandId: string, sourceId: string, filename: string): string {
  return `${brandId}/${sourceId}-${sanitizeFilename(filename)}`;
}

export function sanitizeFilename(filename: string): string {
  const cleaned = filename
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+/, "")
    .trim();

  return (cleaned || "source").slice(0, 120);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
