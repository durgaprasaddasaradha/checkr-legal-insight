export type ComplianceStatus = "compliant" | "warning" | "non-compliant";

export type RuleCheck = {
  id: string;
  rule: string;
  title: string;
  status: ComplianceStatus;
  detail: string;
};

export type Declaration = {
  label: string;
  value: string;
  found: boolean;
};

export type AnalysisResult = {
  id: string;
  product: string;
  manufacturer: string;
  category: string;
  analyzedAt: string;
  score: number;
  status: ComplianceStatus;
  declarations: Declaration[];
  checks: RuleCheck[];
};

export const statusLabel: Record<ComplianceStatus, string> = {
  compliant: "Compliant",
  warning: "Warning",
  "non-compliant": "Non-compliant",
};

export const sampleResult: AnalysisResult = {
  id: "LMR-2024-08841",
  product: "Nutri Gold Refined Salt, 1 kg",
  manufacturer: "Nutri Gold Foods Pvt. Ltd., Rajkot, Gujarat",
  category: "Food & Groceries",
  analyzedAt: "14 Nov 2024, 10:42 IST",
  score: 92,
  status: "warning",
  declarations: [
    { label: "Name of commodity", value: "Refined Iodised Salt", found: true },
    { label: "Net quantity", value: "1 kg", found: true },
    { label: "M.R.P. (incl. all taxes)", value: "₹ 28.00", found: true },
    { label: "Date of manufacture", value: "08/2024", found: true },
    { label: "Batch / lot number", value: "NG-2411-C", found: true },
    { label: "Manufacturer address", value: "Rajkot, Gujarat (line truncated)", found: true },
    { label: "Consumer care", value: "care@nutrigold.in · 1800-200-100", found: true },
    { label: "Country of origin", value: "India", found: true },
  ],
  checks: [
    {
      id: "c1",
      rule: "Rule 5",
      title: "Net quantity declaration",
      status: "compliant",
      detail: "1 kg declared in a permitted unit, on the principal display panel.",
    },
    {
      id: "c2",
      rule: "Rule 6",
      title: "Date of manufacture",
      status: "warning",
      detail:
        "Only month and year detected (08/2024). Confirm whether the commodity requires a full DD/MM/YYYY date.",
    },
    {
      id: "c3",
      rule: "Rule 9",
      title: "Manufacturer name & complete address",
      status: "non-compliant",
      detail:
        "Address line is truncated on the label. Rule 9 requires the complete registered address including PIN code.",
    },
    {
      id: "c4",
      rule: "Rule 10",
      title: "Consumer care contact",
      status: "compliant",
      detail: "Email and toll-free number present and legible.",
    },
    {
      id: "c5",
      rule: "Rule 6(1)(e)",
      title: "Retail sale price, inclusive of all taxes",
      status: "compliant",
      detail: "M.R.P. printed as ₹28.00 with the required inclusive-of-taxes wording.",
    },
    {
      id: "c6",
      rule: "Rule 7",
      title: "Declaration size & legibility",
      status: "warning",
      detail:
        "Character height near the minimum permitted size for a 1 kg pack. Manual measurement recommended.",
    },
  ],
};

export type HistoryItem = {
  id: string;
  product: string;
  category: string;
  date: string;
  score: number;
  status: ComplianceStatus;
};

export const historyItems: HistoryItem[] = [
  { id: "LMR-2024-08841", product: "Nutri Gold Refined Salt, 1 kg", category: "Food & Groceries", date: "14 Nov 2024", score: 92, status: "warning" },
  { id: "LMR-2024-08840", product: "DoodhNirman Full-Cream Milk, 1 L", category: "Dairy", date: "14 Nov 2024", score: 74, status: "non-compliant" },
  { id: "LMR-2024-08836", product: "Suraj Mustard Oil, 5 L", category: "Edible Oils", date: "13 Nov 2024", score: 100, status: "compliant" },
  { id: "LMR-2024-08829", product: "Amrit Basmati Rice, 5 kg", category: "Food & Groceries", date: "12 Nov 2024", score: 96, status: "compliant" },
  { id: "LMR-2024-08814", product: "GlowUp Face Wash, 150 ml", category: "Cosmetics", date: "11 Nov 2024", score: 68, status: "non-compliant" },
  { id: "LMR-2024-08802", product: "Bharat Detergent Powder, 2 kg", category: "Household", date: "09 Nov 2024", score: 88, status: "warning" },
];

export const authorityStats = {
  analyzed: 12480,
  compliant: 8140,
  nonCompliant: 1960,
  topViolation: "Mfg date format",
  trend: [60, 72, 85, 68, 90, 96, 78],
  violations: [
    { label: "Mfg date format", count: 412, width: "80%", color: "bg-peach" },
    { label: "Retail price missing", count: 288, width: "60%", color: "bg-sun" },
    { label: "Batch code absent", count: 176, width: "40%", color: "bg-sky" },
  ],
};
