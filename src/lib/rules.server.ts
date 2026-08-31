// Rule repository access (server-only).
//
// The Legal Metrology rule catalogue lives in the `rules` table so it can be
// updated from the Rule Management page WITHOUT touching the OCR/AI pipeline.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type RuleRow = {
  rule_code: string;
  declaration_type: string;
  requirement: string;
  applicability: string[];
  validation_method: string;
  severity: string;
  effective_date: string;
  source_ref: string;
  version: string;
  active: boolean;
};

export async function loadActiveRules(): Promise<{ rules: RuleRow[]; version: string }> {
  const { data, error } = await supabaseAdmin
    .from("rules")
    .select(
      "rule_code, declaration_type, requirement, applicability, validation_method, severity, effective_date, source_ref, version, active",
    )
    .eq("active", true)
    .order("rule_code");

  if (error || !data || data.length === 0) {
    throw new Error(error?.message ?? "The rule repository is empty.");
  }

  const rules = data as RuleRow[];
  const version = rules.map((r) => r.version).sort().at(-1) ?? "2026.1";
  return { rules, version };
}

export function ruleApplies(rule: RuleRow, categoryKey: string): boolean {
  const scope = rule.applicability ?? [];
  return scope.includes("all") || scope.includes(categoryKey);
}
