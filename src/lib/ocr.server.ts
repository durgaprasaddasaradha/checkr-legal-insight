// Inspection pipeline (server-only).
//
//   image  →  quality check  →  preprocessing hooks  →  OCR (tokens +
//   confidence + bounding boxes)  →  declaration extraction  →  product
//   category  →  versioned rule engine  →  screening result + evidence
//
// PROVIDER BOUNDARY
// ----------------
// `runOcr()` is the ONLY place that talks to an OCR provider. Today it uses a
// vision model through OpenRouter/Lovable/Gemini. To move to the recommended
// Python stack (FastAPI + OpenCV preprocessing + PaddleOCR, optionally YOLO
// region detection), set OCR_ENDPOINT and implement `runExternalOcr()`.

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
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
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
/* Gateway plumbing                                                    */
/* ------------------------------------------------------------------ */

async function gateway(body: Record<string, unknown>): Promise<string> {
  const { lovableApiKey, visionProvider } = await import("./server-env.server");

  const openRouterKey = process.env["OPENROUTER_API_KEY"];
  const apiKey = lovableApiKey();
  const fallback = visionProvider();

  if (!openRouterKey && !apiKey && !fallback) {
    throw new OcrError(
      "The analysis service is not configured on this deployment. Set OPENROUTER_API_KEY, LOVABLE_API_KEY, or GEMINI_API_KEY / OPENAI_API_KEY.",
      401,
    );
  }

  /* -------------------------------------------------------------- */
  /* 1. OpenRouter free router                                      */
  /* -------------------------------------------------------------- */

  if (openRouterKey) {
    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openRouterKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://checkr-legal-insight.vercel.app",
          "X-Title": "PackWise Compliance",
        },
        body: JSON.stringify({
          ...body,
          model: "openrouter/free",
        }),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          choices?: {
            message?: {
              content?: string;
            };
          }[];
        };

        const content = payload.choices?.[0]?.message?.content;

        if (content && content.trim()) {
          return content;
        }
      } else {
        const errorText = await response.text().catch(() => "");
        console.error(
          `[gateway] OpenRouter failed (${response.status}):`,
          errorText.slice(0, 500),
        );
      }
    } catch (error) {
      console.error(
        "[gateway] OpenRouter request failed, trying backup provider",
        error,
      );
    }
  }

  /* -------------------------------------------------------------- */
  /* 2. Existing Lovable AI Gateway                                */
  /* -------------------------------------------------------------- */

  if (apiKey) {
    try {
      const response = await fetch(GATEWAY_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          choices?: {
            message?: {
              content?: string;
            };
          }[];
        };

        const content = payload.choices?.[0]?.message?.content;

        if (content && content.trim()) {
          return content;
        }
      } else {
        const errorText = await response.text().catch(() => "");
        console.error(
          `[gateway] Lovable AI failed (${response.status}):`,
          errorText.slice(0, 500),
        );
      }
    } catch (error) {
      console.error(
        "[gateway] Lovable AI request failed, trying backup provider",
        error,
      );
    }
  }

  /* -------------------------------------------------------------- */
  /* 3. Gemini / OpenAI backup                                      */
  /* -------------------------------------------------------------- */

  if (fallback) {
    try {
      const payloadBody = {
        ...body,
        model: fallback.model,
      };

      const response = await fetch(fallback.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${fallback.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payloadBody),
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          choices?: {
            message?: {
              content?: string;
            };
          }[];
        };

        const content = payload.choices?.[0]?.message?.content;

        if (content && content.trim()) {
          return content;
        }
      } else {
        const errorText = await response.text().catch(() => "");
        console.error(
          `[gateway] Backup AI failed (${response.status}):`,
          errorText.slice(0, 500),
        );
      }
    } catch (error) {
      console.error("[gateway] Backup AI provider failed", error);
    }
  }

  throw new OcrError(
    "All available analysis services are currently unavailable. Please try again.",
    503,
  );
}

/* ------------------------------------------------------------------ */
/* JSON parsing                                                        */
/* ------------------------------------------------------------------ */

