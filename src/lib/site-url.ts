/**
 * Where this deployment thinks it lives.
 *
 * The subtlety that took a production build down: `??` falls through on
 * `undefined`, not on `""`. An environment variable that exists but is blank —
 * which is exactly what you get from pasting a `.env` template into a hosting
 * dashboard, since every optional key is present and empty — sails past `??`
 * and lands in `new URL("")`, which throws `ERR_INVALID_URL`.
 *
 * Locally the variable was simply absent, so `??` worked and every build
 * passed. The two cases are indistinguishable in a dashboard and behave
 * completely differently in code, so treat blank as absent everywhere and stop
 * relying on the difference.
 */

/** Blank, whitespace, or unset all mean "not configured". */
function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A configured origin, or undefined. Never throws: a malformed value is
 * treated as absent rather than taken down the build with it, because a
 * mistyped URL in a dashboard should degrade to a wrong canonical link, not to
 * a site that will not deploy.
 */
export function configuredSiteUrl(): string | undefined {
  const explicit = present(process.env.NEXT_PUBLIC_SITE_URL);
  const vercel = present(process.env.VERCEL_PROJECT_PRODUCTION_URL);

  const candidate = explicit ?? (vercel ? `https://${vercel}` : undefined);
  if (!candidate) return undefined;

  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    return undefined;
  }
}

/** The origin, with a fallback for when nothing is configured. */
export function siteUrl(fallback = "http://localhost:3000"): string {
  return configuredSiteUrl() ?? fallback;
}
