import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import labelSalt from "@/assets/label-salt.jpg";
import { historyItems, type ComplianceStatus } from "@/lib/compliance-data";
import { StatusPill } from "@/components/StatusPill";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "Scan history — VigilMetro" },
      {
        name: "description",
        content: "Search and filter previously analysed packaged commodities and their compliance outcomes.",
      },
      { property: "og:title", content: "Scan history — VigilMetro" },
      {
        property: "og:description",
        content: "Every analysed product with its date, score and compliance status.",
      },
    ],
  }),
  component: HistoryPage,
});

const filters: Array<{ value: ComplianceStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "compliant", label: "Compliant" },
  { value: "warning", label: "Warning" },
  { value: "non-compliant", label: "Non-compliant" },
];

function HistoryPage() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ComplianceStatus | "all">("all");

  const rows = useMemo(
    () =>
      historyItems.filter(
        (i) =>
          (filter === "all" || i.status === filter) &&
          (i.product + i.category + i.id).toLowerCase().includes(query.toLowerCase()),
      ),
    [query, filter],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Scan history</h1>
      <p className="mt-2 text-muted-ink">Previously analysed products and their compliance outcome.</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search product, category or report ID"
          aria-label="Search scan history"
          className="w-full max-w-sm rounded-full bg-surface px-4 py-2.5 text-sm text-ink ring-1 ring-line outline-none focus:ring-2 focus:ring-plum"
        />
        <div className="flex flex-wrap gap-1 rounded-full bg-soft p-1 text-sm font-medium">
          {filters.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-4 py-1.5 ${
                filter === f.value ? "bg-surface text-ink" : "text-muted-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((item) => (
          <Link
            key={item.id}
            to="/results"
            className="overflow-hidden rounded-3xl bg-surface ring-1 ring-line transition-shadow hover:ring-plum"
          >
            <img
              src={labelSalt}
              alt={`Label thumbnail for ${item.product}`}
              width={1024}
              height={640}
              loading="lazy"
              className="aspect-[16/10] w-full object-cover"
            />
            <div className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-ink">{item.product}</div>
                  <div className="mt-0.5 text-xs text-muted-ink">
                    {item.category} · {item.date}
                  </div>
                </div>
                <StatusPill status={item.status} />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="font-mono text-xs text-muted-ink">{item.id}</span>
                <span className="font-display text-sm font-bold text-ink">{item.score}/100</span>
              </div>
            </div>
          </Link>
        ))}
        {rows.length === 0 && (
          <p className="text-sm text-muted-ink">No scans match your search.</p>
        )}
      </div>
    </main>
  );
}