function parseJson<T>(raw: string): T | undefined {
  if (!raw || typeof raw !== "string") return undefined;

  let cleaned = raw.trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Continue with embedded JSON extraction.
  }

  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    return undefined;
  }

  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return undefined;
  }
}

/* ------------------------------------------------------------------ */
/* Stage 1 — image quality check + OCR                                */
/* ------------------------------------------------------------------ */

const OCR_PROMPT = `You are the image-quality and OCR stage of a Legal Metrology inspection pipeline.

You receive ONE photograph of a packaged commodity.

STEP 1 — quality assessment.
Judge resolution, blur, glare, text visibility, package visibility and orientation.

STEP 2 — OCR.
Transcribe every legible text region exactly as printed.
Never translate, correct, complete or invent text.

Return STRICT JSON only.
Do not return markdown.
Do not return explanations outside the JSON.

Required JSON structure:

{
  "quality": {
    "verdict": "good",
    "score": 85,
    "resolution": "adequate",
    "orientation": "upright",
    "issues": [],
    "note": ""
  },
  "language": "en",
  "text": "full readable text",
  "tokens": [
    {
      "text": "exact readable text",
      "confidence": 90,
      "language": "en",
      "bbox": {
        "x": 0.1,
        "y": 0.2,
        "w": 0.3,
        "h": 0.05
      }
    }
  ]
}

Rules:

- "verdict" must be "good", "warning", or "poor".
- "score" must be between 0 and 100.
- "language" can be "en", "hi", "te", "mixed", or another appropriate language code.
- "text" must contain only text actually visible in the image.
- Never invent missing words, numbers, prices, dates or declarations.
- Each token must contain readable text.
- confidence must be between 0 and 100.
- bbox values must be normalized from 0 to 1.
- bbox must represent the approximate location of the text in the image.
- Never use pixel coordinates.
- If nothing readable is visible, return:
  "verdict": "poor",
  "text": "",
  "tokens": []
- If the image contains partially readable text, transcribe only what can reasonably be read and reduce confidence.
- "poor" means the label text cannot be relied on; explain why in issues.`;

