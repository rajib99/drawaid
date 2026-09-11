import { describe, expect, it } from "vitest";
import { evaluateOcrResult, looksLikeDate, looksLikeIdNumber } from "../src/services/ocrHeuristics";

describe("looksLikeIdNumber", () => {
  it("matches an alphanumeric ID-number-like token", () => {
    expect(looksLikeIdNumber("PASSPORT NO A1234567")).toBe(true);
    expect(looksLikeIdNumber("DL 998877665")).toBe(true);
  });

  it("rejects plain words with no digits", () => {
    expect(looksLikeIdNumber("UNITED STATES OF AMERICA")).toBe(false);
  });
});

describe("looksLikeDate", () => {
  it("matches common date formats", () => {
    expect(looksLikeDate("DOB: 04/12/1990")).toBe(true);
    expect(looksLikeDate("Expires 2030-01-15")).toBe(true);
    expect(looksLikeDate("15 JAN 2030")).toBe(true);
  });

  it("rejects text with no date", () => {
    expect(looksLikeDate("NO DATE HERE AT ALL")).toBe(false);
  });
});

describe("evaluateOcrResult", () => {
  const goodText = "JOHN SMITH DOB 04/12/1990 ID A1234567";

  it("passes when confidence is high and both an ID number and date are found", () => {
    const verdict = evaluateOcrResult(
      { text: goodText, confidence: 80 },
      { text: goodText, confidence: 85 }
    );
    expect(verdict.passed).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });

  it("fails when confidence is below the configured threshold", () => {
    const verdict = evaluateOcrResult(
      { text: goodText, confidence: 10 },
      { text: goodText, confidence: 5 }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/confidence too low/i);
  });

  it("fails when no ID-number-like token is present", () => {
    const verdict = evaluateOcrResult(
      { text: "JOHN SMITH DOB 04/12/1990", confidence: 90 },
      { text: "JOHN SMITH DOB 04/12/1990", confidence: 90 }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/id-number/i);
  });

  it("fails when no date-like token is present", () => {
    const verdict = evaluateOcrResult(
      { text: "JOHN SMITH ID A1234567", confidence: 90 },
      { text: "JOHN SMITH ID A1234567", confidence: 90 }
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.reason).toMatch(/date/i);
  });
});
