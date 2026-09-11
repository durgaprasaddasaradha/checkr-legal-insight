/**
 * Server-side environment resolution.
 *
 * On Lovable Cloud the runtime injects the non-prefixed variables
 * (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY).
 * On an external host such as Vercel only whatever is configured in that
 * project's settings exists, and the committed VITE_* values are the ones
 * that are always present (they are build-time inlined and are public by
 * design). So every server read falls back:
 *
 *    process.env.X  →  process.env.VITE_X  →  import.meta.env.VITE_X
 *
 * This keeps the exact same Lovable Cloud backend and scan-images bucket
 * working in both places, with no new project, bucket or provider.
 */

function fromImportMeta(name: string): string | undefined {
  try {
    return (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.[name];
  } catch {
    return undefined;
  }
}

function read(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name] ?? fromImportMeta(name);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

export function supabaseUrl(): string {
  const url = read("SUPABASE_URL", "VITE_SUPABASE_URL");
  if (!url) {
    throw new Error(
      "Backend URL is not configured on this deployment. Set SUPABASE_URL (or VITE_SUPABASE_URL) in the hosting environment.",
    );
  }
  return url;
}

export function supabasePublishableKey(): string {
  const key = read("SUPABASE_PUBLISHABLE_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!key) {
    throw new Error(
      "Backend key is not configured on this deployment. Set SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_PUBLISHABLE_KEY) in the hosting environment.",
    );
  }
  return key;
}

/** Optional — absent on Vercel unless the operator adds it. */
export function supabaseServiceRoleKey(): string | undefined {
  return read("SUPABASE_SERVICE_ROLE_KEY");
}

export function lovableApiKey(): string | undefined {
  return read("LOVABLE_API_KEY");
}
