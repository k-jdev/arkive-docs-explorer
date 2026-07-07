// Server-side Supabase client for API routes + Server Components.
// Reads/writes the session cookie via Next.js's cookies() API.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Build a request-scoped Supabase client that can read + refresh the session. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(toSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // The `setAll` is allowed to fail in Server Components — the middleware refresh
            // handles persistence in those cases.
          }
        },
      },
    }
  );
}

/** Server-admin client using the service-role key. Bypasses RLS. Never expose to the browser. */
import { createClient } from "@supabase/supabase-js";

let _admin: ReturnType<typeof createClient> | null = null;
export function supabaseAdmin() {
  if (_admin) return _admin;
  _admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}
