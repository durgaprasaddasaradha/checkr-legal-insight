import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";

import { ConfidenceBar, ScreeningPill, SeverityPill } from "@/components/ScreeningPill";
import { EvidenceViewer, type EvidenceFocus } from "@/components/EvidenceViewer";
import { compareListing } from "@/lib/analysis.functions";
import { loadInspection, saveInspection } from "@/lib/analysis-store";
import {
  DECLARATION_KEYS,
  type Inspection,
  type OfficerStatus,
  type OnlineListingComparison,
  type RuleFinding,
  screeningLabel,
} from "@/lib/compliance-data";
import { fetchInspection, formatDate, saveVerification } from "@/lib/inspection-client";

type Search = { id?: string | undefined; demo?: boolean | undefined };

export const Route = createFileRoute("/results")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    id: typeof search["id"] === "string" ? (search["id"] as string) : undefined,
    demo: search["demo"] === true || search["demo"] === "true",
  }),

  head: () => ({
    meta: [
      { title: "Inspection report — VigilMetro" },
      {
        name: "description",
        content:
          "Evidence-linked Legal Metrology screening report with per-rule findings, OCR confidence, officer verification and an audit trail.",
      },
      { property: "og:title", content: "Inspection report — VigilMetro" },
      {
        property: "og:description",
        content: "Per-rule findings with bounding-box evidence and officer verification.",
      },
    ],
  }),
  component: ResultsPage,
});

const officerLabels: Record<OfficerStatus, string> = {
  pending: "Awaiting officer verification",
  confirmed: "Confirmed by officer",
  rejected: "Rejected — false positive",
  review: "Needs further review",
};

