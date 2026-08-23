import { createClient } from "@supabase/supabase-js";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for work that legitimately has no user context: the agent routes writing
 * their own run traces, the disruption injector, and seeding. Never import this
 * into anything that ends up in a client bundle.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient() was called in the browser. The service-role key " +
        "bypasses RLS and must never reach client code."
    );
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — copy .env.example to .env.local."
    );
  }

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
