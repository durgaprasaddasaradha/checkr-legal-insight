import type { ComplianceStatus } from "@/lib/compliance-data";
import { statusLabel } from "@/lib/compliance-data";

const styles: Record<ComplianceStatus, string> = {
  compliant: "bg-mint/15 text-mint",
  warning: "bg-sun/15 text-sun",
  "non-compliant": "bg-peach/15 text-peach",
};

const dots: Record<ComplianceStatus, string> = {
  compliant: "bg-mint",
  warning: "bg-sun",
  "non-compliant": "bg-peach",
};

export function StatusPill({ status }: { status: ComplianceStatus }) {
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${styles[status]}`}>
      {statusLabel[status]}
    </span>
  );
}

export function StatusDot({ status }: { status: ComplianceStatus }) {
  return <span className={`size-2 shrink-0 rounded-full ${dots[status]}`} aria-hidden="true" />;
}
