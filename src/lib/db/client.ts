import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The client every read in `queries.ts` goes through.
 *
 * Inside a request — a server component, a route handler, a server action —
 * this is the cookie-scoped client, so RLS decides what comes back. That is
 * the whole point: a traveler's `getTrip` returns their trip or nothing,
 * because `trips_read` says `traveler_id = auth.uid()`, not because some
 * `.eq()` upstream remembered to filter.
 *
 * Outside a request there is no cookie and no `auth.uid()`, so the same code
 * would return empty lists rather than an error — the failure mode that makes
 * RLS bugs expensive to find. The test scripts genuinely need to read as
 * nobody, so they opt in explicitly with WAYPOINT_SERVICE_ROLE=1. Anything else
 * calling from outside a request gets a thrown error naming the problem
 * instead of silence.
 */
export async function readClient() {
  /**
   * Checked before the import below, not after, and that ordering is load
   * bearing. `@/lib/supabase/server` pulls in `next/headers`, which pulls in
   * React's server entry — and that throws outright under plain Node, which is
   * where the test scripts live. Short-circuiting here means a script that has
   * opted into the service role never loads the module that cannot load.
   */
  if (process.env.WAYPOINT_SERVICE_ROLE === "1") return createAdminClient();

  /**
   * The stage escape hatch, and it has to be honoured *here* as well as in the
   * middleware or it does nothing useful. Turning off the route guard alone
   * would let an anonymous visitor reach `/ops` and find it empty, because RLS
   * would answer every read with no rows. One flag, one meaning: AUTH_ENFORCED
   * false is "no auth at all", boundary included.
   *
   * Which is worth saying plainly: this switches off the data boundary, not
   * just the sign-in wall. It exists so that a broken login fifteen minutes
   * before a demo costs a talking point rather than the whole run. It is not
   * something to leave set.
   */
  if (process.env.AUTH_ENFORCED === "false") return createAdminClient();

  const { createClient: createRlsClient } = await import("@/lib/supabase/server");

  try {
    return createRlsClient();
  } catch (err) {
    /**
     * Next signals "this render must become dynamic" by throwing from
     * `cookies()`. Swallowing that would turn a page that should re-render per
     * request into one frozen at build time, quietly serving one user's data
     * to the next. Only a genuine absence of request context falls through.
     */
    if (
      typeof err === "object" &&
      err !== null &&
      "digest" in err &&
      typeof (err as { digest?: unknown }).digest === "string" &&
      (err as { digest: string }).digest.startsWith("DYNAMIC_SERVER_USAGE")
    ) {
      throw err;
    }

    throw new Error(
      "readClient() was called outside a request, where there is no session " +
        "for RLS to key off. A script that means to read as the service role " +
        "must set WAYPOINT_SERVICE_ROLE=1."
    );
  }
}

/**
 * The deliberate bypass, named so it shows up in a grep.
 *
 * Three things legitimately need it. The disruption injector writes an event
 * nobody is signed in for. `applyProposal` moves `availability` seats and
 * cancels vendor bookings — catalogue rows no user-facing policy grants a
 * write on, and correctly so. And the realtime sender talks to Supabase's
 * broadcast endpoint on the server's own authority.
 *
 * Every use is a place where the caller has already decided the request is
 * allowed. If you reach for this to make a read work, the read is the thing
 * that is wrong.
 */
export { createAdminClient as serviceRoleClient };
