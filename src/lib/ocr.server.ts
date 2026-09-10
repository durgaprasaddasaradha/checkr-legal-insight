// Inspection pipeline (server-only).
//
//   image  →  quality check  →  preprocessing hooks  →  OCR (tokens +
//   confidence + bounding boxes)  →  declaration extraction  →  product
//   category  →  versioned rule engine  →  screening result + evidence
//
// PROVIDER BOUNDARY
// ----------------
// `runOcr()` is the ONLY place that talks to an OCR provider. Today it uses a
// vision model through the Lovable AI Gateway. To move to the recommended
// Python stack (FastAPI + OpenCV preprocessing + PaddleOCR, optionally YOLO
// region detection), set OCR_ENDPOINT and implement `runExternalOcr()` — the
// response contract (text, confidence, normalised bbox, language) is already
// exactly what PaddleOCR returns, so nothing downstream changes.

import type {
  BBox,
  DeclarationFinding,
  ImageQuality,
  Inspection,
  InspectionPage,
  OcrToken,
  PackageSide,
  RuleFinding,
  ScreeningStatus,
  Severity,
} from "./compliance-data";
import { loadActiveRules, ruleApplies, type RuleRow } from "./rules.server";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const VISION_MODEL = "google/gemini-3.7-flash";

/** Optional external OCR service (FastAPI + OpenCV + PaddleOCR + YOLO). */
const OCR_ENDPOINT = process.env["OCR_SERVICE_URL"] ?? "";

export type ScanFileInput = {
  path: string;
  name: string;
  mime: string;
  side: PackageSide;
};

export class OcrError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "OcrError";
    this.status = status;
  }
}

/* ------------------------------------------------------------------ */
/* Gateway plumbing                                                     */
/* ------------------------------------------------------------------ */

async function gateway(body: unknown): Promise<string> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new OcrError("The analysis service is not configured (missing API key).", 401);
  }

  let response: Response;
  try {
    response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OcrError("Could not reach the analysis service. Please try again.", 503);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 429)
      throw new OcrError("The analysis service is busy. Please retry in a moment.", 429);
    if (response.status === 402)
      throw new OcrError("The analysis service quota has been exhausted for this workspace.", 402);
    throw new OcrError(
      `The analysis service rejected the request (${response.status}). ${text.slice(0, 180)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new OcrError("The analysis service returned an empty response.", 502);
  return content;
}

function parseJson<T>(raw: string): T | undefined {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return undefined;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 1 — image quality check + OCR                                  */
/* ------------------------------------------------------------------ */

const OCR_PROMPT = `You are the image-quality and OCR stage of a Legal Metrology inspection pipeline.
You receive ONE photograph of a packaged commodity.

STEP 1 — quality assessment. Judge resolution, blur, glare, text visibility, package visibility and orientation.
STEP 2 — OCR. Transcribe every legible text region exactly as printed. Never translate, correct, complete or invent text.

Return STRICT JSON only (no markdown fences):
{
  "quality": {
    "verdict": "good" | "warning" | "poor",
    "score": number,               // 0-100 overall capture quality
    "resolution": string,          // e.g. "adequate", "low"
    "orientation": string,         // e.g. "upright", "rotated ~90deg", "skewed"
    "issues": [ string ],          // e.g. "motion blur on lower panel", "glare over MRP area"
    "note": string
  },
  "language": string,              // dominant script/language: "en", "hi", "te", "mixed"
  "text": string,                  // full raw transcription with line breaks
  "tokens": [
    {
      "text": string,              // one readable line or phrase, exactly as printed
      "confidence": number,        // 0-100 OCR confidence for THIS text
      "language": string,          // "en" | "hi" | "te" | other
      "bbox": { "x": number, "y": number, "w": number, "h": number }  // NORMALISED 0-1, relative to the image
    }
  ]
}

Rules:
- "poor" means the label text cannot be relied on; say why in issues.
- bbox must be the TIGHT box around that text: x,y = top-left corner, w,h = width/height, all as decimal fractions of the image (0 to 1, e.g. 0.12). Never output pixel values, never output 1 for every field, and never reuse the same box for two different tokens.
- If nothing is readable, return quality.verdict "poor", text "" and tokens [].`;

/** Swap this for the FastAPI/PaddleOCR service when it is available. */
async function runExternalOcr(file: ScanFileInput, dataUrl: string) {
  const response = await fetch(`${OCR_ENDPOINT.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: file.name, side: file.side, mime: file.mime, image: dataUrl }),
  });
  if (!response.ok) throw new OcrError(`OCR service error (${response.status}).`, response.status);
  return (await response.json()) as OcrPayload;
}

