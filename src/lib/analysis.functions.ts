import { createServerFn } from "@tanstack/react-start";

import type { Inspection, OnlineListingComparison, PackageSide } from "./compliance-data";

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 12 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;
export const SCAN_BUCKET = "scan-images";

export type ScanFile = { path: string; name: string; mime: string; side: PackageSide };

export type AnalyzeInput = {
  files: ScanFile[];
  inspector: string;
  /** Previous inspection of the same product, for follow-up inspections. */
  parentScanId?: string;
};

export type AnalyzeResponse =
  | { ok: true; inspection: Inspection; scanId: string }
  | { ok: false; error: string };

function validate(input: AnalyzeInput): AnalyzeInput {
  if (!input || !Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("At least one package image is required.");
  }
  if (input.files.length > MAX_FILES) {
    throw new Error(`Please upload at most ${MAX_FILES} files per inspection.`);
  }
  for (const f of input.files) {
    if (!f?.path || typeof f.path !== "string") throw new Error("Invalid upload reference.");
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(f.mime)) {
      throw new Error("Only JPG, JPEG, PNG, WEBP and PDF files are supported.");
    }
  }
  return input;
}

function productKey(inspection: Inspection): string {
  return `${inspection.brand} ${inspection.product}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/**
 * REAL ANALYSIS MODE. Downloads the uploaded images, runs the quality check +
 * OCR + versioned rule engine, and records the inspection. Never returns
 * sample data — a failure surfaces as an error the officer can act on.
 */
export const analyzeScan = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }): Promise<AnalyzeResponse> => {
    const [{ runInspection, OcrError }, { downloadScanFileAsDataUrl, serverDb }] = await Promise.all([
      import("./ocr.server"),
      import("./storage.server"),
    ]);
    const db = await serverDb();

    try {
      const inspection = await runInspection(
        data.files,
        (file) => downloadScanFileAsDataUrl(file.path, file.mime),
        data.inspector?.trim() || "Unassigned officer",
      );

      const { data: row, error: insertError } = await db
        .from("scans")
        .insert({
          report_id: inspection.id,
          product: inspection.product,
          brand: inspection.brand,
          manufacturer: inspection.manufacturer,
          category: inspection.category,
          product_key: productKey(inspection),
          inspector: inspection.inspector,
          ruleset_version: inspection.rulesetVersion,
          screening: inspection.screening,
          priority: inspection.priority,
          status: inspection.screening === "pass" ? "compliant" : inspection.screening === "review" ? "warning" : "non-compliant",
          score: Math.round(
            (inspection.counts.pass / Math.max(1, inspection.findings.length)) * 100,
          ),
          declarations: inspection.declarations,
          checks: inspection.findings,
          findings: inspection.findings,
          quality: inspection.pages.map((p) => ({ name: p.name, side: p.side, ...p.quality })),
          pages: inspection.pages,
          recommendations: [],
          files: data.files,
          mode: "real",
          parent_scan_id: data.parentScanId ?? null,
        })
        .select("id")
        .single();

      if (insertError) console.error("[analyzeScan] inspection record failed", insertError);

      return { ok: true, inspection: { ...inspection, scanId: row?.id ?? "" }, scanId: row?.id ?? "" };
    } catch (error) {
      const message =
        error instanceof OcrError
          ? error.message
          : "The inspection could not be completed. Please try again with clearer images.";
      console.error("[analyzeScan]", error);
      return { ok: false, error: message };
    }
  });

/* ------------------------------------------------------------------ */
/* Online Listing Check                                                 */
/* ------------------------------------------------------------------ */

export type ListingInput = {
  scanId: string;
  listing: { field: string; online: string }[];
  screenshotPath?: string;
};

export const compareListing = createServerFn({ method: "POST" })
  .inputValidator((data: ListingInput) => {
    if (!data?.scanId) throw new Error("An inspection reference is required.");
    if (!Array.isArray(data.listing) || data.listing.length === 0) {
      throw new Error("Enter at least one online listing value.");
    }
    return data;
  })
  .handler(async ({ data }): Promise<{ ok: true; comparison: OnlineListingComparison } | { ok: false; error: string }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: row, error } = await supabaseAdmin
      .from("scans")
      .select("declarations")
      .eq("id", data.scanId)
      .single();

    if (error || !row) return { ok: false, error: "That inspection record could not be found." };

    const declarations = (row.declarations ?? []) as { key: string; label: string; value: string; detected: boolean }[];

    const norm = (v: string) =>
      v.toLowerCase().replace(/[₹rs.\s,]/g, "").replace(/inclusiveofalltaxes/g, "").trim();

    const rows = data.listing.map((entry) => {
      const match = declarations.find(
        (d) => d.key === entry.field || d.label.toLowerCase() === entry.field.toLowerCase(),
      );
      const physical = match?.detected ? match.value : "Not detected on package";
      const online = entry.online.trim() || "Not provided";
      const comparable = Boolean(match?.detected) && online !== "Not provided";
      const same = comparable && norm(physical) === norm(online);
      return {
        field: match?.label ?? entry.field,
        physical,
        online,
        match: (!comparable ? "unknown" : same ? "match" : "mismatch") as "match" | "mismatch" | "unknown",
        note: !comparable
          ? "Not comparable — value missing on one side."
          : same
            ? "Physical package and online listing agree."
            : "Potential discrepancy between the physical package and the online listing.",
      };
    });

    const comparison: OnlineListingComparison = { checkedAt: new Date().toISOString(), rows };

    await supabaseAdmin
      .from("scans")
      .update({ online_listing: { ...comparison, screenshotPath: data.screenshotPath ?? null } })
      .eq("id", data.scanId);

    return { ok: true, comparison };
  });
