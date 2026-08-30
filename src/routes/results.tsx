import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import labelSnack from "@/assets/label-snack.jpg";
import { loadAnalysis } from "@/lib/analysis-store";
import { sampleResult, type AnalysisResult } from "@/lib/compliance-data";
import { StatusDot, StatusPill } from "@/components/StatusPill";

export const Route = createFileRoute("/results")({
  head: () => ({
    meta: [
      { title: "Compliance report — VigilMetro" },
      {
        name: "description",
        content:
          "Rule-by-rule Legal Metrology compliance verdict with extracted label declarations and an overall compliance score.",
      },
      { property: "og:title", content: "Compliance report — VigilMetro" },
      {
        property: "og:description",
        content: "Extracted declarations, per-rule verdicts and a downloadable compliance report.",
      },
    ],
  }),
  component: ResultsPage,
});

function ResultsPage() {
  const [state, setState] = useState<{ result: AnalysisResult; image: string; live: boolean }>();

  useEffect(() => {
    const stored = loadAnalysis();
    setState(
      stored
        ? { result: stored.result, image: stored.imageDataUrl, live: true }
        : { result: sampleResult, image: labelSnack, live: false },
    );
  }, []);

  if (!state) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-20 text-center text-muted-ink">
        Loading report…
      </main>
    );
  }

  const r = state.result;
  const counts = {
    compliant: r.checks.filter((c) => c.status === "compliant").length,
    warning: r.checks.filter((c) => c.status === "warning").length,
    fail: r.checks.filter((c) => c.status === "non-compliant").length,
  };

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      {!state.live && (
        <p className="mb-6 rounded-2xl bg-sun/15 px-4 py-3 text-sm font-medium text-ink">
          This is a sample report. <Link to="/scan" className="underline">Scan a product</Link> to
          generate a real analysis from your own label image.
        </p>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-muted-ink">Report #{r.id} · {r.analyzedAt}</p>
          <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight text-ink">
            {r.product}
          </h1>
          <p className="mt-1 text-sm text-muted-ink">
            {r.manufacturer} · {r.category}
          </p>
        </div>
        <StatusPill status={r.status} />
      </div>

      <section className="grid gap-6 py-8 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <img
              src={state.image}
              alt="Scanned packaged product label"
              loading="lazy"
              className="aspect-[4/5] w-full rounded-2xl object-cover"
            />
            <div className="mt-4 rounded-2xl bg-plum/10 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Overall score</span>
                <span className="font-mono text-xs text-plum">LMR/2011</span>
              </div>
              <div className="mt-1 font-display text-4xl font-extrabold tracking-tight text-ink">
                {r.score}
                <span className="text-xl text-muted-ink">/100</span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-soft">
                <div className="h-full rounded-full bg-mint" style={{ width: `${r.score}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-mint/15 py-2 font-bold text-mint">{counts.compliant} pass</div>
                <div className="rounded-xl bg-sun/15 py-2 font-bold text-sun">{counts.warning} warn</div>
                <div className="rounded-xl bg-peach/15 py-2 font-bold text-peach">{counts.fail} fail</div>
              </div>
              <button
                type="button"
                onClick={() => window.print()}
                className="mt-4 block w-full rounded-full bg-ink px-4 py-2 text-center text-sm font-semibold text-surface"
              >
                Download report
              </button>
              <Link
                to="/scan"
                className="mt-2 block w-full rounded-full bg-surface px-4 py-2 text-center text-sm font-semibold text-ink ring-1 ring-line"
              >
                Scan another product
              </Link>
            </div>
          </div>
        </div>

        <div className="space-y-6 lg:col-span-8">
          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <h2 className="font-display text-lg font-bold text-ink">Extracted declarations</h2>
            <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
              {r.declarations.map((d) => (
                <div key={d.label} className="flex justify-between gap-4 border-b border-line py-2 text-sm">
                  <dt className="text-muted-ink">{d.label}</dt>
                  <dd className={`text-right font-medium ${d.found ? "text-ink" : "text-peach"}`}>
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-3xl bg-surface p-5 ring-1 ring-line">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold text-ink">Per-rule verdicts</h2>
              <span className="text-xs font-medium text-muted-ink">LMPC Rules · 2011</span>
            </div>
            <div className="divide-y divide-line">
              {r.checks.map((c) => (
                <div key={c.id} className="flex items-start gap-3 py-3">
                  <span className="mt-1.5">
                    <StatusDot status={c.status} />
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-semibold text-ink">
                      {c.title} <span className="font-mono text-xs text-muted-ink">({c.rule})</span>
                    </div>
                    <div className="text-pretty text-xs text-muted-ink">{c.detail}</div>
                  </div>
                  <StatusPill status={c.status} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
