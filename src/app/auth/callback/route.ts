import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Google (and an emailed confirmation link) lands.
 *
 * Supabase hands back a one-time `code`; exchanging it is what actually writes
 * the session cookie. This has to be a route handler rather than a page —
 * server components cannot set cookies, so a page here would exchange the code
 * successfully and then render for a user who appears signed out.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");

  // Same rule as the login form: our own paths only, never an absolute URL.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";

  // The user declined at Google's consent screen, or the provider is not
  // configured. Either way they get told, on the page they came from.
  const providerError = searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(providerError)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("That sign-in link was incomplete. Try again.")}`
    );
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`
    );
  }

  /**
   * `x-forwarded-host` is the deployment's real hostname behind Vercel's
   * proxy, where `origin` is the internal one. Redirecting to `origin` there
   * sends the user somewhere that does not resolve — a bug that only ever
   * shows up in production, which is the worst place to find it.
   */
  const forwardedHost = request.headers.get("x-forwarded-host");
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `https://${forwardedHost}`;

  return NextResponse.redirect(`${base}${destination}`);
}