function ResultsPage() {
  const { id, demo } = Route.useSearch();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<Inspection | undefined>();
  const [loading, setLoading] = useState(true);
  const [focus, setFocus] = useState<EvidenceFocus | undefined>();
  const [openFinding, setOpenFinding] = useState<string | undefined>();
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const cached = loadInspection();
      if (cached && (!id || cached.scanId === id)) {
        if (!cancelled) {
          setInspection(cached);
          setLoading(false);
        }
        if (!id) return;
      }
      if (id) {
        const fresh = await fetchInspection(id);
        if (!cancelled && fresh) {
          setInspection(fresh);
          saveInspection(fresh);
        }
      }
      if (!cancelled) setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24 text-center text-muted-ink">
        Loading inspection report…
      </main>
    );
  }

  if (!inspection) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="font-display text-3xl font-extrabold text-ink">No inspection loaded</h1>
        <p className="mt-3 text-muted-ink">
          Reports are generated from real package images. Start an inspection to produce one.
        </p>
        <Link
          to="/scan"
          className="mt-6 inline-block rounded-full bg-ink px-6 py-3 text-sm font-semibold text-surface"
        >
          Start an inspection
        </Link>
      </main>
    );
  }

  const insufficient =
    inspection.declarations.filter((d) => d.detected).length === 0 ||
    inspection.pages.every((p) => !p.ok || p.text.trim().length < 12);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {demo && (
        <p className="mb-5 rounded-2xl bg-sun/15 px-4 py-3 text-sm font-semibold text-sun">
          DEMO MODE — this record is illustrative and is not an actual inspection.
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-widest text-muted-ink">
            Report {inspection.id} · Ruleset v{inspection.rulesetVersion}
          </p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink">
            {inspection.product}
          </h1>
          <p className="mt-1 text-sm text-muted-ink">
            {inspection.brand ? `${inspection.brand} · ` : ""}
            {inspection.manufacturer || "Manufacturer not detected"} · {inspection.category}
          </p>
          <p className="mt-1 text-xs text-muted-ink">
            Inspected by {inspection.inspector} · {formatDate(inspection.analyzedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScreeningPill status={inspection.screening} />
          <SeverityPill severity={inspection.priority} label={`${inspection.priority} priority`} />
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-full bg-surface px-4 py-2 text-sm font-semibold text-ink ring-1 ring-line"
          >
            Download report
          </button>
          <button
            type="button"
            onClick={() => void navigate({ to: "/scan" })}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-surface"
          >
            Re-inspect
          </button>
        </div>
      </header>

      {insufficient && (
        <p role="alert" className="mt-6 rounded-2xl bg-peach/15 px-5 py-4 text-sm font-medium text-peach">
          Insufficient readable information — the uploaded images did not yield enough legible label
          text for a reliable screening. Re-capture the package in better light, in focus and with the
          declaration panel filling the frame.
        </p>
      )}

      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          { label: "Checks passed", value: inspection.counts.pass, tone: "text-mint" },
          { label: "Manual verification", value: inspection.counts.review, tone: "text-sun" },
          { label: "Potential violations", value: inspection.counts.violation, tone: "text-peach" },
          { label: "Images analysed", value: inspection.pages.length, tone: "text-ink" },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl bg-surface p-4 ring-1 ring-line">
            <p className={`font-display text-3xl font-extrabold ${k.tone}`}>{k.value}</p>
            <p className="mt-1 text-xs text-muted-ink">{k.label}</p>
          </div>
        ))}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        <section className="lg:col-span-5" aria-label="Evidence viewer">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-lg font-bold text-ink">Evidence viewer</h2>
            <p className="mb-4 mt-1 text-xs text-muted-ink">
              Every detected declaration is boxed on the image it was read from.
            </p>
            <EvidenceViewer
              pages={inspection.pages}
              findings={inspection.findings}
              focus={focus}
              onClearFocus={() => setFocus(undefined)}
            />
          </div>

          <DeclarationsCard inspection={inspection} onFocus={setFocus} />
        </section>

        <section className="lg:col-span-7" aria-label="Rule findings">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-bold text-ink">
                Rule engine findings ({inspection.findings.length})
              </h2>
              <span className="font-mono text-[11px] text-muted-ink">
                Legal Metrology (Packaged Commodities) Rules, 2011 · v{inspection.rulesetVersion}
              </span>
            </div>

            <ul className="mt-4 space-y-3">
              {inspection.findings.map((f) => (
                <FindingRow
                  key={f.id}
                  finding={f}
                  open={openFinding === f.id}
                  onToggle={() => setOpenFinding((c) => (c === f.id ? undefined : f.id))}
                  onEvidence={() =>
                    setFocus({
                      label: f.declaration.replace(/_/g, " "),
                      source: f.source,
                      bbox: f.bbox,
                      status: f.status,
                    })
                  }
                />
              ))}
              {inspection.findings.length === 0 && (
                <li className="rounded-2xl bg-soft px-4 py-3 text-sm text-muted-ink">
                  No rule findings were produced for this inspection.
                </li>
              )}
            </ul>
          </div>

          <VerificationCard inspection={inspection} onUpdate={setInspection} />
          <ListingCard inspection={inspection} onUpdate={setInspection} />

          <div className="mt-6 rounded-3xl bg-surface p-5 ring-1 ring-line">
            <button
              type="button"
              onClick={() => setShowText((s) => !s)}
              aria-expanded={showText}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="font-display text-lg font-bold text-ink">
                Extracted text (debug)
              </span>
              <span className="font-mono text-xs text-muted-ink">{showText ? "hide" : "show"}</span>
            </button>
            {showText && (
              <div className="mt-4 space-y-4">
                {inspection.pages.map((p) => (
                  <div key={p.name}>
                    <p className="font-mono text-[11px] uppercase tracking-widest text-muted-ink">
                      {p.side} · {p.name} · {p.language || "unknown language"} ·{" "}
                      {p.ok ? "OCR ok" : `OCR failed: ${p.error ?? "unreadable"}`}
                    </p>
                    <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-2xl bg-soft p-3 font-mono text-[11px] text-ink">
                      {p.text.trim() || "No text extracted from this image."}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      <p className="mt-8 rounded-2xl bg-soft px-5 py-4 text-xs text-muted-ink">
        <strong className="text-ink">Disclaimer:</strong> VigilMetro performs automated screening to
        assist enforcement. Results are indicative, not a legal determination. Final compliance
        decisions rest with an authorised Legal Metrology officer under the Legal Metrology
        (Packaged Commodities) Rules, 2011.
      </p>
    </main>
  );
}

function DeclarationsCard({
  inspection,
  onFocus,
}: {
  inspection: Inspection;
  onFocus: (f: EvidenceFocus) => void;
}) {
  const byKey = useMemo(
    () => new Map(inspection.declarations.map((d) => [d.key, d])),
    [inspection.declarations],
  );

  return (
    <div className="mt-6 rounded-3xl bg-surface p-5 ring-1 ring-line">
      <h2 className="font-display text-lg font-bold text-ink">Extracted declarations</h2>
      <ul className="mt-4 space-y-3">
        {DECLARATION_KEYS.map(({ key, label }) => {
          const d = byKey.get(key);
          const value = d?.detected ? d.value : "Needs manual verification";
          return (
            <li key={key} className="border-b border-line pb-3 last:border-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-ink">
                  {label}
                </span>
                {d?.applicable === false && (
                  <span className="text-[11px] font-semibold text-muted-ink">Not applicable</span>
                )}
              </div>
              <p className={`mt-0.5 text-sm ${d?.detected ? "text-ink" : "text-sun"}`}>{value}</p>
              {d && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <ConfidenceBar value={Math.round(d.ocrConfidence)} label="OCR confidence" />
                  <ConfidenceBar value={Math.round(d.detectionConfidence)} label="Field match" />
                </div>
              )}
              {d?.bbox && (
                <button
                  type="button"
                  onClick={() =>
                    onFocus({ label, source: d.source, bbox: d.bbox, status: "pass" })
                  }
                  className="mt-2 rounded-full bg-soft px-3 py-1 text-[11px] font-semibold text-ink"
                >
                  Show on image ({d.side ?? "package"})
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function FindingRow({
  finding,
  open,
  onToggle,
  onEvidence,
}: {
  finding: RuleFinding;
  open: boolean;
  onToggle: () => void;
  onEvidence: () => void;
}) {
  return (
    <li className="rounded-2xl bg-soft p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-widest text-muted-ink">
            {finding.ruleCode} · {finding.ruleRef}
          </p>
          <p className="mt-0.5 font-semibold text-ink">{finding.requirement}</p>
          <p className="mt-1 text-sm text-muted-ink">
            <span className="font-semibold text-ink">Extracted:</span> {finding.extracted}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <ScreeningPill status={finding.status} short />
          <SeverityPill severity={finding.severity} />
        </div>
      </div>

      <p className="mt-2 text-sm text-ink">{finding.finding}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="rounded-full bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-line"
        >
          Why was this flagged?
        </button>
        {finding.bbox && (
          <button
            type="button"
            onClick={onEvidence}
            className="rounded-full bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink ring-1 ring-line"
          >
            View evidence
          </button>
        )}
      </div>

      {open && (
        <dl className="mt-3 space-y-2 rounded-2xl bg-surface p-4 text-xs">
          <div>
            <dt className="font-semibold text-ink">Rule</dt>
            <dd className="text-muted-ink">
              {finding.ruleRef} — {finding.requirement}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Applies to</dt>
            <dd className="text-muted-ink">{finding.applicability || "All packaged commodities"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Value read from the package</dt>
            <dd className="text-muted-ink">
              {finding.extracted} · OCR confidence {Math.round(finding.ocrConfidence)}% ·{" "}
              {finding.source ? `source: ${finding.source} (${finding.side ?? "side unknown"})` : "no image source"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Screening outcome</dt>
            <dd className="text-muted-ink">{screeningLabel[finding.status]}</dd>
          </div>
          <div>
            <dt className="font-semibold text-ink">Recommended action</dt>
            <dd className="text-muted-ink">{finding.recommendation}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}

function VerificationCard({
  inspection,
  onUpdate,
}: {
  inspection: Inspection;
  onUpdate: (i: Inspection) => void;
}) {
  const [note, setNote] = useState(inspection.officerNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const status = inspection.officerStatus ?? "pending";

  async function apply(next: OfficerStatus) {
    if (!inspection.scanId) return;
    setSaving(true);
    setSaved(false);
    const { error } = await saveVerification(inspection.scanId, next, note);
    setSaving(false);
    if (!error) {
      const updated = { ...inspection, officerStatus: next, officerNote: note };
      onUpdate(updated);
      setSaved(true);
    }
  }

  return (
    <div className="mt-6 rounded-3xl bg-surface p-5 ring-1 ring-line">
      <h2 className="font-display text-lg font-bold text-ink">Officer verification</h2>
      <p className="mt-1 text-xs text-muted-ink">
        Current status: <strong className="text-ink">{officerLabels[status]}</strong>
      </p>

      <label className="mt-4 block text-sm">
        <span className="font-semibold text-ink">Officer note (recorded in the audit trail)</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Observations, measurements taken, action initiated…"
          className="mt-1 w-full rounded-2xl bg-soft px-3 py-2 text-sm text-ink placeholder:text-muted-ink"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        {(["confirmed", "rejected", "review"] as OfficerStatus[]).map((s) => (
          <button
            key={s}
            type="button"
            disabled={saving || !inspection.scanId}
            onClick={() => void apply(s)}
            className={`rounded-full px-4 py-2 text-xs font-semibold disabled:opacity-50 ${
              s === "confirmed"
                ? "bg-mint text-surface"
                : s === "rejected"
                  ? "bg-peach text-surface"
                  : "bg-surface text-ink ring-1 ring-line"
            }`}
          >
            {s === "confirmed"
              ? "Confirm finding"
              : s === "rejected"
                ? "Mark false positive"
                : "Needs further review"}
          </button>
        ))}
      </div>
      {saved && <p className="mt-2 text-xs font-semibold text-mint">Verification recorded.</p>}
    </div>
  );
}

const LISTING_FIELDS = ["net_quantity", "mrp", "manufacturer", "country_of_origin"] as const;

function ListingCard({
  inspection,
  onUpdate,
}: {
  inspection: Inspection;
  onUpdate: (i: Inspection) => void;
}) {
  const run = useServerFn(compareListing);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const comparison: OnlineListingComparison | undefined = inspection.onlineListing;

  async function submit() {
    if (!inspection.scanId) return;
    setBusy(true);
    setError(undefined);
    const listing = LISTING_FIELDS.filter((f) => (values[f] ?? "").trim()).map((f) => ({
      field: f,
      online: values[f] ?? "",
    }));
    if (listing.length === 0) {
      setError("Enter at least one value from the online listing.");
      setBusy(false);
      return;
    }
    const res = await run({ data: { scanId: inspection.scanId, listing } });
    setBusy(false);
    if (!res.ok) setError(res.error);
    else onUpdate({ ...inspection, onlineListing: res.comparison });
  }

  return (
    <div className="mt-6 rounded-3xl bg-surface p-5 ring-1 ring-line">
      <h2 className="font-display text-lg font-bold text-ink">Online listing check</h2>
      <p className="mt-1 text-xs text-muted-ink">
        Enter the values shown on the e-commerce listing to compare them with the physical package.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {LISTING_FIELDS.map((f) => (
          <label key={f} className="block text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-ink">
              {DECLARATION_KEYS.find((d) => d.key === f)?.label ?? f}
            </span>
            <input
              value={values[f] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
              className="mt-1 w-full rounded-xl bg-soft px-3 py-2 text-sm text-ink"
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        disabled={busy || !inspection.scanId}
        onClick={() => void submit()}
        className="mt-3 rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-50"
      >
        {busy ? "Comparing…" : "Compare with package"}
      </button>
      {error && <p className="mt-2 text-xs font-semibold text-peach">{error}</p>}

      {comparison && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted-ink">
              <tr>
                <th className="py-2 pr-3 font-semibold">Field</th>
                <th className="py-2 pr-3 font-semibold">Package</th>
                <th className="py-2 pr-3 font-semibold">Listing</th>
                <th className="py-2 font-semibold">Result</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r) => (
                <tr key={r.field} className="border-t border-line align-top">
                  <td className="py-2 pr-3 font-semibold text-ink">{r.field}</td>
                  <td className="py-2 pr-3 text-muted-ink">{r.physical}</td>
                  <td className="py-2 pr-3 text-muted-ink">{r.online}</td>
                  <td
                    className={`py-2 font-semibold ${
                      r.match === "match" ? "text-mint" : r.match === "mismatch" ? "text-peach" : "text-sun"
                    }`}
                  >
                    {r.match === "match" ? "Match" : r.match === "mismatch" ? "Discrepancy" : "Unknown"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
