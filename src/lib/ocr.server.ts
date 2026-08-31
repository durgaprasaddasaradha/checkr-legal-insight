// Backend OCR + Legal Metrology compliance engine.
//
// Flow: storage file -> bytes -> vision OCR (one call per file, raw text only)
// -> merge/de-duplicate text -> structured extraction + rule evaluation.
//
// To swap the OCR provider (Google Vision, Textract, an in-house service),
// replace `ocrFile` only. Everything downstream works on plain text.

import type {
  AnalysisResult,
  ComplianceStatus,
  Declaration,
  RuleCheck,
  ScanPage,
} from "./compliance-data";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const OCR_MODEL = "google/gemini-3.7-flash";
const REASON_MODEL = "google/gemini-3.7-flash";

export type ScanFileInput = {
  /** Storage object path inside the `scan-images` bucket. */
  path: string;
  name: string;
  mime: string;
};

export class OcrError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "OcrError";
    this.status = status;
  }
}

function apiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) {
    throw new OcrError(
      "The OCR service is not configured (missing API key). Please contact the administrator.",
      401,
    );
  }
  return key;
}

async function gateway(body: unknown): Promise<string> {
  let response: Response;
  try {
    response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new OcrError("Could not reach the OCR service. Please try again.", 503);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    if (response.status === 429)
      throw new OcrError("The OCR service is busy right now. Please retry in a moment.", 429);
    if (response.status === 402)
      throw new OcrError("The OCR service quota has been exhausted for this workspace.", 402);
    throw new OcrError(
      `The OCR service rejected the request (${response.status}). ${text.slice(0, 200)}`,
      response.status,
    );
  }

  const payload = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new OcrError("The OCR service returned an empty response.", 502);
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

const OCR_PROMPT = `You are an OCR engine for photographs of packaged commodity labels.
Transcribe EVERY piece of text you can read in the image, exactly as printed, preserving line breaks.
Do not summarise, translate, correct or invent text. Do not add commentary.
Return STRICT JSON only, no markdown fences:
{
  "readable": boolean,     // false only if no text at all can be read
  "quality": string,       // short note on legibility issues (blur, glare, cropped, low resolution) or ""
  "text": string           // the full raw transcription, "" when readable is false
}`;

/** OCR a single file. Returns raw transcription — never interprets it. */
async function ocrFile(file: ScanFileInput, dataUrl: string): Promise<ScanPage> {
  const isPdf = file.mime === "application/pdf";
  const block = isPdf
    ? { type: "file", file: { filename: file.name, file_data: dataUrl } }
    : { type: "image_url", image_url: { url: dataUrl } };

  try {
    const raw = await gateway({
      model: OCR_MODEL,
      messages: [
        { role: "system", content: OCR_PROMPT },
        {
          role: "user",
          content: [{ type: "text", text: "Transcribe all text on this label." }, block],
        },
      ],
    });
    const parsed = parseJson<{ readable?: boolean; quality?: string; text?: string }>(raw);
    if (!parsed) {
      return { name: file.name, path: file.path, ok: false, text: "", error: "OCR response could not be interpreted." };
    }
    const text = (parsed.text ?? "").trim();
    if (parsed.readable === false || text.length === 0) {
      return {
        name: file.name,
        path: file.path,
        ok: false,
        text: "",
        error: parsed.quality?.trim() || "No readable text could be extracted from this file.",
      };
    }
    return { name: file.name, path: file.path, ok: true, text, quality: parsed.quality?.trim() || "" };
  } catch (error) {
    return {
      name: file.name,
      path: file.path,
      ok: false,
      text: "",
      error: error instanceof OcrError ? error.message : "OCR failed for this file.",
    };
  }
}

const REQUIREMENTS = [
  "Name and address of the manufacturer / packer / importer (Rule 6(1)(a))",
  "Common or generic name of the commodity (Rule 6(1)(b))",
  "Net quantity in standard units (Rule 6(1)(c) & Rule 8)",
  "Month and year of manufacture / packing / import (Rule 6(1)(d))",
  "Retail sale price as 'MRP Rs. ___ inclusive of all taxes' (Rule 6(1)(e) & Rule 18)",
  "Consumer care details — name, address, phone/email (Rule 6(1)(f))",
  "Country of origin for imported packages (Rule 6(1)(a) proviso)",
  "Batch / lot / code number where applicable (Rule 6(1))",
  "Declarations grouped on the principal display panel, legible and conspicuous (Rule 7 & Rule 9)",
];

const COMPLIANCE_PROMPT = `You are a Legal Metrology (Packaged Commodities) Rules, 2011 (India) compliance inspector.
You are given raw OCR transcriptions of one OR MORE photographs of the SAME single packaged commodity (front, back, side panels).
Treat them as one product. Merge the information and ignore duplicated text that appears on several panels.

Requirements to evaluate (skip ones clearly not applicable, e.g. country of origin for a domestic package — mark those compliant only if genuinely not required, otherwise "warning"):
${REQUIREMENTS.map((r) => `- ${r}`).join("\n")}

Return STRICT JSON only, no markdown fences:
{
  "usable": boolean,          // false if the combined text is not a packaged commodity label or is too sparse to evaluate
  "reason": string,
  "product": string,          // "" if unknown
  "commonName": string,
  "manufacturer": string,
  "category": string,
  "declarations": [ { "label": string, "value": string, "found": boolean, "source": string } ],
  "checks": [ { "rule": string, "title": string, "status": "compliant"|"warning"|"non-compliant",
                "extracted": string, "detail": string, "recommendation": string, "source": string } ],
  "recommendations": [ string ]
}

Strict rules:
- Use ONLY the supplied OCR text. NEVER invent a value that is not present.
- If a declaration is absent from the text, set found=false and value="Not found", and the matching check status must be "non-compliant".
- If text exists but is garbled, partial or ambiguous, use status "warning" and detail starting with "Needs manual verification:".
- "compliant" means the requirement is actually satisfied by readable text, not merely that some text was detected.
- "source" must be the exact file name (given with each transcription) where the information was read; use "" if unsure.
- Every declaration listed must also have a corresponding check.`;

export async function analyzeScanFiles(
  files: ScanFileInput[],
  fetchBytes: (file: ScanFileInput) => Promise<string>,
): Promise<AnalysisResult> {
  // 1. OCR each file independently — one failure must not kill the scan.
  const pages: ScanPage[] = [];
  for (const file of files) {
    let dataUrl: string;
    try {
      dataUrl = await fetchBytes(file);
    } catch {
      pages.push({ name: file.name, path: file.path, ok: false, text: "", error: "The uploaded file could not be read from storage." });
      continue;
    }
    pages.push(await ocrFile(file, dataUrl));
  }

  const readable = pages.filter((p) => p.ok && p.text.trim().length > 0);
  if (readable.length === 0) {
    throw new OcrError(
      "Insufficient readable information — Please upload a clearer image of the label panels.",
      422,
    );
  }

  // 2. Merge transcriptions, dropping duplicate lines across panels.
  const seen = new Set<string>();
  const combined = readable
    .map((p) => {
      const lines = p.text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => {
          if (!l) return false;
          const key = l.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (key.length > 3 && seen.has(key)) return false;
          if (key.length > 3) seen.add(key);
          return true;
        });
      return `--- FILE: ${p.name} ---\n${lines.join("\n")}`;
    })
    .join("\n\n");

  if (combined.replace(/--- FILE:.*---/g, "").trim().length < 12) {
    throw new OcrError(
      "Insufficient readable information — Please upload a clearer image of the label panels.",
      422,
    );
  }

  // 3. Evaluate the merged text against the rules.
  const raw = await gateway({
    model: REASON_MODEL,
    messages: [
      { role: "system", content: COMPLIANCE_PROMPT },
      { role: "user", content: `OCR transcriptions of the uploaded panels:\n\n${combined}` },
    ],
  });
  const parsed = parseJson<ModelOutput>(raw);
  if (!parsed) throw new OcrError("Could not interpret the compliance engine response.", 502);
  if (parsed.usable === false) {
    throw new OcrError(
      parsed.reason?.trim() ||
        "Insufficient readable information — Please upload a clearer image of the label panels.",
      422,
    );
  }

  return toAnalysisResult(parsed, pages);
}

