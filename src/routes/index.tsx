import { createFileRoute, Link } from "@tanstack/react-router";
import labelSalt from "@/assets/label-salt.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VigilMetro — Automated Packaged Commodity Compliance Checker" },
      {
        name: "description",
        content:
          "Scan packaged product labels and verify every declaration against the Legal Metrology (Packaged Commodities) Rules, 2011.",
      },
      { property: "og:title", content: "VigilMetro — Packaged Commodity Compliance Checker" },
      {
        property: "og:description",
        content:
          "AI label scanning and OCR that checks packaged commodity declarations against the 2011 rules and generates a detailed report.",
      },
    ],
  }),
  component: Home,
});

const steps = [
  { key: "(a)", title: "Upload or scan", body: "Drop multiple label photos or capture in camera." },
  { key: "(b)", title: "Extract text", body: "OCR reads every printed declaration on the label." },
  { key: "(c)", title: "Verify rules", body: "Cross-check against the 2011 packaged-commodities rules." },
  { key: "(d)", title: "Get a report", body: "Download a detailed, per-rule compliance report." },
];

function Home() {
  return (
    <main className="mx-auto max-w-6xl px-6">
      <section className="grid items-center gap-10 py-14 md:grid-cols-12">
        <div className="md:col-span-6">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1 text-xs font-semibold text-plum ring-1 ring-line">
            Legal Metrology Rules, 2011
          </span>
          <h1 className="mt-5 max-w-[16ch] text-balance font-display text-5xl font-extrabold leading-[1.02] text-ink">
            Automated Packaged Commodity Compliance Checker
          </h1>
          <p className="mt-5 max-w-[52ch] text-pretty text-lg text-muted-ink">
            Scan a product label and instantly verify every declaration against the Legal Metrology
            (Packaged Commodities) Rules — with a shareable, defensible report.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              to="/scan"
              className="rounded-full bg-plum px-6 py-3 text-sm font-semibold text-surface"
            >
              Scan a product
            </Link>
            <Link
              to="/results"
              className="rounded-full bg-surface px-6 py-3 text-sm font-semibold text-ink ring-1 ring-line"
            >
              View sample report
            </Link>
          </div>
        </div>

        <div className="md:col-span-6">
          <div className="overflow-hidden rounded-3xl bg-surface p-4 ring-1 ring-line">
            <div className="flex items-center justify-between px-2 pb-3">
              <span className="text-sm font-medium text-ink">Nutri Gold Refined Salt</span>
              <span className="rounded-full bg-mint/15 px-3 py-1 text-xs font-bold text-mint">
                92% Compliant
              </span>
            </div>
            <img
              src={labelSalt}
              alt="Packaged refined salt box label photographed from above"
              width={1024}
              height={640}
              className="aspect-[16/10] w-full rounded-2xl object-cover"
            />
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-xl bg-mint/10 px-3 py-2 text-sm">
                <span className="font-medium text-ink">Net quantity &amp; batch code</span>
                <span className="font-bold text-mint">Compliant</span>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-sun/15 px-3 py-2 text-sm">
                <span className="font-medium text-ink">Declared mfg date format</span>
                <span className="font-bold text-sun">Warning</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-10">
        <div className="mb-6 flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">How it works</h2>
          <span className="font-mono text-xs text-muted-ink">(a)–(d)</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s) => (
            <div key={s.key} className="rounded-2xl bg-surface p-5 ring-1 ring-line">
              <div className="font-mono text-xs font-medium text-plum">{s.key}</div>
              <div className="mt-3 font-display text-base font-bold text-ink">{s.title}</div>
              <p className="mt-1 text-pretty text-sm text-muted-ink">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pb-16">
        <div className="rounded-3xl bg-plum/10 p-6 sm:p-8">
          <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
            Built for inspectors, manufacturers and retailers
          </h2>
          <p className="mt-2 max-w-[60ch] text-pretty text-sm text-muted-ink">
            Every scan is stored with its evidence image, extracted declarations and rule-by-rule
            verdict, so authorities can audit outcomes and businesses can fix labels before print.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/history" className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-surface">
              Browse scan history
            </Link>
            <Link
              to="/authority"
              className="rounded-full bg-surface px-5 py-2.5 text-sm font-semibold text-ink ring-1 ring-line"
            >
              Authority analytics
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
