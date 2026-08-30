import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

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

type Preview = { id: string; url: string; name: string };

function ScanPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<Preview[]>([]);
  const [dragging, setDragging] = useState(false);
  const [stage, setStage] = useState(-1);

  useEffect(() => {
    if (stage < 0) return;
    if (stage >= pipeline.length) {
      const t = setTimeout(() => navigate({ to: "/results" }), 500);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setStage((s) => s + 1), 850);
    return () => clearTimeout(t);
  }, [stage, navigate]);

  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  function addFiles(files: FileList | null) {
    if (!files) return;
    const next = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .map((f) => ({ id: `${f.name}-${f.lastModified}-${Math.random()}`, url: URL.createObjectURL(f), name: f.name }));
    setPreviews((p) => [...p, ...next]);
  }

  const analysing = stage >= 0;

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
            <p className="mt-1 text-sm text-muted-ink">PNG or JPG · multiple images supported</p>
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
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
          </div>

          {previews.length > 0 && (
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {previews.map((p) => (
                <figure key={p.id} className="overflow-hidden rounded-2xl bg-surface ring-1 ring-line">
                  <img src={p.url} alt={p.name} className="aspect-[4/5] w-full object-cover" />
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
                ? "Add at least one image to begin. You can also run the demo with sample data."
                : `${previews.length} image${previews.length > 1 ? "s" : ""} ready for analysis.`}
            </p>

            <button
              type="button"
              disabled={analysing}
              onClick={() => setStage(0)}
              className="mt-4 w-full rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface disabled:opacity-60"
            >
              {analysing ? "Analysing…" : "Analyze compliance"}
            </button>

            <ol className="mt-6 space-y-3">
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
                  style={{ width: `${Math.min(100, (stage / pipeline.length) * 100)}%` }}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
