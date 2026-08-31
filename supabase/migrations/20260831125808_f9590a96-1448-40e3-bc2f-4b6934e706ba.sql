CREATE TABLE public.scans (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  report_id text NOT NULL,
  product text NOT NULL DEFAULT 'Unidentified product',
  manufacturer text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'warning',
  score integer NOT NULL DEFAULT 0,
  declarations jsonb NOT NULL DEFAULT '[]'::jsonb,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommendations jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.scans TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scans TO authenticated;
GRANT ALL ON public.scans TO service_role;

ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read scans" ON public.scans FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Anyone can create scans" ON public.scans FOR INSERT TO anon, authenticated WITH CHECK (true);

CREATE INDEX scans_created_at_idx ON public.scans (created_at DESC);