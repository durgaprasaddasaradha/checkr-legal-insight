import { createFileRoute } from "@tanstack/react-router";
import { authorityStats, historyItems } from "@/lib/compliance-data";
import { StatusPill } from "@/components/StatusPill";

export const Route = createFileRoute("/authority")({
  head: () => ({
    meta: [
      { title: "Authority analytics — VigilMetro" },
      {
        name: "description",
        content:
          "Statistics for Legal Metrology authorities: products analysed, compliance rate, and the most common label violations.",
      },
      { property: "og:title", content: "Authority analytics — VigilMetro" },
      {
        property: "og:description",
        content: "Compliance trends and top violations across analysed packaged commodities.",
      },
    ],
  }),
  component: AuthorityPage,
});

function AuthorityPage() {
  const s = authorityStats;
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-5 flex items-baseline justify-between">
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">
          Authority analytics
        </h1>
        <span className="font-mono text-xs text-muted-ink">Last 90 days</span>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="text-xs font-medium text-muted-ink">Products analyzed</div>
          <div className="mt-1 font-display text-3xl font-extrabold tracking-tight text-ink">
            {s.analyzed.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="text-xs font-medium text-muted-ink">Compliant</div>
          <div className="mt-1 font-display text-3xl font-extrabold tracking-tight text-mint">
            {s.compliant.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="text-xs font-medium text-muted-ink">Non-compliant</div>
          <div className="mt-1 font-display text-3xl font-extrabold tracking-tight text-peach">
            {s.nonCompliant.toLocaleString("en-IN")}
          </div>
        </div>
        <div className="rounded-2xl bg-surface p-5 ring-1 ring-line">
          <div className="text-xs font-medium text-muted-ink">Top violation</div>
          <div className="mt-1 font-display text-lg font-bold leading-tight text-ink">
            {s.topViolation}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="rounded-3xl bg-surface p-5 ring-1 ring-line lg:col-span-3">
          <div className="mb-4 text-sm font-semibold text-ink">Compliance trend</div>
          <div className="flex h-32 items-end gap-2" aria-hidden="true">
            {s.trend.map((h, i) => (
              <div
                key={i}
                className={`flex-1 rounded-t-lg ${i === s.trend.length - 1 ? "bg-sky/70" : "bg-mint/80"}`}
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
        </div>
        <div className="rounded-3xl bg-surface p-5 ring-1 ring-line lg:col-span-2">
          <div className="mb-4 text-sm font-semibold text-ink">Most common violations</div>
          <div className="space-y-3 text-sm">
            {s.violations.map((v) => (
              <div key={v.label}>
                <div className="flex justify-between">
                  <span className="text-ink">{v.label}</span>
                  <span className="font-mono text-xs text-muted-ink">{v.count}</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-soft">
                  <div className={`h-full rounded-full ${v.color}`} style={{ width: v.width }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl bg-surface p-5 ring-1 ring-line">
        <div className="mb-4 text-sm font-semibold text-ink">Recent enforcement queue</div>
        <div className="divide-y divide-line">
          {historyItems.slice(0, 5).map((i) => (
            <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <div>
                <div className="font-semibold text-ink">{i.product}</div>
                <div className="font-mono text-xs text-muted-ink">
                  {i.id} · {i.date}
                </div>
              </div>
              <StatusPill status={i.status} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
