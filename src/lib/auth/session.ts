import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is looking at this page.
 *
 * Everything else in `src/lib/db` still reads through the service-role client,
 * which bypasses RLS — that swap is a separate job (see the README's honest
 * accounting). What this gives us today is the *identity*: a verified user and
 * the role their profile row claims, which is enough to gate a route, greet
 * someone by name, and stop showing the operator's board to a traveler.
 */
export type Viewer = {
  id: string;
  email: string | null;
  fullName: string;
  role: "traveler" | "operator" | "coordinator";
  operatorId: string | null;
};

/**
 * `getUser()`, never `getSession()`.
 *
 * `getSession()` reads the cookie and believes it. `getUser()` revalidates the
 * token against Supabase's auth server, so a forged or expired cookie cannot
 * talk its way past a route guard. It costs one network call per request, which
 * `cache()` collapses to one per render no matter how many components ask.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // The profile row is created by the `on_auth_user_created` trigger, so it is
  // normally there by the time anyone asks. It can be missing for exactly one
  // request if a signup and this read race, so fall back to the token's own
  // metadata rather than throwing a new user out of their first page load.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name, operator_id")
    .eq("id", user.id)
    .maybeSingle();

  const metadata = user.user_metadata ?? {};

  return {
    id: user.id,
    email: user.email ?? null,
    fullName:
      profile?.full_name?.trim() ||
      (metadata.full_name as string | undefined) ||
      (metadata.name as string | undefined) ||
      user.email?.split("@")[0] ||
      "Traveler",
    role: (profile?.role as Viewer["role"]) ?? "traveler",
    operatorId: profile?.operator_id ?? null,
  };
});

/** First name only — a nav bar has no room for the rest. */
export function firstName(viewer: Viewer): string {
  return viewer.fullName.split(/\s+/)[0] ?? viewer.fullName;
}
