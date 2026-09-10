/**
 * Server-side retrieval of uploaded package images from the private
 * "scan-images" bucket.
 *
 * Two authorised paths, in order:
 *  1. the service-role client (bypasses RLS),
 *  2. a server-side publishable client, which is allowed by the bucket's
 *     read policy — used when the service-role key is unavailable at runtime.
 *
 * Base64 encoding is done in small chunks WITHOUT argument spreading:
 * String.fromCharCode(...bigArray) overflows the stack in the edge runtime,
 * which previously surfaced as "the file could not be read from storage".
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const SCAN_BUCKET = "scan-images";

function publishableServerClient(): SupabaseClient {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!url || !key) throw new Error("Storage credentials are not configured on the server.");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (headers.get("Authorization") === `Bearer ${key}`) headers.delete("Authorization");
        headers.set("apikey", key);
        return fetch(input as RequestInfo, { ...init, headers });
      },
    },
  });
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 4096;
  for (let i = 0; i < bytes.length; i += chunk) {
    const end = Math.min(i + chunk, bytes.length);
    for (let j = i; j < end; j++) binary += String.fromCharCode(bytes[j]!);
  }
  return btoa(binary);
}

async function downloadBytes(path: string): Promise<Uint8Array> {
  const attempts: { label: string; client: () => Promise<SupabaseClient> }[] = [
    {
      label: "service-role",
      client: async () =>
        (await import("@/integrations/supabase/client.server"))
          .supabaseAdmin as unknown as SupabaseClient,
    },
    { label: "publishable", client: async () => publishableServerClient() },
  ];

  const problems: string[] = [];
  for (const attempt of attempts) {
    try {
      const client = await attempt.client();
      const { data, error } = await client.storage.from(SCAN_BUCKET).download(path);
      if (error || !data) throw new Error(error?.message ?? "empty response");
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.length === 0) throw new Error("the stored file is empty");
      return bytes;
    } catch (error) {
      problems.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(problems.join(" | "));
}

/** Download an uploaded scan file and return it as a data URL for the vision model. */
export async function downloadScanFileAsDataUrl(path: string, mime: string): Promise<string> {
  const bytes = await downloadBytes(path);
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/**
 * Database client for server-side inspection writes: service-role when
 * available, otherwise the publishable client (the scans table policies allow
 * anonymous insert/select/update for this no-login enforcement workflow).
 */
export async function serverDb(): Promise<SupabaseClient> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Touch a property so a missing service-role key fails here, not later.
    void supabaseAdmin.storage;
    return supabaseAdmin as unknown as SupabaseClient;
  } catch (error) {
    console.warn("[serverDb] falling back to publishable client:", error);
    return publishableServerClient();
  }
}
