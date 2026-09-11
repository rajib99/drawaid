import { config } from "../config";

// A generic ID-number-like token: 5-20 chars of digits/letters, at least one digit.
export const ID_NUMBER_PATTERN = /\b(?=[A-Z0-9]*\d)[A-Z0-9]{5,20}\b/i;
// A generic date-like token: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or "01 JAN 2030" style.
export const DATE_PATTERN =
  /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\s?\d{2,4})\b/i;

export function looksLikeIdNumber(text: string): boolean {
  return ID_NUMBER_PATTERN.test(text);
}

export function looksLikeDate(text: string): boolean {
  return DATE_PATTERN.test(text);
}

export interface SideTextResult {
  text: string;
  confidence: number;
}

export interface HeuristicVerdict {
  overallConfidence: number;
  passed: boolean;
  reason?: string;
}

/**
 * Pure decision logic for the "visual verification" heuristic, kept
 * separate from the Tesseract call so it can be unit tested without
 * running actual OCR.
 */
export function evaluateOcrResult(front: SideTextResult, back: SideTextResult): HeuristicVerdict {
  const overallConfidence = (front.confidence + back.confidence) / 2;
  const hasIdNumber = looksLikeIdNumber(front.text) || looksLikeIdNumber(back.text);
  const hasDate = looksLikeDate(front.text) || looksLikeDate(back.text);

  if (overallConfidence < config.ocrMinConfidence) {
    return {
      overallConfidence,
      passed: false,
      reason: `OCR confidence too low (${overallConfidence.toFixed(1)} < ${config.ocrMinConfidence})`,
    };
  }
  if (!hasIdNumber) {
    return { overallConfidence, passed: false, reason: "No ID-number-like token detected on either side" };
  }
  if (!hasDate) {
    return { overallConfidence, passed: false, reason: "No date-like token detected on either side" };
  }
  return { overallConfidence, passed: true };
}
