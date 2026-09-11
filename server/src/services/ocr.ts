import { createWorker } from "tesseract.js";
import { evaluateOcrResult, looksLikeDate, looksLikeIdNumber } from "./ocrHeuristics";

export interface OcrSideResult {
  text: string;
  confidence: number;
  hasIdNumberLikeToken: boolean;
  hasDateLikeToken: boolean;
}

export interface OcrResult {
  front: OcrSideResult;
  back: OcrSideResult;
  overallConfidence: number;
  passed: boolean;
  reason?: string;
}

async function ocrSide(buffer: Buffer): Promise<OcrSideResult> {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(buffer);
    const text = data.text ?? "";
    return {
      text,
      confidence: data.confidence ?? 0,
      hasIdNumberLikeToken: looksLikeIdNumber(text),
      hasDateLikeToken: looksLikeDate(text),
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * Heuristic, non-banking-grade "visual verification": runs OCR on both
 * sides of the ID and checks that the extracted text looks like an ID
 * (readable text with an ID-number-like token and a date-like token
 * present somewhere across the two sides, above a minimum OCR confidence).
 */
export async function verifyIdVisually(frontBuffer: Buffer, backBuffer: Buffer): Promise<OcrResult> {
  const [front, back] = await Promise.all([ocrSide(frontBuffer), ocrSide(backBuffer)]);
  const verdict = evaluateOcrResult(front, back);
  return { front, back, ...verdict };
}
