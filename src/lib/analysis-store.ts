import type { Inspection } from "./compliance-data";

const KEY = "vigilmetro:last-inspection";
const INSPECTOR_KEY = "vigilmetro:inspector";

export function saveInspection(value: Inspection) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* storage unavailable — the results page falls back to the database record */
  }
}

export function loadInspection(): Inspection | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Inspection) : undefined;
  } catch {
    return undefined;
  }
}

export function clearInspection() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function getInspectorName(): string {
  try {
    return localStorage.getItem(INSPECTOR_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setInspectorName(name: string) {
  try {
    localStorage.setItem(INSPECTOR_KEY, name);
  } catch {
    /* noop */
  }
}
