/**
 * Server-side retrieval of uploaded package images from the private
 * "scan-images" bucket.
 *
 * Retrieval strategies, tried in order (all authorised, none public):
 *  1. service-role client download (bypasses RLS) — used on Lovable Cloud,
 *  2. server-side publishable client download, allowed by the bucket's read
 *     policy — used where no service-role key exists (e.g. Vercel),
 *  3. signed URL + fetch, for hosts whose runtime struggles with the SDK's
 *     streaming download body.
 *
 * Credentials are resolved through server-env.server.ts, which falls back to
 * the committed VITE_* values so an external deployment (Vercel) uses the
 * same Lovable Cloud backend and the same scan-images bucket.
 *
 * Base64 encoding is done in small chunks WITHOUT argument spreading:
 * String.fromCharCode(...bigArray) overflows the stack in edge runtimes.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { supabasePublishableKey, supabaseServiceRoleKey, supabaseUrl } from "./server-env.server";

export const SCAN_BUCKET = "scan-images";

function publishableServerClient(): SupabaseClient {
  const url = supabaseUrl();
  const key = supabasePublishableKey();
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

async function adminClient(): Promise<SupabaseClient> {
  if (!supabaseServiceRoleKey()) throw new Error("no service-role key on this deployment");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient;
}

async function downloadBytes(path: string): Promise<Uint8Array> {
  const attempts: { label: string; run: () => Promise<Uint8Array> }[] = [
    {
      label: "service-role",
      run: async () => sdkDownload(await adminClient(), path),
    },
    {
      label: "publishable",
      run: async () => sdkDownload(publishableServerClient(), path),
    },
    {
      // Works on any runtime: a short-lived signed URL for the private object,
      // fetched as an ArrayBuffer.
      label: "signed-url",
      run: async () => {
        const client = supabaseServiceRoleKey()
          ? await adminClient()
          : publishableServerClient();
        const { data, error } = await client.storage
          .from(SCAN_BUCKET)
          .createSignedUrl(path, 120);
        if (error || !data?.signedUrl) throw new Error(error?.message ?? "no signed URL returned");
        const response = await fetch(data.signedUrl);
        if (!response.ok) throw new Error(`signed URL responded ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length === 0) throw new Error("the stored file is empty");
        return bytes;
      },
    },
  ];

  const problems: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt.run();
    } catch (error) {
      problems.push(`${attempt.label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(problems.join(" | "));
}

async function sdkDownload(client: SupabaseClient, path: string): Promise<Uint8Array> {
  const { data, error } = await client.storage.from(SCAN_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "empty response");
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.length === 0) throw new Error("the stored file is empty");
  return bytes;
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
    const client = await adminClient();
    // Touch a property so a missing service-role key fails here, not later.
    void client.storage;
    return client;
  } catch (error) {
    console.warn("[serverDb] falling back to publishable client:", error);
    return publishableServerClient();
  }
}
