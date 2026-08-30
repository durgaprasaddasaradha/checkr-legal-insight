import { createServerFn } from "@tanstack/react-start";

import type { AnalysisResult } from "./compliance-data";

export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png"] as const;

export type AnalyzeInput = {
  images: { dataUrl: string; name: string }[];
};

export type AnalyzeResponse =
  | { ok: true; result: AnalysisResult }
  | { ok: false; error: string };

function validate(input: AnalyzeInput): AnalyzeInput {
  if (!input || !Array.isArray(input.images) || input.images.length === 0) {
    throw new Error("At least one label image is required.");
  }
  if (input.images.length > MAX_IMAGES) {
    throw new Error(`Please upload at most ${MAX_IMAGES} images.`);
  }
  for (const img of input.images) {
    const match = /^data:(image\/(?:jpeg|jpg|png));base64,/i.exec(img.dataUrl ?? "");
    if (!match) throw new Error("Only JPG, JPEG and PNG images are supported.");
    if (img.dataUrl.length * 0.75 > MAX_IMAGE_BYTES) {
      throw new Error("Each image must be smaller than 6 MB.");
    }
  }
  return input;
}

/**
 * Backend integration point: runs OCR + Legal Metrology compliance analysis on
 * the uploaded label images. Swap the implementation in `ocr.server.ts` to plug
 * in a different OCR provider.
 */
export const analyzeLabel = createServerFn({ method: "POST" })
  .inputValidator(validate)
  .handler(async ({ data }): Promise<AnalyzeResponse> => {
    const { analyzeLabelImages, OcrError } = await import("./ocr.server");
    try {
      const result = await analyzeLabelImages(data.images);
      return { ok: true, result };
    } catch (error) {
      const message =
        error instanceof OcrError
          ? error.message
          : "The image could not be processed. Please try again with a clearer photo.";
      console.error("[analyzeLabel]", error);
      return { ok: false, error: message };
    }
  });
