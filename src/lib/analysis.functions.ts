import { createServerFn } from "@tanstack/react-start";

import type { AnalysisResult } from "./compliance-data";

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

export type AnalyzeInput = {
  /** Storage paths of the already-uploaded files, all belonging to ONE product. */
  files: { path: string; name: string; mime: string }[];
};

export type AnalyzeResponse =
  | { ok: true; result: AnalysisResult; scanId: string }
  | { ok: false; error: string };

function validate(input: AnalyzeInput): AnalyzeInput {
  if (!input || !Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("At least one label file is required.");
  }
  if (input.files.length > MAX_FILES) {
    throw new Error(`Please upload at most ${MAX_FILES} files.`);
  }
  for (const f of input.files) {
    if (!f?.path || typeof f.path !== "string") throw new Error("Invalid upload reference.");
    if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(f.mime)) {
      throw new Error("Only JPG, JPEG, PNG, WEBP and PDF files are supported.");
    }
  }
  return input;
}

/**
 * Runs the real pipeline: storage download -> OCR per file -> merged extraction
 * -> Legal Metrology rule engine -> persisted scan history record.
 */
export const analyzeScan = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }): Promise<AnalyzeResponse> => {
    const [{ analyzeScanFiles, OcrError }, { supabaseAdmin }] = await Promise.all([
      import("./ocr.server"),
      import("@/integrations/supabase/client.server"),
    ]);

    try {
      const result = await analyzeScanFiles(data.files, async (file) => {
        const { data: blob, error } = await supabaseAdmin.storage
          .from(SCAN_BUCKET)
          .download(file.path);
        if (error || !blob) throw new Error(error?.message ?? "download failed");
        const buffer = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let i = 0; i < buffer.length; i += chunk) {
          binary += String.fromCharCode(...buffer.subarray(i, i + chunk));
        }
        return `data:${file.mime};base64,${btoa(binary)}`;
      });

      const { data: row, error: insertError } = await supabaseAdmin
        .from("scans")
        .insert({
          report_id: result.id,
          product: result.product,
          manufacturer: result.manufacturer,
          category: result.category,
          status: result.status,
          score: result.score,
          declarations: result.declarations,
          checks: result.checks,
          pages: result.pages ?? [],
          recommendations: result.recommendations ?? [],
          files: data.files,
        })
        .select("id")
        .single();

      if (insertError) console.error("[analyzeScan] history insert failed", insertError);

      return { ok: true, result, scanId: row?.id ?? "" };
    } catch (error) {
      const message =
        error instanceof OcrError
          ? error.message
          : "The analysis could not be completed. Please try again with clearer photos.";
      console.error("[analyzeScan]", error);
      return { ok: false, error: message };
    }
  });
