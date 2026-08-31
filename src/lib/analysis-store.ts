import type { AnalysisResult } from "./compliance-data";

const KEY = "vigilmetro:last-analysis";

export type StoredAnalysis = {
  result: AnalysisResult;
  scanId: string;
  files: { path: string; name: string; mime: string }[];
};

export function saveAnalysis(value: StoredAnalysis) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — results page falls back to the stored scan record */
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