/** Swap this for the FastAPI/PaddleOCR service when it is available. */
async function runExternalOcr(file: ScanFileInput, dataUrl: string) {
  const response = await fetch(`${OCR_ENDPOINT.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: file.name,
      side: file.side,
      mime: file.mime,
      image: dataUrl,
    }),
  });

  if (!response.ok) {
    throw new OcrError(
      `OCR service error (${response.status}).`,
      response.status,
    );
  }

  return (await response.json()) as OcrPayload;
}

type OcrPayload = {
  quality?: Partial<ImageQuality>;
  language?: string;
  text?: string;
  tokens?: {
    text?: string;
    confidence?: number;
    language?: string;
    bbox?: Partial<BBox>;
  }[];
};

async function runOcr(
  file: ScanFileInput,
  dataUrl: string,
): Promise<OcrPayload> {
  if (OCR_ENDPOINT) {
    return runExternalOcr(file, dataUrl);
  }

  const block =
    file.mime === "application/pdf"
      ? {
          type: "file",
          file: {
            filename: file.name,
            file_data: dataUrl,
          },
        }
      : {
          type: "image_url",
          image_url: {
            url: dataUrl,
          },
        };

  const raw = await gateway({
    model: "openrouter/free",

    // Important:
    // Ask OpenRouter/free models to return machine-readable JSON.
    response_format: {
      type: "json_object",
    },

    messages: [
      {
        role: "system",
        content: OCR_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `This is the ${file.side} side of the package. Assess the image quality and transcribe all readable package text.`,
          },
          block,
        ],
      },
    ],
  });

  const parsed = parseJson<OcrPayload>(raw);

  if (!parsed) {
    console.error(
      "[runOcr] Could not parse AI response:",
      raw.slice(0, 1000),
    );

    throw new OcrError(
      "The OCR response could not be interpreted.",
      502,
    );
  }

  return parsed;
}

/* ------------------------------------------------------------------ */
/* OCR normalization                                                   */
/* ------------------------------------------------------------------ */

function clampPct(n: unknown, fallback = 0): number {
  const v =
    typeof n === "number" && Number.isFinite(n)
      ? n
      : fallback;

  return Math.round(
    Math.min(100, Math.max(0, v)),
  );
}

/**
 * Normalize a model-reported box to 0–1 fractions.
 */
function normBox(
  b: Partial<BBox> | undefined,
): BBox {
  const nums = [
    b?.x,
    b?.y,
    b?.w,
    b?.h,
  ].map((n) =>
    typeof n === "number" && Number.isFinite(n)
      ? n
      : NaN,
  );

  if (nums.some((n) => Number.isNaN(n))) {
    return {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }

  const max = Math.max(
    ...nums.map(Math.abs),
  );

  const divisor =
    max <= 1.001
      ? 1
      : max <= 1000
        ? 1000
        : max <= 4000
          ? 4000
          : max;

  const [x, y, w, h] = nums.map((n) =>
    Math.min(
      1,
      Math.max(0, n / divisor),
    ),
  ) as [
    number,
    number,
    number,
    number,
  ];

  if (
    w <= 0.002 ||
    h <= 0.002 ||
    x >= 1 ||
    y >= 1
  ) {
    return {
      x: 0,
      y: 0,
      w: 0,
      h: 0,
    };
  }

  return {
    x,
    y,
    w: Math.min(w, 1 - x),
    h: Math.min(h, 1 - y),
  };
}

function toPage(
  file: ScanFileInput,
  payload: OcrPayload,
): InspectionPage {
  const tokens: OcrToken[] = (
    payload.tokens ?? []
  )
    .map((t) => ({
      text: (t.text ?? "").trim(),

      confidence: clampPct(
        t.confidence,
        70,
      ),

      language:
        t.language?.trim() ||
        payload.language?.trim() ||
        "en",

      bbox: normBox(t.bbox),
    }))
    .filter(
      (t) => t.text.length > 0,
    );

  const q = payload.quality ?? {};

  const verdict =
    q.verdict === "good" ||
    q.verdict === "warning" ||
    q.verdict === "poor"
      ? q.verdict
      : "warning";

  const text =
    (payload.text ?? "").trim();

  const quality: ImageQuality = {
    verdict:
      text.length === 0
        ? "poor"
        : verdict,

    score: clampPct(
      q.score,
      verdict === "good"
        ? 85
        : 55,
    ),

    issues:
      Array.isArray(q.issues)
        ? q.issues.filter(
            (i): i is string =>
              typeof i === "string",
          )
        : [],

    resolution:
      typeof q.resolution === "string"
        ? q.resolution
        : "unknown",

    orientation:
      typeof q.orientation === "string"
        ? q.orientation
        : "unknown",

    note:
      typeof q.note === "string"
        ? q.note
        : "",
  };

  return {
    name: file.name,
    path: file.path,
    side: file.side,
    ok: text.length > 0,
    text,
    tokens,
    quality,
    language:
      payload.language?.trim() ||
      "en",
  };
}

/* ------------------------------------------------------------------ */
/* Stage 2 — extraction + versioned rule engine                        */
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

function enginePrompt(
  rules: RuleRow[],
  version: string,
): string {
  const catalogue = rules
    .map(
      (r) =>
        `${r.rule_code} | declaration=${r.declaration_type} | severity=${r.severity} | applies_to=${(r.applicability ?? []).join(",")} | method=${r.validation_method} | ref=${r.source_ref}
    ${r.requirement}`,
    )
    .join("\n");

  return `You are the declaration-extraction and rule-checking stage of a Legal Metrology inspection platform in India.

You receive OCR output from one or more photographed sides of the SAME package.
Treat all sides as one commodity.

RULE CATALOGUE (ruleset version ${version}) — evaluate ONLY these rules:

${catalogue}

Return STRICT JSON only.
Do not return markdown.
Do not return explanations outside JSON.

Required JSON structure:

{
  "usable": true,
  "reason": "",
  "product": "",
  "brand": "",
  "manufacturer": "",
  "category": "Packaged food",
  "categoryKey": "food",
  "declarations": [],
  "findings": []
}

categoryKey must be one of:
"food"
"personal-care"
"household"
"imported"
"ecommerce"
"other"

Declaration structure:

{
  "key": "declaration_type",
  "label": "human readable label",
  "value": "exactly as printed or Not detected",
  "detected": true,
  "applicable": true,
  "ocrConfidence": 90,
  "detectionConfidence": 90,
  "source": "exact filename",
  "language": "en"
}

Finding structure:

{
  "ruleCode": "LM-001",
  "status": "pass",
  "finding": "Plain explanation",
  "extracted": "exact extracted value or Not detected",
  "ocrConfidence": 90,
  "source": "exact filename",
  "recommendation": "No action required."
}

Hard rules:

- Use ONLY the supplied OCR text.
- NEVER invent a value.
- Emit one finding for EVERY catalogue rule that applies to the detected category.
- Skip rules that do not apply.
- "pass" means the requirement is demonstrably satisfied by readable text.
- "potential-violation" means the required declaration is absent or clearly defective.
- "review" means text is ambiguous, partially legible, low confidence, or physical measurement is required.
- Any rule whose validation_method is "manual-verification" MUST be "review".
- source must be an exact supplied filename.
- Never state a final legal conclusion.
- These are automated screening outcomes only.
- If information is missing, use "Not detected" rather than inventing it.`;
}

/* ------------------------------------------------------------------ */
/* Orchestration                                                       */
/* ------------------------------------------------------------------ */

function normStatus(
  v: unknown,
): ScreeningStatus {
  return v === "pass" ||
    v === "review" ||
    v === "potential-violation"
    ? v
    : "review";
}

function normSeverity(
  v: unknown,
): Severity {
  return v === "high" ||
    v === "medium" ||
    v === "low"
    ? v
    : "medium";
}

/** Locate the OCR token that best matches an extracted value. */
function locate(
  pages: InspectionPage[],
  source: string,
  value: string,
) {
  const page =
    pages.find(
      (p) => p.name === source,
    ) ?? pages[0];

  if (!page) {
    return undefined;
  }

  const needle = value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

  if (
    !needle ||
    needle === "not detected"
  ) {
    return {
      page,
      token: undefined,
    };
  }

  const token =
    page.tokens.find((t) =>
      t.text
        .toLowerCase()
        .includes(needle),
    ) ??
    page.tokens.find(
      (t) =>
        needle.includes(
          t.text.toLowerCase(),
        ) &&
        t.text.length > 2,
    );

  return {
    page,
    token,
  };
}

export async function runInspection(
  files: ScanFileInput[],
  fetchBytes: (
    file: ScanFileInput,
  ) => Promise<string>,
  inspector: string,
): Promise<Inspection> {
  /* -------------------------------------------------------------- */
  /* Stage 1 — quality + OCR                                       */
  /* -------------------------------------------------------------- */

  const pages: InspectionPage[] = [];

  for (const file of files) {
    let dataUrl: string;

    try {
      dataUrl = await fetchBytes(file);
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        "[runInspection] storage read failed",
        file.path,
        detail,
      );

      pages.push(
        failedPage(
          file,
          `The uploaded file could not be read from storage (${detail}).`,
        ),
      );

      continue;
    }

    try {
      const ocrResult =
        await runOcr(
          file,
          dataUrl,
        );

      pages.push(
        toPage(
          file,
          ocrResult,
        ),
      );
    } catch (error) {
      console.error(
        "[runInspection] OCR failed",
        file.name,
        error,
      );

      pages.push(
        failedPage(
          file,
          error instanceof OcrError
            ? error.message
            : "OCR failed for this file.",
        ),
      );
    }
  }

  const readable =
    pages.filter(
      (p) =>
        p.ok &&
        p.tokens.length > 0,
    );

  if (readable.length === 0) {
    const poor = pages
      .map((p) =>
        p.quality.issues.join(
          "; ",
        ),
      )
      .filter(Boolean)
      .join(" · ");

    throw new OcrError(
      `Insufficient readable information — please capture clearer images of the package.${
        poor
          ? ` Detected issues: ${poor}.`
          : ""
      }`,
      422,
    );
  }

  /* -------------------------------------------------------------- */
  /* Stage 2 — merged OCR payload                                  */
  /* -------------------------------------------------------------- */

  const seen =
    new Set<string>();

  const merged = readable
    .map((p) => {
      const lines =
        p.tokens
          .filter((t) => {
            const key =
              t.text
                .toLowerCase()
                .replace(
                  /[^a-z0-9₹.]/g,
                  "",
                );

            if (key.length <= 3) {
              return true;
            }

            if (
              seen.has(key)
            ) {
              return false;
            }

            seen.add(key);
            return true;
          })
          .map(
            (t) =>
              `  [conf ${t.confidence}%] ${t.text}`,
          )
          .join("\n");

      return `FILE: ${p.name} (side: ${p.side}, capture quality: ${p.quality.verdict})
${lines}`;
    })
    .join("\n\n");

  /* -------------------------------------------------------------- */
  /* Load Legal Metrology rules                                    */
  /* -------------------------------------------------------------- */

  const {
    rules,
    version,
  } = await loadActiveRules();

  /* -------------------------------------------------------------- */
  /* Stage 2 AI rule engine                                       */
  /* -------------------------------------------------------------- */

  const raw =
    await gateway({
      model: "openrouter/free",

      // Important:
      // Force structured JSON output where supported.
      response_format: {
        type: "json_object",
      },

      messages: [
        {
          role: "system",
          content:
            enginePrompt(
              rules,
              version,
            ),
        },
        {
          role: "user",
          content:
            `OCR output from the uploaded package sides:\n\n${merged}`,
        },
      ],
    });

  const engine =
    parseJson<EngineOutput>(
      raw,
    );

  if (!engine) {
    console.error(
      "[runInspection] Could not parse rule-engine response:",
      raw.slice(0, 1500),
    );

    throw new OcrError(
      "The rule engine response could not be interpreted.",
      502,
    );
  }

  if (
    engine.usable === false
  ) {
    throw new OcrError(
      engine.reason?.trim() ||
        "Insufficient readable information — please capture clearer images of the package.",
      422,
    );
  }

  const categoryKey =
    engine.categoryKey?.trim() ||
    "other";

  const ruleByCode =
    new Map(
      rules.map((r) => [
        r.rule_code,
        r,
      ]),
    );

  /* -------------------------------------------------------------- */
  /* Declarations                                                   */
  /* -------------------------------------------------------------- */

  const declarations:
    DeclarationFinding[] =
    (
      engine.declarations ??
      []
    ).map((d) => {
      const value =
        d.value?.trim() ||
        "Not detected";

      const source =
        d.source?.trim() ||
        "";

      const hit =
        locate(
          pages,
          source,
          value,
        );

      return {
        key:
          d.key?.trim() ||
          "other",

        label:
          d.label?.trim() ||
          d.key?.trim() ||
          "Declaration",

        value,

        detected:
          d.detected === true,

        applicable:
          d.applicable !== false,

        ocrConfidence:
          clampPct(
            d.ocrConfidence,
            hit?.token
              ?.confidence ??
              0,
          ),

        detectionConfidence:
          clampPct(
            d.detectionConfidence,
            60,
          ),

        source:
          hit?.page?.name ??
          source,

        side:
          hit?.page?.side,

        bbox:
          hit?.token?.bbox,

        language:
          d.language?.trim() ||
          hit?.token
            ?.language ||
          "en",
      };
    });

  /* -------------------------------------------------------------- */
  /* Findings                                                       */
  /* -------------------------------------------------------------- */

  const findings:
    RuleFinding[] = [];

  (
    engine.findings ??
    []
  ).forEach(
    (f, i) => {
      const rule =
        ruleByCode.get(
          f.ruleCode?.trim() ??
            "",
        );

      if (
        !rule ||
        !ruleApplies(
          rule,
          categoryKey,
        )
      ) {
        return;
      }

      const extracted =
        f.extracted?.trim() ||
        "Not detected";

      const hit =
        locate(
          pages,
          f.source?.trim() ||
            "",
          extracted,
        );

      const status:
        ScreeningStatus =
        rule.validation_method ===
        "manual-verification"
          ? "review"
          : normStatus(
              f.status,
            );

      findings.push({
        id: `f${i + 1}`,

        ruleCode:
          rule.rule_code,

        declaration:
          rule.declaration_type,

        requirement:
          rule.requirement,

        status,

        severity:
          normSeverity(
            rule.severity,
          ),

        finding:
          f.finding?.trim() ||
          "",

        extracted,

        ocrConfidence:
          clampPct(
            f.ocrConfidence,
            hit?.token
              ?.confidence ??
              0,
          ),

        source:
          hit?.page?.name ??
          f.source?.trim() ??
          "",

        side:
          hit?.page?.side,

        bbox:
          hit?.token?.bbox,

        ruleRef:
          rule.source_ref,

        recommendation:
          f.recommendation?.trim() ||
          (
            status === "pass"
              ? "No action required."
              : "Manual verification by the inspecting officer."
          ),

        applicability:
          (
            rule.applicability ??
            []
          ).join(", "),
      });
    },
  );

  if (
    findings.length === 0
  ) {
    throw new OcrError(
      "No applicable rule checks could be derived from the extracted text.",
      422,
    );
  }

  /* -------------------------------------------------------------- */
  /* Screening result                                               */
  /* -------------------------------------------------------------- */

  const counts = {
    pass:
      findings.filter(
        (f) =>
          f.status ===
          "pass",
      ).length,

    review:
      findings.filter(
        (f) =>
          f.status ===
          "review",
      ).length,

    violation:
      findings.filter(
        (f) =>
          f.status ===
          "potential-violation",
      ).length,
  };

  const screening:
    ScreeningStatus =
    counts.violation > 0
      ? "potential-violation"
      : counts.review > 0
        ? "review"
        : "pass";

  /* -------------------------------------------------------------- */
  /* Inspection prioritisation                                      */
  /* -------------------------------------------------------------- */

  const highSeverity =
    findings.filter(
      (f) =>
        f.status ===
          "potential-violation" &&
        f.severity === "high",
    ).length;

  const poorCaptures =
    pages.filter(
      (p) =>
        p.quality.verdict ===
        "poor",
    ).length;

  const priority:
    Severity =
    highSeverity >= 2 ||
    counts.violation >= 4
      ? "high"
      : counts.violation > 0 ||
          counts.review >= 3 ||
          poorCaptures > 0
        ? "medium"
        : "low";

  /* -------------------------------------------------------------- */
  /* Final inspection object                                        */
  /* -------------------------------------------------------------- */

  return {
    id: `LM-${new Date().getFullYear()}-${Math.floor(
      Math.random() *
        900000 +
        100000,
    )}`,

    mode: "real",

    product:
      engine.product?.trim() ||
      "Not determined — manual verification required",

    brand:
      engine.brand?.trim() ||
      "",

    manufacturer:
      engine.manufacturer?.trim() ||
      "Not determined — manual verification required",

    category:
      engine.category?.trim() ||
      "Other packaged commodity",

    categoryKey,

    inspector,

    analyzedAt:
      new Date().toISOString(),

    rulesetVersion:
      version,

    screening,

    priority,

    counts,

    declarations,

    findings,

    pages,
  };
}

/* ------------------------------------------------------------------ */
/* Failed page                                                        */
/* ------------------------------------------------------------------ */

function failedPage(
  file: ScanFileInput,
  error: string,
): InspectionPage {
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