type OcrPayload = {
  quality?: Partial<ImageQuality>;
  language?: string;
  text?: string;
  tokens?: { text?: string; confidence?: number; language?: string; bbox?: Partial<BBox> }[];
};

async function runOcr(file: ScanFileInput, dataUrl: string): Promise<OcrPayload> {
  if (OCR_ENDPOINT) return runExternalOcr(file, dataUrl);

  const block =
    file.mime === "application/pdf"
      ? { type: "file", file: { filename: file.name, file_data: dataUrl } }
      : { type: "image_url", image_url: { url: dataUrl } };

  const raw = await gateway({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: OCR_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: `This is the ${file.side} side of the package. Assess and transcribe it.` },
          block,
        ],
      },
    ],
  });
  const parsed = parseJson<OcrPayload>(raw);
  if (!parsed) throw new OcrError("The OCR response could not be interpreted.", 502);
  return parsed;
}



function clampPct(n: unknown, fallback = 0): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.round(Math.min(100, Math.max(0, v)));
}

/**
 * Normalise a model-reported box to 0–1 fractions. Vision models often answer
 * on a 0–1000 grid (or in raw pixels), which previously clamped to 1 and made
 * every box invisible. Returns a zeroed box when the geometry is unusable.
 */
function normBox(b: Partial<BBox> | undefined): BBox {
  const nums = [b?.x, b?.y, b?.w, b?.h].map((n) =>
    typeof n === "number" && Number.isFinite(n) ? n : NaN,
  );
  if (nums.some((n) => Number.isNaN(n))) return { x: 0, y: 0, w: 0, h: 0 };
  const max = Math.max(...nums.map(Math.abs));
  // 0-1 fractions stay as-is; 0-1000 grids and pixel values get scaled down.
  const divisor = max <= 1.001 ? 1 : max <= 1000 ? 1000 : max <= 4000 ? 4000 : max;
  const [x, y, w, h] = nums.map((n) => Math.min(1, Math.max(0, n / divisor))) as [
    number,
    number,
    number,
    number,
  ];
  if (w <= 0.002 || h <= 0.002 || x >= 1 || y >= 1) return { x: 0, y: 0, w: 0, h: 0 };
  return { x, y, w: Math.min(w, 1 - x), h: Math.min(h, 1 - y) };
}

