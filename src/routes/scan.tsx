import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";

import {
  ACCEPTED_MIME_TYPES,
  MAX_FILES,
  MAX_FILE_BYTES,
  SCAN_BUCKET,
  analyzeScan,
} from "@/lib/analysis.functions";
import { saveAnalysis } from "@/lib/analysis-store";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "Scan a product label — VigilMetro" },
      {
        name: "description",
        content:
          "Upload or capture multiple packaged product label panels and run a real OCR-based Legal Metrology compliance analysis.",
      },
      { property: "og:title", content: "Scan a product label — VigilMetro" },
      {
        property: "og:description",
        content: "Add front, back and side panels of one product, then analyse compliance in seconds.",
      },
    ],
  }),
  component: ScanPage,
});

const pipeline = [
  "Uploading files",
  "Text extraction (OCR)",
  "Combining label information",
  "Compliance verification",
  "Report generation",
];

type UploadState = "ready" | "uploading" | "uploaded" | "failed";

type Selected = {
  id: string;
  file: File;
  name: string;
  mime: string;
  preview?: string | undefined;
  state: UploadState;
  path?: string;
  message?: string;
};

function extOk(name: string) {
  return /\.(jpe?g|png|webp|pdf)$/i.test(name);
}

function ScanPage() {
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeScan);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Selected[]>([]);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(-1);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!analysing) return;
    const t = setInterval(() => setStage((s) => Math.min(s + 1, pipeline.length - 2)), 2500);
    return () => clearInterval(t);
  }, [analysing]);

  useEffect(
    () => () => {
      items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(undefined);
    const accepted: Selected[] = [];
    const rejected: string[] = [];

    for (const file of Array.from(files)) {
      const mime = file.type.toLowerCase();
      const known = (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
      if (!known && !extOk(file.name)) {
        rejected.push(`${file.name} — unsupported format (use JPG, JPEG, PNG, WEBP or PDF)`);
        continue;
      }
      if (file.size > MAX_FILE_BYTES) {
        rejected.push(`${file.name} — larger than 12 MB`);
        continue;
      }
      if (file.size === 0) {
        rejected.push(`${file.name} — the file is empty`);
        continue;
      }
      const resolvedMime = known
        ? mime
        : /\.pdf$/i.test(file.name)
          ? "application/pdf"
          : /\.png$/i.test(file.name)
            ? "image/png"
            : /\.webp$/i.test(file.name)
              ? "image/webp"
              : "image/jpeg";
      accepted.push({
        id: `${file.name}-${file.lastModified}-${Math.random()}`,
        file,
        name: file.name,
        mime: resolvedMime,
        preview: resolvedMime === "application/pdf" ? undefined : URL.createObjectURL(file),
        state: "ready",
      });
    }

    if (accepted.length > 0) {
      setItems((p) => {
        const room = Math.max(0, MAX_FILES - p.length);
        if (accepted.length > room) {
          setError(`Only ${MAX_FILES} files can be analysed in one scan.`);
        }
        return [...p, ...accepted.slice(0, room)];
      });
    }
    if (rejected.length > 0) setError(rejected.join(" · "));
  }

  function removeItem(id: string) {
    setItems((p) => {
      p.find((x) => x.id === id)?.preview && URL.revokeObjectURL(p.find((x) => x.id === id)!.preview!);
      return p.filter((x) => x.id !== id);
    });
  }

  async function runAnalysis() {
    if (items.length === 0 || analysing) return;
    setError(undefined);
    setAnalysing(true);
    setStage(0);

    const scanFolder = crypto.randomUUID();
    const uploaded: { path: string; name: string; mime: string }[] = [];
    const failures: string[] = [];

    for (const item of items) {
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, state: "uploading" } : x)));
      const ext = item.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${scanFolder}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(path, item.file, { contentType: item.mime, upsert: false });

      if (uploadError) {
        failures.push(item.name);
        setItems((p) =>
          p.map((x) =>
            x.id === item.id ? { ...x, state: "failed", message: uploadError.message } : x,
          ),
        );
        continue;
      }
      uploaded.push({ path, name: item.name, mime: item.mime });
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, state: "uploaded", path } : x)));
    }

    if (uploaded.length === 0) {
      setError("None of the files could be uploaded. Please check your connection and try again.");
      setAnalysing(false);
      setStage(-1);
      return;
    }

    setStage(1);

    try {
      const response = await analyze({ data: { files: uploaded } });
      if (!response.ok) {
        setError(response.error);
        setAnalysing(false);
        setStage(-1);
        return;
      }
      setStage(pipeline.length);
      saveAnalysis({ result: response.result, scanId: response.scanId, files: uploaded });
      const failedPages = (response.result.pages ?? []).filter((p) => !p.ok).map((p) => p.name);
      if (failures.length > 0 || failedPages.length > 0) {
        console.warn("Files skipped:", [...failures, ...failedPages].join(", "));
      }
      await navigate({ to: "/results", search: response.scanId ? { id: response.scanId } : {} });
    } catch {
      setError("The analysis request failed. Please check your connection and try again.");
      setAnalysing(false);
      setStage(-1);
    }
  }

  const canAnalyse = items.length > 0 && !analysing;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
        Scan a packaged product
      </h1>
      <p className="mt-2 max-w-[60ch] text-pretty text-muted-ink">
        Add clear photographs of the front, back, side and any other panels of the{" "}
        <strong className="text-ink">same product</strong>. All files are analysed together as one
        packaged commodity.
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
              addFiles(e.dataTransfer.files);
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
              JPG, JPEG, PNG, WEBP or PDF · up to {MAX_FILES} files · max 12 MB each
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-surface"
              >
                {items.length > 0 ? "Add more files" : "Choose files"}
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
              accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {items.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((p) => (
                <figure
                  key={p.id}
                  className="relative overflow-hidden rounded-2xl bg-surface ring-1 ring-line"
                >
                  {p.preview ? (
                    <img
                      src={p.preview}
                      alt={`Preview of ${p.name}`}
                      className="aspect-[4/5] w-full object-cover"
                    />
                  ) : (
                    <div className="grid aspect-[4/5] w-full place-items-center bg-soft font-mono text-sm text-plum">
                      PDF
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeItem(p.id)}
                    disabled={analysing}
                    aria-label={`Remove ${p.name}`}
                    className="absolute right-2 top-2 rounded-full bg-ink/80 px-2 py-1 text-xs font-semibold text-surface disabled:opacity-50"
                  >
                    Remove
                  </button>
                  <figcaption className="px-3 py-2">
                    <span className="block truncate text-xs text-muted-ink">{p.name}</span>
                    <span
                      className={`text-[11px] font-semibold ${
                        p.state === "failed"
                          ? "text-peach"
                          : p.state === "uploaded"
                            ? "text-mint"
                            : "text-muted-ink"
                      }`}
                    >
                      {p.state === "ready"
                        ? "Ready"
                        : p.state === "uploading"
                          ? "Uploading…"
                          : p.state === "uploaded"
                            ? "Uploaded"
                            : `Upload failed${p.message ? ` — ${p.message}` : ""}`}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-5">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-lg font-bold text-ink">Analysis</h2>
            <p className="mt-1 text-sm text-muted-ink">
              {items.length === 0
                ? "Add at least one label file to begin."
                : `${items.length} file${items.length > 1 ? "s" : ""} of one product ready for analysis.`}
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
