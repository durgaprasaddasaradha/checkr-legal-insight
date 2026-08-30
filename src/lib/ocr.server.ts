// Backend integration point for the OCR / label-analysis service.
//
// Today this calls the Lovable AI Gateway with a vision model that performs
// OCR on the uploaded label image and evaluates it against the Legal
// Metrology (Packaged Commodities) Rules, 2011.
//
// To swap in another OCR provider (Google Vision, Textract, an in-house
// service), replace the body of `analyzeLabelImages` and keep returning the
// same `AnalysisResult` shape — nothing else in the app needs to change.

import type { AnalysisResult, ComplianceStatus, Declaration, RuleCheck } from "./compliance-data";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-3.7-flash";

export type LabelImageInput = {
  /** data:<mime>;base64,<data> */
  dataUrl: string;
  name: string;
};

export class OcrError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "OcrError";
    this.status = status;
  }
}

const SYSTEM_PROMPT = `You are a Legal Metrology (Packaged Commodities) Rules, 2011 (India) compliance inspector.
You receive photographs of a packaged commodity label. Perform OCR and evaluate the mandatory declarations.

Return STRICT JSON only (no markdown fences) with this exact shape:
{
  "readable": boolean,              // false if the images are not a product label or text is unreadable
  "reason": string,                 // when readable is false, explain why
  "product": string,                // product name as printed, "" if unknown
  "manufacturer": string,           // manufacturer/packer name and address as printed, "" if unknown
  "category": string,               // best-guess commodity category
  "score": number,                  // 0-100 compliance score derived from the checks
  "status": "compliant" | "warning" | "non-compliant",
  "declarations": [ { "label": string, "value": string, "found": boolean } ],
  "checks": [ { "rule": string, "title": string, "status": "compliant"|"warning"|"non-compliant", "detail": string } ]
}

Rules for the output:
- Only report what you can actually read on the image. Never invent values. If a declaration is absent, set found=false and value="Not found".
- Cover at minimum: name of commodity, net quantity, retail sale price (MRP inclusive of all taxes), month & year of manufacture/packing, batch/lot number, name & complete address of manufacturer/packer, consumer care details, country of origin.
- Checks should cite the relevant rule (e.g. "Rule 6", "Rule 9", "Rule 7").`;

type ModelOutput = {
  readable?: boolean;
  reason?: string;
  product?: string;
  manufacturer?: string;
  category?: string;
  score?: number;
  status?: string;
  declarations?: { label?: string; value?: string; found?: boolean }[];
  checks?: { rule?: string; title?: string; status?: string; detail?: string }[];
};

export async function analyzeLabelImages(images: LabelImageInput[]): Promise<AnalysisResult> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new OcrError(
      "The OCR service is not configured (missing API key). Please contact the administrator.",
      401,
    );
  }

  const content: unknown[] = [
    {
      type: "text",
      text: "Read these packaged commodity label images and return the compliance JSON.",
    },
    ...images.map((img) => ({ type: "image_url", image_url: { url: img.dataUrl } })),
  ];

  let response: Response;
  try {
    response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content },
        ],
      }),
    });
  } catch {
    throw new OcrError("Could not reach the OCR service. Please try again.", 503);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new OcrError("The OCR service is busy right now. Please retry in a moment.", 429);
    }
    if (response.status === 402) {
      throw new OcrError("The OCR service quota has been exhausted for this workspace.", 402);
    }
    throw new OcrError(
      `The OCR service rejected the request (${response.status}). ${body.slice(0, 200)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new OcrError("The OCR service returned an empty response.", 502);

  const parsed = parseJson(raw);
  if (!parsed) throw new OcrError("Could not interpret the OCR service response.", 502);
  if (parsed.readable === false) {
    throw new OcrError(
      parsed.reason?.trim() ||
        "The label text could not be read. Please upload a sharper photo of the principal display panel.",
      422,
    );
  }

  return toAnalysisResult(parsed, images);
}

function parseJson(raw: string): ModelOutput | undefined {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as ModelOutput;
  } catch {
    return undefined;
  }
}

function normalizeStatus(value: unknown, fallback: ComplianceStatus = "warning"): ComplianceStatus {
  return value === "compliant" || value === "warning" || value === "non-compliant" ? value : fallback;
}

function toAnalysisResult(m: ModelOutput, images: LabelImageInput[]): AnalysisResult {
  const checks: RuleCheck[] = (m.checks ?? []).map((c, i) => ({
    id: `c${i + 1}`,
    rule: c.rule?.trim() || "LMPC 2011",
    title: c.title?.trim() || "Declaration check",
    status: normalizeStatus(c.status),
    detail: c.detail?.trim() || "",
  }));

  if (checks.length === 0) {
    throw new OcrError("No compliance checks could be derived from this image.", 422);
  }

  const declarations: Declaration[] = (m.declarations ?? []).map((d) => ({
    label: d.label?.trim() || "Declaration",
    value: d.value?.trim() || "Not found",
    found: d.found !== false,
  }));

  const derivedScore = Math.round(
    (checks.reduce(
      (sum, c) => sum + (c.status === "compliant" ? 1 : c.status === "warning" ? 0.6 : 0),
      0,
    ) /
      checks.length) *
      100,
  );
  const score =
    typeof m.score === "number" && m.score >= 0 && m.score <= 100 ? Math.round(m.score) : derivedScore;

  const hasFail = checks.some((c) => c.status === "non-compliant");
  const hasWarn = checks.some((c) => c.status === "warning");
  const status = normalizeStatus(
    m.status,
    hasFail ? "non-compliant" : hasWarn ? "warning" : "compliant",
  );

  return {
    id: `LMR-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
    product: m.product?.trim() || images[0]?.name || "Unidentified product",
    manufacturer: m.manufacturer?.trim() || "Not detected on label",
    category: m.category?.trim() || "Uncategorised",
    analyzedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST",
    score,
    status,
    declarations,
    checks,
  };
}
