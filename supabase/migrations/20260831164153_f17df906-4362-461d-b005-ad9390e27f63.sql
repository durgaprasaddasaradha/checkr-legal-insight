ALTER TABLE public.scans
  ADD COLUMN IF NOT EXISTS brand text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS inspector text NOT NULL DEFAULT 'Unassigned officer',
  ADD COLUMN IF NOT EXISTS ruleset_version text NOT NULL DEFAULT '2026.1',
  ADD COLUMN IF NOT EXISTS screening text NOT NULL DEFAULT 'review',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS quality jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS online_listing jsonb,
  ADD COLUMN IF NOT EXISTS officer_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS officer_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS product_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS parent_scan_id uuid REFERENCES public.scans(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'real';

CREATE INDEX IF NOT EXISTS scans_product_key_idx ON public.scans (product_key);
CREATE INDEX IF NOT EXISTS scans_created_at_idx ON public.scans (created_at DESC);

DROP POLICY IF EXISTS "Anyone can update scans" ON public.scans;
CREATE POLICY "Anyone can update scans"
  ON public.scans FOR UPDATE
  TO anon, authenticated
  USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code text NOT NULL UNIQUE,
  declaration_type text NOT NULL,
  requirement text NOT NULL,
  applicability text[] NOT NULL DEFAULT ARRAY['all']::text[],
  validation_method text NOT NULL DEFAULT 'ocr-text-match',
  severity text NOT NULL DEFAULT 'medium',
  effective_date date NOT NULL DEFAULT '2011-04-01',
  source_ref text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '2026.1',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.rules TO anon, authenticated;
GRANT ALL ON public.rules TO service_role;

ALTER TABLE public.rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read rules" ON public.rules FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can add rules" ON public.rules FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Anyone can edit rules" ON public.rules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS rules_set_updated_at ON public.rules;
CREATE TRIGGER rules_set_updated_at BEFORE UPDATE ON public.rules
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.rules (rule_code, declaration_type, requirement, applicability, validation_method, severity, effective_date, source_ref, version)
VALUES
 ('LM-001','manufacturer','Name and complete address of the manufacturer, packer or importer must be declared on the package.',ARRAY['all'],'ocr-text-match','high','2011-04-01','LMPC Rules 2011, Rule 6(1)(a)','2026.1'),
 ('LM-002','generic_name','The common or generic name of the commodity contained in the package must be declared.',ARRAY['all'],'ocr-text-match','high','2011-04-01','LMPC Rules 2011, Rule 6(1)(b)','2026.1'),
 ('LM-003','net_quantity','Net quantity must be declared in standard units of weight, measure or number.',ARRAY['all'],'unit-format-check','high','2011-04-01','LMPC Rules 2011, Rule 6(1)(c) & Rule 8','2026.1'),
 ('LM-004','date_declaration','Month and year of manufacture, packing or import must be declared.',ARRAY['all'],'date-format-check','high','2011-04-01','LMPC Rules 2011, Rule 6(1)(d)','2026.1'),
 ('LM-005','mrp','Retail sale price must be declared as "MRP Rs. ___ inclusive of all taxes".',ARRAY['all'],'price-format-check','high','2011-04-01','LMPC Rules 2011, Rule 6(1)(e) & Rule 18','2026.1'),
 ('LM-006','consumer_care','Consumer care details — name, address, telephone number and email of the person who can be contacted for complaints.',ARRAY['all'],'contact-presence-check','high','2017-01-01','LMPC Rules 2011, Rule 6(1)(f) as amended 2017','2026.1'),
 ('LM-007','country_of_origin','Country of origin must be declared on imported packages and on packages sold through e-commerce.',ARRAY['imported','ecommerce'],'ocr-text-match','high','2020-08-01','LMPC Rules 2011, Rule 6(1)(a) proviso','2026.1'),
 ('LM-008','best_before','Best before or use by date must be declared for food and other perishable commodities.',ARRAY['food','personal-care'],'date-format-check','medium','2011-04-01','LMPC Rules 2011, Rule 6(1) read with FSS Labelling Regulations','2026.1'),
 ('LM-009','unit_sale_price','Unit sale price must be declared where the package is sold by weight or measure above the prescribed threshold.',ARRAY['food','household'],'price-format-check','medium','2022-04-01','LMPC Rules 2011, Rule 6(1) as amended 2021','2026.1'),
 ('LM-010','batch_number','Batch, lot or code number must be declared where applicable.',ARRAY['food','personal-care','household'],'ocr-text-match','medium','2011-04-01','LMPC Rules 2011, Rule 6(1)','2026.1'),
 ('LM-011','display_panel','Mandatory declarations must be grouped together, legible, conspicuous and on the principal display panel.',ARRAY['all'],'manual-verification','medium','2011-04-01','LMPC Rules 2011, Rule 7 & Rule 9','2026.1'),
 ('LM-012','font_size','Declarations must meet the minimum height requirements prescribed for the size of the package.',ARRAY['all'],'manual-verification','low','2011-04-01','LMPC Rules 2011, Rule 9(2)','2026.1')
ON CONFLICT (rule_code) DO NOTHING;