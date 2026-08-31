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
import { getInspectorName, saveInspection, setInspectorName } from "@/lib/analysis-store";
import { PACKAGE_SIDES, type PackageSide } from "@/lib/compliance-data";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/scan")({
  head: () => ({
    meta: [
      { title: "New inspection — VigilMetro" },
      {
        name: "description",
        content:
          "Capture every side of a packaged commodity, run an image quality check and an OCR-based Legal Metrology screening.",
      },
      { property: "og:title", content: "New inspection — VigilMetro" },
      {
        property: "og:description",
        content:
          "Multi-side package capture, automated quality checks and a versioned Legal Metrology rule engine.",
      },
    ],
  }),
  component: ScanPage,
});

const pipeline = [
  "Uploading package images",
  "Image quality check",
  "Text extraction (OCR)",
  "Declaration extraction",
  "Rule engine screening",
  "Recording inspection",
];

type UploadState = "ready" | "uploading" | "uploaded" | "failed";

type Selected = {
  id: string;
  file: File;
  name: string;
  mime: string;
  side: PackageSide;
  preview?: string | undefined;
  state: UploadState;
  message?: string | undefined;
};

function nextSide(used: PackageSide[]): PackageSide {
  return PACKAGE_SIDES.find((s) => s !== "other" && !used.includes(s)) ?? "other";
}

