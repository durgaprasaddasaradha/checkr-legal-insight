import { Link } from "@tanstack/react-router";

const nav = [
  { to: "/", label: "Overview" },
  { to: "/scan", label: "Scan" },
  { to: "/results", label: "Results" },
  { to: "/history", label: "History" },
  { to: "/authority", label: "Authority" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-3">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-2xl bg-plum font-display text-lg font-extrabold text-surface">
            V
          </div>
          <div className="leading-tight">
            <div className="font-display text-sm font-bold tracking-tight text-ink">VigilMetro</div>
            <div className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-ink">
              Compliance Suite
            </div>
          </div>
        </Link>

        <nav className="hidden items-center gap-1 rounded-full bg-soft p-1 text-sm font-medium md:flex">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="rounded-full px-4 py-1.5 text-muted-ink transition-colors hover:text-ink"
              activeProps={{ className: "rounded-full bg-surface px-4 py-1.5 text-ink" }}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          to="/scan"
          className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-surface"
        >
          Scan product
        </Link>
      </div>

      <nav className="flex gap-1 overflow-x-auto border-t border-line px-4 py-2 text-sm font-medium md:hidden">
        {nav.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === "/" }}
            className="whitespace-nowrap rounded-full px-3 py-1.5 text-muted-ink"
            activeProps={{ className: "whitespace-nowrap rounded-full bg-soft px-3 py-1.5 text-ink" }}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line py-8">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-2 px-6 text-xs text-muted-ink sm:flex-row sm:items-center">
        <span className="font-medium">VigilMetro · Prototype for Smart India Hackathon</span>
        <span className="font-mono">Legal Metrology (Packaged Commodities) Rules, 2011</span>
      </div>
    </footer>
  );
}
