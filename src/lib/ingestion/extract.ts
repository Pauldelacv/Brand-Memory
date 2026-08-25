import "server-only";

import { getAIProvider } from "@/lib/ai";
import { IMAGE_MIME_TYPES, TEXT_MIME_TYPES } from "@/lib/ingestion/media-types";

/**
 * Turns an uploaded file into plain text. Every failure is explicit: the caller
 * writes the message onto the source row so the user sees why processing stopped.
 */

export class ExtractionError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "ExtractionError";
  }
}

export class UnsupportedMediaError extends ExtractionError {
  constructor(mimeType: string) {
    super(`Files of type "${mimeType}" cannot be read yet.`);
    this.name = "UnsupportedMediaError";
  }
}

const textTypes = new Set<string>(TEXT_MIME_TYPES);
const imageTypes = new Set<string>(IMAGE_MIME_TYPES);

const IMAGE_INSTRUCTION = [
  "Read this brand asset and describe it for a brand knowledge base.",
  "Transcribe every piece of visible text verbatim.",
  "Then describe the visual language: colours, typography, composition, photography style, logo usage.",
  "Do not speculate beyond what the image shows.",
].join(" ");

export interface ExtractionResult {
  text: string;
  /** Recorded on each chunk so the UI can explain how the text was obtained. */
  method: "pdf" | "text" | "vision";
}

export async function extractText(
  file: ArrayBuffer,
  mimeType: string,
  filename: string,
): Promise<ExtractionResult> {
  if (mimeType === "application/pdf") {
    return { text: await extractPdf(file, filename), method: "pdf" };
  }

  if (textTypes.has(mimeType)) {
    const text = new TextDecoder("utf-8", { fatal: false }).decode(file).trim();
    if (!text) throw new ExtractionError(`"${filename}" is empty.`);
    return { text, method: "text" };
  }

  if (imageTypes.has(mimeType)) {
    return { text: await extractImage(file, mimeType, filename), method: "vision" };
  }

  throw new UnsupportedMediaError(mimeType);
}

async function extractPdf(file: ArrayBuffer, filename: string): Promise<string> {
  try {
    const { extractText: extractPdfText, getDocumentProxy } = await import("unpdf");
    const document = await getDocumentProxy(new Uint8Array(file));
    const { text } = await extractPdfText(document, { mergePages: true });
    const merged = (Array.isArray(text) ? text.join("\n\n") : text).trim();

    if (!merged) {
      throw new ExtractionError(
        `No text layer was found in "${filename}". Scanned PDFs need OCR, which this version does not run.`,
      );
    }
    return merged;
  } catch (error) {
    if (error instanceof ExtractionError) throw error;
    throw new ExtractionError(`"${filename}" could not be read as a PDF.`, error);
  }
}

async function extractImage(
  file: ArrayBuffer,
  mimeType: string,
  filename: string,
): Promise<string> {
  const provider = getAIProvider();
  if (!provider.transcribeImage) {
    throw new UnsupportedMediaError(mimeType);
  }

  const base64 = Buffer.from(file).toString("base64");
  const text = await provider.transcribeImage({ base64, mimeType, instruction: IMAGE_INSTRUCTION });

  if (!text.trim()) {
    throw new ExtractionError(`Nothing could be read from "${filename}".`);
  }
  return text.trim();
}
