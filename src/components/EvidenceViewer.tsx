import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { BBox, InspectionPage, RuleFinding, ScreeningStatus } from "@/lib/compliance-data";
import { signedUrl } from "@/lib/inspection-client";
import { QualityPill } from "./ScreeningPill";

/** A box is usable only when it has real geometry inside the image. */
function isValidBox(b?: BBox): b is BBox {
  return (
    !!b &&
    b.w > 0.002 &&
    b.h > 0.002 &&
    b.x >= 0 &&
    b.y >= 0 &&
    b.x < 1 &&
    b.y < 1 &&
    b.w <= 1 &&
    b.h <= 1
  );
}


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

  /** Measured rectangle of the rendered (object-contain) image inside its frame. */
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rect, setRect] = useState({ left: 0, top: 0, width: 0, height: 0 });

  const measure = useCallback(() => {
    const frame = frameRef.current;
    const img = imgRef.current;
    if (!frame || !img || !img.naturalWidth || !img.naturalHeight) return;
    const cw = frame.clientWidth;
    const ch = frame.clientHeight;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const width = img.naturalWidth * scale;
    const height = img.naturalHeight * scale;
    setRect({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
  }, []);

  useLayoutEffect(() => {
    measure();
    const frame = frameRef.current;
    if (!frame || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(frame);
    return () => ro.disconnect();
  }, [measure, url]);

  /** Resolve each finding's box: stored coordinates first, matching OCR token otherwise. */
  const boxes = useMemo(() => {
    if (!page) return [];
    const tokens = page.tokens.filter((t) => isValidBox(t.bbox));
    return findings
      .filter((f) => !f.source || f.source === page.name)
      .map((f) => {
        if (isValidBox(f.bbox)) return { ...f, box: f.bbox };
        const needle = (f.extracted ?? "").toLowerCase().replace(/\s+/g, " ").trim();
        if (!needle || needle === "not detected") return undefined;
        const hit =
          tokens.find((t) => t.text.toLowerCase().includes(needle)) ??
          tokens.find((t) => needle.includes(t.text.toLowerCase()) && t.text.length > 3);
        return hit ? { ...f, box: hit.bbox } : undefined;
      })
      .filter((b): b is RuleFinding & { box: BBox } => Boolean(b));
  }, [findings, page]);

  const focusBox = (() => {
    if (!focus || (focus.source && focus.source !== page?.name)) return undefined;
    if (isValidBox(focus.bbox)) return focus.bbox;
    const match = boxes.find((b) => b.declaration === focus.label || b.extracted === focus.label);
    return match?.box;
  })();

  const transform = (() => {
    if (!zoom || !focusBox || !rect.width) return undefined;
    const scale = Math.min(3, Math.max(1.4, 0.5 / Math.max(focusBox.w, focusBox.h, 0.08)));
    const cx = rect.left + (focusBox.x + focusBox.w / 2) * rect.width;
    const cy = rect.top + (focusBox.y + focusBox.h / 2) * rect.height;
    return { transform: `scale(${scale})`, transformOrigin: `${cx}px ${cy}px` };
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
        <div ref={frameRef} className="relative aspect-[4/5] w-full overflow-hidden">
          {url ? (
            <div className="absolute inset-0 transition-transform duration-500" style={transform}>
              <img
                ref={imgRef}
                src={url}
                onLoad={measure}
                alt={`${page.side} side of the inspected package`}
                className="size-full object-contain"
              />
              {rect.width > 0 &&
                boxes.map((b) => {
                  const isFocused = focusBox === b.box;
                  return (
                    <span
                      key={b.id}
                      title={`${b.declaration}: ${b.extracted}`}
                      className={`absolute border-2 ${boxColor[b.status]} ${
                        isFocused ? "ring-2 ring-ink" : ""
                      }`}
                      style={{
                        left: rect.left + b.box.x * rect.width,
                        top: rect.top + b.box.y * rect.height,
                        width: Math.max(b.box.w * rect.width, 8),
                        height: Math.max(b.box.h * rect.height, 8),
                      }}
                    >
                      <span
                        className={`absolute -top-0.5 left-0 -translate-y-full whitespace-nowrap rounded px-1 py-0.5 text-[9px] font-bold text-surface ${boxTint[b.status]}`}
                      >
                        {b.declaration.replace(/_/g, " ")}
                      </span>
                    </span>
                  );
                })}
            </div>
          ) : (
            <div className="grid size-full place-items-center text-sm text-muted-ink">
              Loading evidence image…
            </div>
          )}
        </div>
      </div>

      {url && boxes.length === 0 && (
        <p className="mt-2 rounded-2xl bg-soft px-4 py-2 text-xs text-muted-ink">
          The OCR stage returned no usable coordinates for this image, so no boxes can be drawn.
          Re-run the scan to capture positions.
        </p>
      )}


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
