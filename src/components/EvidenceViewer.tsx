import { useEffect, useMemo, useState } from "react";

import type { BBox, InspectionPage, RuleFinding, ScreeningStatus } from "@/lib/compliance-data";
import { signedUrl } from "@/lib/inspection-client";
import { QualityPill } from "./ScreeningPill";

export type EvidenceFocus = {
  label: string;
  source?: string | undefined;
  bbox?: BBox | undefined;
  status: ScreeningStatus;
};

const boxColor: Record<ScreeningStatus, string> = {
  pass: "border-mint",
  review: "border-sun",
  "potential-violation": "border-peach",
};

const boxTint: Record<ScreeningStatus, string> = {
  pass: "bg-mint",
  review: "bg-sun",
  "potential-violation": "bg-peach",
};

/**
 * Evidence Viewer — renders the captured package image with bounding boxes
 * around every detected declaration. Selecting a finding zooms to its region.
 */
export function EvidenceViewer({
  pages,
  findings,
  focus,
  onClearFocus,
}: {
  pages: InspectionPage[];
  findings: RuleFinding[];
  focus?: EvidenceFocus | undefined;
  onClearFocus?: () => void;
}) {
  const usable = pages.filter((p) => p.path);
  const [activeName, setActiveName] = useState(usable[0]?.name ?? "");
  const [url, setUrl] = useState("");
  const [zoom, setZoom] = useState(false);

  useEffect(() => {
    if (focus?.source) {
      setActiveName(focus.source);
      setZoom(Boolean(focus.bbox));
    }
  }, [focus]);

  const page = usable.find((p) => p.name === activeName) ?? usable[0];

  useEffect(() => {
    let cancelled = false;
    setUrl("");
    if (!page?.path) return;
    void signedUrl(page.path).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [page?.path]);

  const boxes = useMemo(
    () =>
      findings
        .filter((f) => f.bbox && f.source === page?.name)
        .map((f) => ({ ...f, bbox: f.bbox as BBox })),
    [findings, page?.name],
  );

  const focusBox = focus?.bbox && focus.source === page?.name ? focus.bbox : undefined;

  const transform = (() => {
    if (!zoom || !focusBox) return undefined;
    const scale = Math.min(3, Math.max(1.4, 0.5 / Math.max(focusBox.w, focusBox.h, 0.08)));
    const cx = (focusBox.x + focusBox.w / 2) * 100;
    const cy = (focusBox.y + focusBox.h / 2) * 100;
    return { transform: `scale(${scale})`, transformOrigin: `${cx}% ${cy}%` };
  })();

  if (!page) {
    return (
      <p className="rounded-2xl bg-soft px-4 py-3 text-sm text-muted-ink">
        No package images are stored for this inspection.
      </p>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {usable.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => {
              setActiveName(p.name);
              setZoom(false);
              onClearFocus?.();
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold capitalize ring-1 ${
              p.name === page.name
                ? "bg-ink text-surface ring-ink"
                : "bg-surface text-ink ring-line hover:bg-soft"
            }`}
          >
            {p.side}
          </button>
        ))}
        <span className="ml-auto">
          <QualityPill verdict={page.quality.verdict} short />
        </span>
      </div>

      <div className="mt-3 overflow-hidden rounded-2xl bg-soft ring-1 ring-line">
        <div className="relative aspect-[4/5] w-full overflow-hidden">
          {url ? (
            <div className="absolute inset-0 transition-transform duration-500" style={transform}>
              <img
                src={url}
                alt={`${page.side} side of the inspected package`}
                className="size-full object-contain"
              />
              {boxes.map((b) => (
                <span
                  key={b.id}
                  title={`${b.declaration}: ${b.extracted}`}
                  className={`absolute border-2 ${boxColor[b.status]} ${
                    focus && focus.bbox === b.bbox ? "ring-2 ring-ink" : ""
                  }`}
                  style={{
                    left: `${b.bbox.x * 100}%`,
                    top: `${b.bbox.y * 100}%`,
                    width: `${Math.max(b.bbox.w, 0.02) * 100}%`,
                    height: `${Math.max(b.bbox.h, 0.02) * 100}%`,
                  }}
                >
                  <span
                    className={`absolute -top-0.5 left-0 -translate-y-full whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-bold text-surface ${boxTint[b.status]}`}
                  >
                    {b.declaration.replace(/_/g, " ")}
                  </span>
                </span>
              ))}
            </div>
          ) : (
            <div className="grid size-full place-items-center text-sm text-muted-ink">
              Loading evidence image…
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-ink">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-mint" /> Detected / verified
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-sun" /> Manual review
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm border-2 border-peach" /> Potential problem
        </span>
        {focusBox && (
          <button
            type="button"
            onClick={() => setZoom((z) => !z)}
            className="ml-auto rounded-full bg-surface px-3 py-1 font-semibold text-ink ring-1 ring-line"
          >
            {zoom ? "Reset zoom" : `Zoom to ${focus?.label}`}
          </button>
        )}
      </div>

      {page.quality.issues.length > 0 && (
        <p className="mt-3 rounded-2xl bg-soft px-4 py-3 text-xs text-muted-ink">
          <strong className="text-ink">Capture quality:</strong> {page.quality.score}/100 ·{" "}
          {page.quality.resolution} resolution · {page.quality.orientation} ·{" "}
          {page.quality.issues.join("; ")}
        </p>
      )}
    </div>
  );
}