type ModelOutput = {
  usable?: boolean;
  reason?: string;
  product?: string;
  commonName?: string;
  manufacturer?: string;
  category?: string;
  declarations?: { label?: string; value?: string; found?: boolean; source?: string }[];
  checks?: {
    rule?: string;
    title?: string;
    status?: string;
    extracted?: string;
    detail?: string;
    recommendation?: string;
    source?: string;
  }[];
  recommendations?: string[];
};

function normalizeStatus(value: unknown, fallback: ComplianceStatus = "warning"): ComplianceStatus {
  return value === "compliant" || value === "warning" || value === "non-compliant" ? value : fallback;
}

function toAnalysisResult(m: ModelOutput, pages: ScanPage[]): AnalysisResult {
  const checks: RuleCheck[] = (m.checks ?? []).map((c, i) => ({
    id: `c${i + 1}`,
    rule: c.rule?.trim() || "LMPC 2011",
    title: c.title?.trim() || "Declaration check",
    status: normalizeStatus(c.status),
    detail: c.detail?.trim() || "",
    extracted: c.extracted?.trim() || "",
    source: c.source?.trim() || "",
    recommendation: c.recommendation?.trim() || "",
  }));

  if (checks.length === 0) {
    throw new OcrError("No compliance checks could be derived from the extracted text.", 422);
  }

  const declarations: Declaration[] = (m.declarations ?? []).map((d) => ({
    label: d.label?.trim() || "Declaration",
    value: d.value?.trim() || "Not found",
    found: d.found === true,
    source: d.source?.trim() || "",
  }));

  const score = Math.round(
    (checks.reduce(
      (sum, c) => sum + (c.status === "compliant" ? 1 : c.status === "warning" ? 0.5 : 0),
      0,
    ) /
      checks.length) *
      100,
  );

  const hasFail = checks.some((c) => c.status === "non-compliant");
  const hasWarn = checks.some((c) => c.status === "warning");
  const status: ComplianceStatus = hasFail ? "non-compliant" : hasWarn ? "warning" : "compliant";

  const recommendations = (m.recommendations ?? [])
    .map((r) => (typeof r === "string" ? r.trim() : ""))
    .filter(Boolean);

  return {
    id: `LMR-${new Date().getFullYear()}-${Math.floor(Math.random() * 90000 + 10000)}`,
    product: m.product?.trim() || "Unable to determine — Manual Verification Required",
    manufacturer: m.manufacturer?.trim() || "Unable to determine — Manual Verification Required",
    category: m.category?.trim() || "Uncategorised",
    analyzedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST",
    score,
    status,
    declarations,
    checks,
    pages,
    recommendations,
  };
}