function toPage(file: ScanFileInput, payload: OcrPayload): InspectionPage {
  const tokens: OcrToken[] = (payload.tokens ?? [])
    .map((t) => ({
      text: (t.text ?? "").trim(),
      confidence: clampPct(t.confidence, 70),
      language: t.language?.trim() || payload.language?.trim() || "en",
      bbox: normBox(t.bbox),
    }))
    .filter((t) => t.text.length > 0);


  const q = payload.quality ?? {};
  const verdict = q.verdict === "good" || q.verdict === "warning" || q.verdict === "poor" ? q.verdict : "warning";
  const text = (payload.text ?? "").trim();

  const quality: ImageQuality = {
    verdict: text.length === 0 ? "poor" : verdict,
    score: clampPct(q.score, verdict === "good" ? 85 : 55),
    issues: Array.isArray(q.issues) ? q.issues.filter((i): i is string => typeof i === "string") : [],
    resolution: typeof q.resolution === "string" ? q.resolution : "unknown",
    orientation: typeof q.orientation === "string" ? q.orientation : "unknown",
    note: typeof q.note === "string" ? q.note : "",
  };

  return {
    name: file.name,
    path: file.path,
    side: file.side,
    ok: text.length > 0,
    text,
    tokens,
    quality,
    language: payload.language?.trim() || "en",
  };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — extraction + versioned rule engine                         */
/* ------------------------------------------------------------------ */

type EngineOutput = {
  usable?: boolean;
  reason?: string;
  product?: string;
  brand?: string;
  manufacturer?: string;
  category?: string;
  categoryKey?: string;
  declarations?: {
    key?: string;
    label?: string;
    value?: string;
    detected?: boolean;
    applicable?: boolean;
    ocrConfidence?: number;
    detectionConfidence?: number;
    source?: string;
    language?: string;
  }[];
  findings?: {
    ruleCode?: string;
    status?: string;
    finding?: string;
    extracted?: string;
    ocrConfidence?: number;
    source?: string;
    recommendation?: string;
  }[];
};

function enginePrompt(rules: RuleRow[], version: string): string {
  const catalogue = rules
    .map(
      (r) =>
        `${r.rule_code} | declaration=${r.declaration_type} | severity=${r.severity} | applies_to=${(r.applicability ?? []).join(",")} | method=${r.validation_method} | ref=${r.source_ref}\n    ${r.requirement}`,
    )
    .join("\n");

  return `You are the declaration-extraction and rule-checking stage of a Legal Metrology inspection platform (India).
You receive OCR output from one or more photographed sides of the SAME package. Treat them as one commodity.

RULE CATALOGUE (ruleset version ${version}) — evaluate ONLY these rules:
${catalogue}

Return STRICT JSON only (no markdown fences):
{
  "usable": boolean,        // false if this is not a packaged commodity label or the text is far too sparse
  "reason": string,
  "product": string,
  "brand": string,
  "manufacturer": string,
  "category": string,             // human label, e.g. "Packaged food"
  "categoryKey": "food" | "personal-care" | "household" | "imported" | "ecommerce" | "other",
  "declarations": [
    { "key": string,              // declaration_type from the catalogue
      "label": string,
      "value": string,            // exactly as printed; "Not detected" when absent
      "detected": boolean,
      "applicable": boolean,      // false when the declaration does not apply to this category
      "ocrConfidence": number,    // 0-100, from the token confidence you used; 0 when not detected
      "detectionConfidence": number, // 0-100 confidence in this classification
      "source": string,           // exact file name the value was read from
      "language": string }
  ],
  "findings": [
    { "ruleCode": string,         // must be a code from the catalogue
      "status": "pass" | "review" | "potential-violation",
      "finding": string,          // one or two plain sentences an officer can read
      "extracted": string,
      "ocrConfidence": number,
      "source": string,
      "recommendation": string }
  ]
}

Hard rules:
- Use ONLY the supplied OCR text. NEVER invent a value.
- Emit one finding for EVERY catalogue rule that applies to the detected category. Skip rules that do not apply.
- "pass" = the requirement is demonstrably satisfied by readable text.
- "potential-violation" = the required declaration is absent or clearly defective.
- "review" = text is present but ambiguous, partially legible, low confidence, or the rule needs physical measurement (font height, panel grouping).
- Any rule whose validation_method is "manual-verification" must be "review".
- "source" must be an exact supplied file name.
- Never state a legal conclusion. These are automated screening outcomes.`;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                        */
/* ------------------------------------------------------------------ */

function normStatus(v: unknown): ScreeningStatus {
  return v === "pass" || v === "review" || v === "potential-violation" ? v : "review";
}

function normSeverity(v: unknown): Severity {
  return v === "high" || v === "medium" || v === "low" ? v : "medium";
}

/** Locate the OCR token that best matches an extracted value, for the evidence viewer. */
function locate(pages: InspectionPage[], source: string, value: string) {
  const page = pages.find((p) => p.name === source) ?? pages[0];
  if (!page) return undefined;
  const needle = value.toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle || needle === "not detected") return { page, token: undefined };
  const token =
    page.tokens.find((t) => t.text.toLowerCase().includes(needle)) ??
    page.tokens.find((t) => needle.includes(t.text.toLowerCase()) && t.text.length > 2);
  return { page, token };
}

export async function runInspection(
  files: ScanFileInput[],
  fetchBytes: (file: ScanFileInput) => Promise<string>,
  inspector: string,
): Promise<Inspection> {
  // Stage 1 — quality + OCR, per image, independently.
  const pages: InspectionPage[] = [];
  for (const file of files) {
    let dataUrl: string;
    try {
      dataUrl = await fetchBytes(file);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.error("[runInspection] storage read failed", file.path, detail);
      pages.push(
        failedPage(file, `The uploaded file could not be read from storage (${detail}).`),
      );
      continue;
    }
    try {
      pages.push(toPage(file, await runOcr(file, dataUrl)));
    } catch (error) {
      pages.push(failedPage(file, error instanceof OcrError ? error.message : "OCR failed for this file."));
    }
  }

  const readable = pages.filter((p) => p.ok && p.tokens.length > 0);
  if (readable.length === 0) {
    const poor = pages.map((p) => p.quality.issues.join("; ")).filter(Boolean).join(" · ");
    throw new OcrError(
      `Insufficient readable information — please capture clearer images of the package.${poor ? ` Detected issues: ${poor}.` : ""}`,
      422,
    );
  }

  // Stage 2 — merged, de-duplicated OCR payload for the rule engine.
  const seen = new Set<string>();
  const merged = readable
    .map((p) => {
      const lines = p.tokens
        .filter((t) => {
          const key = t.text.toLowerCase().replace(/[^a-z0-9₹.]/g, "");
          if (key.length <= 3) return true;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((t) => `  [conf ${t.confidence}%] ${t.text}`)
        .join("\n");
      return `FILE: ${p.name} (side: ${p.side}, capture quality: ${p.quality.verdict})\n${lines}`;
    })
    .join("\n\n");

  const { rules, version } = await loadActiveRules();

  const raw = await gateway({
    model: VISION_MODEL,
    messages: [
      { role: "system", content: enginePrompt(rules, version) },
      { role: "user", content: `OCR output from the uploaded package sides:\n\n${merged}` },
    ],
  });
  const engine = parseJson<EngineOutput>(raw);
  if (!engine) throw new OcrError("The rule engine response could not be interpreted.", 502);
  if (engine.usable === false) {
    throw new OcrError(
      engine.reason?.trim() ||
        "Insufficient readable information — please capture clearer images of the package.",
      422,
    );
  }

  const categoryKey = engine.categoryKey?.trim() || "other";
  const ruleByCode = new Map(rules.map((r) => [r.rule_code, r]));

  const declarations: DeclarationFinding[] = (engine.declarations ?? []).map((d) => {
    const value = d.value?.trim() || "Not detected";
    const source = d.source?.trim() || "";
    const hit = locate(pages, source, value);
    return {
      key: d.key?.trim() || "other",
      label: d.label?.trim() || d.key?.trim() || "Declaration",
      value,
      detected: d.detected === true,
      applicable: d.applicable !== false,
      ocrConfidence: clampPct(d.ocrConfidence, hit?.token?.confidence ?? 0),
      detectionConfidence: clampPct(d.detectionConfidence, 60),
      source: hit?.page?.name ?? source,
      side: hit?.page?.side,
      bbox: hit?.token?.bbox,
      language: d.language?.trim() || hit?.token?.language || "en",
    };
  });

  const findings: RuleFinding[] = [];
  (engine.findings ?? []).forEach((f, i) => {
    const rule = ruleByCode.get(f.ruleCode?.trim() ?? "");
    if (!rule || !ruleApplies(rule, categoryKey)) return;
    const extracted = f.extracted?.trim() || "Not detected";
    const hit = locate(pages, f.source?.trim() || "", extracted);
    const status: ScreeningStatus =
      rule.validation_method === "manual-verification" ? "review" : normStatus(f.status);
    findings.push({
      id: `f${i + 1}`,
      ruleCode: rule.rule_code,
      declaration: rule.declaration_type,
      requirement: rule.requirement,
      status,
      severity: normSeverity(rule.severity),
      finding: f.finding?.trim() || "",
      extracted,
      ocrConfidence: clampPct(f.ocrConfidence, hit?.token?.confidence ?? 0),
      source: hit?.page?.name ?? f.source?.trim() ?? "",
      side: hit?.page?.side,
      bbox: hit?.token?.bbox,
      ruleRef: rule.source_ref,
      recommendation:
        f.recommendation?.trim() ||
        (status === "pass" ? "No action required." : "Manual verification by the inspecting officer."),
      applicability: (rule.applicability ?? []).join(", "),
    });
  });


  if (findings.length === 0) {
    throw new OcrError("No applicable rule checks could be derived from the extracted text.", 422);
  }

  const counts = {
    pass: findings.filter((f) => f.status === "pass").length,
    review: findings.filter((f) => f.status === "review").length,
    violation: findings.filter((f) => f.status === "potential-violation").length,
  };
  const screening: ScreeningStatus =
    counts.violation > 0 ? "potential-violation" : counts.review > 0 ? "review" : "pass";

  // Inspection prioritisation score — an operational triage signal, NOT a
  // penalty or guilt score.
  const highSeverity = findings.filter(
    (f) => f.status === "potential-violation" && f.severity === "high",
  ).length;
  const poorCaptures = pages.filter((p) => p.quality.verdict === "poor").length;
  const priority: Severity =
    highSeverity >= 2 || counts.violation >= 4
      ? "high"
      : counts.violation > 0 || counts.review >= 3 || poorCaptures > 0
        ? "medium"
        : "low";

  return {
    id: `LM-${new Date().getFullYear()}-${Math.floor(Math.random() * 900000 + 100000)}`,
    mode: "real",
    product: engine.product?.trim() || "Not determined — manual verification required",
    brand: engine.brand?.trim() || "",
    manufacturer: engine.manufacturer?.trim() || "Not determined — manual verification required",
    category: engine.category?.trim() || "Other packaged commodity",
    categoryKey,
    inspector,
    analyzedAt: new Date().toISOString(),
    rulesetVersion: version,
    screening,
    priority,
    counts,
    declarations,
    findings,
    pages,
  };
}

function failedPage(file: ScanFileInput, error: string): InspectionPage {
  return {
    name: file.name,
    path: file.path,
    side: file.side,
    ok: false,
    text: "",
    tokens: [],
    quality: {
      verdict: "poor",
      score: 0,
      issues: [error],
      resolution: "unknown",
      orientation: "unknown",
      note: error,
    },
    language: "en",
    error,
  };
}
