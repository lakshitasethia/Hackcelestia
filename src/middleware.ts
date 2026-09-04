import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Two jobs, in this order.
 *
 * 1. Refresh the auth cookie. Supabase access tokens are short-lived; a server
 *    component cannot write cookies, so if nothing refreshed them here a user
 *    would be silently signed out mid-session. This is why the middleware has
 *    to run on every matched request and not only on the guarded ones.
 * 2. Guard the product surfaces. The marketing site stays open to everyone —
 *    a judge or a crawler should reach the pitch without an account.
 */

/** The product. Everything else — the landing page, /login, legal pages — is
 *  public on purpose. Prefix match, so `/trip/abc/build` is covered by `/trip`. */
const PROTECTED = ["/app", "/ops", "/field", "/trip", "/plan"];

/**
 * The stage escape hatch. Set `AUTH_ENFORCED=false` and the guard below turns
 * itself off while the cookie refresh keeps working, so a sign-in that breaks
 * fifteen minutes before a demo costs you the greeting in the nav and nothing
 * else. Absent or anything other than "false", the guard is on.
 */
const enforced = process.env.AUTH_ENFORCED !== "false";

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Both halves matter: the request copy so anything later in this pass
          // sees the refreshed token, and the response copy so the browser
          // actually keeps it.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Do not remove: this is the call that performs the refresh. It also verifies
  // the token against the auth server, so the decision below is not made on the
  // strength of a cookie anybody could have written.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const guarded = PROTECTED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );

  if (enforced && guarded && !user) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = "";
    // Come back to where they were headed. Path only — an absolute URL here
    // would let a crafted link bounce someone off-site after signing in.
    login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }

  return response;
}

export const config = {
  /**
   * Everything except static assets and image files. The auth routes are
   * deliberately *inside* the matcher — `/auth/callback` sets the session
   * cookie, and skipping the refresh there is how you get a callback that
   * appears to work and lands on a signed-out page.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|images/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff|woff2)$).*)",
  ],
};
