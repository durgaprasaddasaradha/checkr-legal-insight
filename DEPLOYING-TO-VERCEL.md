# Deploying VigilMetro to Vercel

The app keeps using the **same** Lovable Cloud (Supabase) backend and the same
private `scan-images` bucket. Nothing new is created.

## 1. Build settings

- Framework preset: **Other**
- Build command: `npm run build` (or `bun run build`)
- Output: handled by Nitro's Vercel preset — `vite.config.ts` switches to
  `preset: "vercel"` automatically because Vercel sets `VERCEL=1` during the
  build. You can force it with `NITRO_PRESET=vercel`.

## 2. Environment variables (Vercel → Settings → Environment Variables)

Required:

| Name | Value |
| --- | --- |
| `LOVABLE_API_KEY` | your Lovable AI Gateway key (used for OCR/vision) |

Optional (server code falls back to the committed `VITE_*` values if absent):

| Name | Value |
| --- | --- |
| `SUPABASE_URL` | same as `VITE_SUPABASE_URL` |
| `SUPABASE_PUBLISHABLE_KEY` | same as `VITE_SUPABASE_PUBLISHABLE_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | only if you have one; not required |

Without a service-role key the server still reads the private bucket through
the publishable client and short-lived **signed URLs**, which the bucket
policies allow.

## 3. Verify

Scan page → upload JPG/JPEG/PNG/WEBP → the file lands in `scan-images/<scan
folder>/` and the analysis returns a real report. If OCR fails with "analysis
service is not configured", `LOVABLE_API_KEY` is missing on Vercel.
