import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import {
  ACCEPTED_MIME_TYPES,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  analyzeLabel,
} from "@/lib/analysis.functions";
import { saveAnalysis } from "@/lib/analysis-store";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scan a product label — VigilMetro" },
      {
        name: "description",
        content:
          "Upload or capture packaged product label images and run an automated Legal Metrology compliance analysis.",
      },
      { property: "og:title", content: "Scan a product label — VigilMetro" },
      {
        property: "og:description",
        content: "Drag and drop label images, preview them, and analyse compliance in seconds.",
      },
    ],
  }),
  component: ScanPage,
});

const pipeline = [
  "Image processing",
  "Text extraction (OCR)",
  "Label information detection",
  "Compliance verification",
  "Report generation",
];

type Preview = { id: string; dataUrl: string; name: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function ScanPage() {
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeLabel);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(-1);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Advance the visible pipeline while the request is in flight.
  useEffect(() => {
    if (!analysing) return;
    const t = setInterval(() => setStage((s) => Math.min(s + 1, pipeline.length - 2)), 1200);
    return () => clearInterval(t);
  }, [analysing]);

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(undefined);
    const accepted: Preview[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      const type = file.type.toLowerCase();
      const extOk = /\.(jpe?g|png)$/i.test(file.name);
      if (!(ACCEPTED_MIME_TYPES as readonly string[]).includes(type) && !extOk) {
        rejected.push(`${file.name} — unsupported format (use JPG, JPEG or PNG)`);
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        rejected.push(`${file.name} — larger than 6 MB`);
        continue;
      }
      try {
        const dataUrl = await readAsDataUrl(file);
        accepted.push({ id: `${file.name}-${file.lastModified}-${Math.random()}`, dataUrl, name: file.name });
      } catch {
        rejected.push(`${file.name} — could not be read`);
      }
    }

    if (accepted.length > 0) {
      setPreviews((p) => [...p, ...accepted].slice(0, MAX_IMAGES));
    }
    if (rejected.length > 0) setError(rejected.join(" · "));
  }

  function removePreview(id: string) {
    setPreviews((p) => p.filter((x) => x.id !== id));
  }

  async function runAnalysis() {
    if (previews.length === 0 || analysing) return;
    setError(undefined);
    setAnalysing(true);
    setStage(0);
    try {
      const response = await analyze({
        data: { images: previews.map((p) => ({ dataUrl: p.dataUrl, name: p.name })) },
      });
      if (!response.ok) {
        setError(response.error);
        setAnalysing(false);
        setStage(-1);
        return;
      }
      setStage(pipeline.length);
      saveAnalysis({ result: response.result, imageDataUrl: previews[0]!.dataUrl });
      await navigate({ to: "/results" });
    } catch {
      setError("The analysis request failed. Please check your connection and try again.");
      setAnalysing(false);
      setStage(-1);
    }
  }

  const canAnalyse = previews.length > 0 && !analysing;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
        Scan a packaged product
      </h1>
      <p className="mt-2 max-w-[60ch] text-pretty text-muted-ink">
        Add clear photographs of the principal display panel and any side panels carrying statutory
        declarations.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
            className={`rounded-3xl border-2 border-dashed p-10 text-center ${
              dragging ? "border-plum bg-plum/10" : "border-line bg-surface"
            }`}
          >
            <div className="mx-auto grid size-12 place-items-center rounded-2xl bg-soft font-mono text-sm text-plum">
              IMG
            </div>
            <p className="mt-4 font-display text-lg font-bold text-ink">
              Drag &amp; drop label images here
            </p>
            <p className="mt-1 text-sm text-muted-ink">
              JPG, JPEG or PNG · up to {MAX_IMAGES} images · max 6 MB each
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-surface"
              >
                Choose files
              </button>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="rounded-full bg-surface px-5 py-2.5 text-sm font-semibold text-ink ring-1 ring-line"
              >
                Use camera
              </button>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,.jpg,.jpeg,.png"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {previews.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {previews.map((p) => (
                <figure key={p.id} className="relative overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
                  <img src={p.dataUrl} alt={`Preview of ${p.name}`} className="aspect-[4/5] w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => removePreview(p.id)}
                    disabled={analysing}
                    aria-label={`Remove ${p.name}`}
                    className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-1 text-xs font-semibold text-surface disabled:opacity-50"
                  >
                    Remove
                  </button>
                  <figcaption className="truncate px-3 py-2 text-xs text-muted-ink">{p.name}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-lg font-bold text-ink">Analysis</h2>
            <p className="mt-1 text-sm text-muted-ink">
              {previews.length === 0
                ? "Add at least one JPG or PNG label image to begin."
                : `${previews.length} image${previews.length > 1 ? "s" : ""} ready for analysis.`}
            </p>

            {error && (
              <p
                role="alert"
                className="mt-3 rounded-2xl bg-peach/15 px-4 py-3 text-sm font-medium text-peach"
              >
                {error}
              </p>
            )}

            <button
              type="button"
              disabled={!canAnalyse}
              onClick={() => void runAnalysis()}
              className="mt-4 w-full rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysing ? "Analysing…" : "Analyze compliance"}
            </button>

            <ol className="mt-6 space-y-3" aria-live="polite">
              {pipeline.map((label, i) => {
                const done = stage > i;
                const active = stage === i;
                return (
                  <li key={label} className="flex items-center gap-3 text-sm">
                    <span
                      className={`grid size-6 place-items-center rounded-full font-mono text-[10px] ${
                        done
                          ? "bg-mint text-surface"
                          : active
                            ? "bg-plum text-surface"
                            : "bg-soft text-muted-ink"
                      }`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={done || active ? "font-medium text-ink" : "text-muted-ink"}>
                      {label}
                    </span>
                  </li>
                );
              })}
            </ol>

            {analysing && (
              <div className="mt-5 h-2 overflow-hidden rounded-full bg-soft">
                <div
                  className="h-full rounded-full bg-plum transition-all duration-500"
                  style={{ width: `${Math.min(100, ((stage + 1) / pipeline.length) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
