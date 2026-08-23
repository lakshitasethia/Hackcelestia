import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Server-side client that acts *as the signed-in user* — RLS still applies.
 * This is the default for route handlers and server components; reach for the
 * admin client only when you genuinely need to bypass RLS.
 */
export function createClient() {
  const cookieStore = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // Middleware refreshes the session instead, so this is safe to skip.
          }
        },
      },
    }
  );
}
