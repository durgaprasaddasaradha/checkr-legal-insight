import type { AnalysisResult } from "./compliance-data";

const KEY = "vigilmetro:last-analysis";

export type StoredAnalysis = {
  result: AnalysisResult;
  imageDataUrl: string;
};

export function saveAnalysis(value: StoredAnalysis) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — results page falls back to the sample report */
  }
}

export function loadAnalysis(): StoredAnalysis | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredAnalysis) : undefined;
  } catch {
    return undefined;
  }
}

export function clearAnalysis() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
