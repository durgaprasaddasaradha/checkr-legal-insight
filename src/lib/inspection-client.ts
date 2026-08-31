import { supabase } from "@/integrations/supabase/client";
import { SCAN_BUCKET } from "./analysis.functions";
import type {
  DeclarationFinding,
  Inspection,
  InspectionPage,
  OfficerStatus,
  OnlineListingComparison,
  RuleFinding,
  ScreeningStatus,
  Severity,
} from "./compliance-data";

export type ScanRow = {
  id: string;
  report_id: string;
  product: string;
  brand: string;
  manufacturer: string;
  category: string;
  product_key: string;
  inspector: string;
  ruleset_version: string;
  screening: string;
  priority: string;
  score: number;
  declarations: unknown;
  findings: unknown;
  checks: unknown;
  pages: unknown;
  files: unknown;
  officer_status: string;
  officer_note: string;
  online_listing: unknown;
  mode: string;
  parent_scan_id: string | null;
  created_at: string;
};

const SELECT =
  "id, report_id, product, brand, manufacturer, category, product_key, inspector, ruleset_version, screening, priority, score, declarations, findings, checks, pages, files, officer_status, officer_note, online_listing, mode, parent_scan_id, created_at";

function asScreening(v: string): ScreeningStatus {
  return v === "pass" || v === "review" || v === "potential-violation" ? v : "review";
}

function asSeverity(v: string): Severity {
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

export function rowToInspection(row: ScanRow): Inspection {
  const findings = ((row.findings ?? row.checks ?? []) as RuleFinding[]) || [];
  return {
    id: row.report_id,
    scanId: row.id,
    mode: row.mode === "demo" ? "demo" : "real",
    product: row.product,
    brand: row.brand ?? "",
    manufacturer: row.manufacturer,
    category: row.category,
    categoryKey: "",
    inspector: row.inspector ?? "Unassigned officer",
    analyzedAt: row.created_at,
    rulesetVersion: row.ruleset_version ?? "2026.1",
    screening: asScreening(row.screening),
    priority: asSeverity(row.priority),
    counts: {
      pass: findings.filter((f) => f.status === "pass").length,
      review: findings.filter((f) => f.status === "review").length,
      violation: findings.filter((f) => f.status === "potential-violation").length,
    },
    declarations: (row.declarations ?? []) as DeclarationFinding[],
    findings,
    pages: (row.pages ?? []) as InspectionPage[],
    officerStatus: (row.officer_status as OfficerStatus) ?? "pending",
    officerNote: row.officer_note ?? "",
    onlineListing: (row.online_listing as OnlineListingComparison | null) ?? undefined,
  };
}

export async function fetchInspection(scanId: string): Promise<Inspection | undefined> {
  const { data, error } = await supabase.from("scans").select(SELECT).eq("id", scanId).maybeSingle();
  if (error || !data) return undefined;
  return rowToInspection(data as ScanRow);
}

export async function fetchInspections(limit = 200): Promise<ScanRow[]> {
  const { data, error } = await supabase
    .from("scans")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data as ScanRow[];
}

export async function fetchProductTimeline(productKey: string): Promise<ScanRow[]> {
  const { data } = await supabase
    .from("scans")
    .select(SELECT)
    .eq("product_key", productKey)
    .order("created_at", { ascending: true });
  return (data as ScanRow[] | null) ?? [];
}

export async function saveVerification(scanId: string, status: OfficerStatus, note: string) {
  return supabase
    .from("scans")
    .update({ officer_status: status, officer_note: note, verified_at: new Date().toISOString() })
    .eq("id", scanId);
}

const urlCache = new Map<string, string>();

export async function signedUrl(path: string): Promise<string> {
  if (urlCache.has(path)) return urlCache.get(path)!;
  const { data } = await supabase.storage.from(SCAN_BUCKET).createSignedUrl(path, 3600);
  const url = data?.signedUrl ?? "";
  if (url) urlCache.set(path, url);
  return url;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }) +
        " IST";
}
