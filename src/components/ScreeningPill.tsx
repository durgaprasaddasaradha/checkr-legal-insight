import type { QualityVerdict, ScreeningStatus, Severity } from "@/lib/compliance-data";
import { screeningLabel } from "@/lib/compliance-data";

const screeningStyles: Record<ScreeningStatus, string> = {
  pass: "bg-mint/15 text-mint",
  review: "bg-sun/15 text-sun",
  "potential-violation": "bg-peach/15 text-peach",
};

const screeningDots: Record<ScreeningStatus, string> = {
  pass: "bg-mint",
  review: "bg-sun",
  "potential-violation": "bg-peach",
};

export function ScreeningPill({ status, short }: { status: ScreeningStatus; short?: boolean }) {
  const label = short
    ? status === "pass"
      ? "Passed"
      : status === "review"
        ? "Manual review"
        : "Potential issue"
    : screeningLabel[status];
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${screeningStyles[status]}`}
    >
      <span className={`size-2 rounded-full ${screeningDots[status]}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ScreeningDot({ status }: { status: ScreeningStatus }) {
  return <span className={`size-2 shrink-0 rounded-full ${screeningDots[status]}`} aria-hidden="true" />;
}

const qualityStyles: Record<QualityVerdict, string> = {
  good: "bg-mint/15 text-mint",
  warning: "bg-sun/15 text-sun",
  poor: "bg-peach/15 text-peach",
};

const qualityLabel: Record<QualityVerdict, string> = {
  good: "Good — ready for analysis",
  warning: "Warning — may affect accuracy",
  poor: "Poor — capture a clearer image",
};

export function QualityPill({ verdict, short }: { verdict: QualityVerdict; short?: boolean }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${qualityStyles[verdict]}`}>
      {short ? verdict.toUpperCase() : qualityLabel[verdict]}
    </span>
  );
}

const severityStyles: Record<Severity, string> = {
  high: "bg-peach/15 text-peach",
  medium: "bg-sun/15 text-sun",
  low: "bg-sky/15 text-sky",
};

export function SeverityPill({ severity, label }: { severity: Severity; label?: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${severityStyles[severity]}`}>
      {label ?? severity}
    </span>
  );
}

export function ConfidenceBar({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-[11px] text-muted-ink">
        <span>{label}</span>
        <span className="font-mono font-semibold text-ink">{value}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-soft">
        <div
          className={`h-full rounded-full ${value >= 85 ? "bg-mint" : value >= 60 ? "bg-sun" : "bg-peach"}`}
          style={{ width: `${Math.min(100, Math.max(2, value))}%` }}
        />
      </div>
    </div>
  );
}