function ScanPage() {
  const navigate = useNavigate();
  const analyze = useServerFn(analyzeScan);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Selected[]>([]);
  const [inspector, setInspector] = useState("");
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(-1);
  const [analysing, setAnalysing] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => setInspector(getInspectorName()), []);

  useEffect(() => {
    if (!analysing || stage < 1) return;
    const t = setInterval(() => setStage((s) => Math.min(s + 1, pipeline.length - 2)), 3500);
    return () => clearInterval(t);
  }, [analysing, stage]);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(undefined);
    const rejected: string[] = [];
    const accepted: Selected[] = [];

    setItems((prev) => {
      const used = [...prev.map((p) => p.side)];
      for (const file of Array.from(files)) {
        if (prev.length + accepted.length >= MAX_FILES) {
          rejected.push(`${file.name} — an inspection accepts at most ${MAX_FILES} images`);
          continue;
        }
        const mime = file.type.toLowerCase();
        const known = (ACCEPTED_MIME_TYPES as readonly string[]).includes(mime);
        if (!known && !/\.(jpe?g|png|webp|pdf)$/i.test(file.name)) {
          rejected.push(`${file.name} — unsupported format (JPG, JPEG, PNG, WEBP or PDF)`);
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
        const resolved = known
          ? mime
          : /\.pdf$/i.test(file.name)
            ? "application/pdf"
            : /\.png$/i.test(file.name)
              ? "image/png"
              : /\.webp$/i.test(file.name)
                ? "image/webp"
                : "image/jpeg";
        const side = nextSide(used);
        used.push(side);
        accepted.push({
          id: `${file.name}-${file.lastModified}-${Math.random()}`,
          file,
          name: file.name,
          mime: resolved,
          side,
          preview: resolved === "application/pdf" ? undefined : URL.createObjectURL(file),
          state: "ready",
        });
      }
      return [...prev, ...accepted];
    });

    if (rejected.length > 0) setError(rejected.join(" · "));
  }

  function removeItem(id: string) {
    setItems((p) => {
      const target = p.find((x) => x.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return p.filter((x) => x.id !== id);
    });
  }

  function setSide(id: string, side: PackageSide) {
    setItems((p) => p.map((x) => (x.id === id ? { ...x, side } : x)));
  }

  async function runAnalysis() {
    if (items.length === 0 || analysing) return;
    setError(undefined);
    setAnalysing(true);
    setStage(0);
    setInspectorName(inspector);

    const folder = crypto.randomUUID();
    const uploaded: { path: string; name: string; mime: string; side: PackageSide }[] = [];

    for (const item of items) {
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, state: "uploading" } : x)));
      const ext = item.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${folder}/${item.side}-${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from(SCAN_BUCKET)
        .upload(path, item.file, { contentType: item.mime, upsert: false });

      if (uploadError) {
        setItems((p) =>
          p.map((x) => (x.id === item.id ? { ...x, state: "failed", message: uploadError.message } : x)),
        );
        continue;
      }
      uploaded.push({ path, name: item.name, mime: item.mime, side: item.side });
      setItems((p) => p.map((x) => (x.id === item.id ? { ...x, state: "uploaded" } : x)));
    }

    if (uploaded.length === 0) {
      setError("None of the images could be uploaded. Please check your connection and try again.");
      setAnalysing(false);
      setStage(-1);
      return;
    }

    setStage(1);

    try {
      const response = await analyze({
        data: { files: uploaded, inspector: inspector.trim() || "Unassigned officer" },
      });
      if (!response.ok) {
        setError(response.error);
        setAnalysing(false);
        setStage(-1);
        return;
      }
      setStage(pipeline.length);
      saveInspection(response.inspection);
      await navigate({ to: "/results", search: { id: response.scanId, demo: false } });
    } catch {
      setError("The inspection request failed. Please check your connection and try again.");
      setAnalysing(false);
      setStage(-1);
    }
  }

  const covered = new Set(items.map((i) => i.side));

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
          New inspection
        </h1>
        <span className="rounded-full bg-mint/15 px-3 py-1 text-xs font-bold text-mint">
          REAL ANALYSIS MODE
        </span>
      </div>
      <p className="mt-2 max-w-[68ch] text-pretty text-muted-ink">
        Capture every panel of the <strong className="text-ink">same package</strong>. All images are
        quality-checked, read by OCR and screened together, because the mandatory declarations rarely
        appear on a single side.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="mb-4 flex flex-wrap gap-2">
            {PACKAGE_SIDES.filter((s) => s !== "other").map((side) => (
              <span
                key={side}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ring-1 ${
                  covered.has(side)
                    ? "bg-mint/15 text-mint ring-mint/30"
                    : "bg-surface text-muted-ink ring-line"
                }`}
              >
                {side} {covered.has(side) ? "✓" : "+"}
              </span>
            ))}
          </div>

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
              Drag &amp; drop package images here
            </p>
            <p className="mt-1 text-sm text-muted-ink">
              JPG, JPEG, PNG, WEBP or PDF · up to {MAX_FILES} images · max 12 MB each
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-surface"
              >
                {items.length > 0 ? "Add more sides" : "Choose files"}
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
                <figure key={p.id} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
                  <div className="relative">
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
                  </div>
                  <figcaption className="space-y-1.5 px-3 py-2">
                    <label className="block">
                      <span className="sr-only">Package side for {p.name}</span>
                      <select
                        value={p.side}
                        disabled={analysing}
                        onChange={(e) => setSide(p.id, e.target.value as PackageSide)}
                        className="w-full rounded-lg bg-soft px-2 py-1 text-xs font-semibold capitalize text-ink"
                      >
                        {PACKAGE_SIDES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <span className="block truncate text-[11px] text-muted-ink">{p.name}</span>
                    <span
                      className={`block text-[11px] font-semibold ${
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
            <h2 className="font-display text-lg font-bold text-ink">Inspection</h2>

            <label className="mt-4 block text-sm">
              <span className="font-semibold text-ink">Inspecting officer</span>
              <input
                value={inspector}
                onChange={(e) => setInspector(e.target.value)}
                placeholder="Officer name / ID"
                className="mt-1 w-full rounded-xl bg-soft px-3 py-2 text-sm text-ink placeholder:text-muted-ink"
              />
            </label>

            <p className="mt-3 text-sm text-muted-ink">
              {items.length === 0
                ? "Add at least one package image to begin."
                : `${items.length} image${items.length > 1 ? "s" : ""} of one package ready for screening.`}
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
              disabled={items.length === 0 || analysing}
              onClick={() => void runAnalysis()}
              className="mt-4 w-full rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analysing ? "Screening…" : "Run compliance screening"}
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

            <p className="mt-5 border-t border-line pt-4 text-xs text-muted-ink">
              Automated screening only. Final legal verification must be performed by an authorised
              Legal Metrology officer.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
