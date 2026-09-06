/**
 * Formatting helpers shared by the traveler and operator surfaces.
 *
 * Every date function pins an explicit timeZone. Without one, the server
 * formats in UTC and the browser formats in the viewer's local zone, and React
 * throws a hydration mismatch on text that looks correct in both places — a
 * genuinely annoying bug to track down. Pinning the zone also happens to be
 * right: a traveler wants to see the time the boat leaves *in Positano*, not
 * the time it leaves according to their laptop.
 */

/**
 * The fallback zone, for the few reads with no trip in scope.
 *
 * It is on `trips.time_zone` now, and everything that has a trip uses that —
 * this is what is left: the coordinator's run-sheet window and the relative
 * day labels, which ask "what is today" before they know whose trip it is.
 *
 * It said Europe/Rome while the seeded demo was on the Amalfi Coast. The demo
 * is north India, and a default that disagrees with the only trip in the
 * database is a bug waiting for someone to forget to pass a zone.
 */
export const TRIP_TZ = "Asia/Kolkata";

export function formatTime(iso: string, tz = TRIP_TZ): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}

export function formatDate(iso: string, tz = TRIP_TZ): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: tz,
  });
}

export function formatDateLong(iso: string, tz = TRIP_TZ): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: tz,
  });
}

export function formatMoney(amount: number, currency = "EUR"): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

/** "2h 30m" / "45m" — durations read better than a pair of timestamps. */
export function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.round(
    (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000
  );
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** How far the zone sits from UTC at that instant — handles DST. */
function zoneOffsetMs(at: Date, tz: string): number {
  const asZone = new Date(at.toLocaleString("en-US", { timeZone: tz })).getTime();
  const asUtc = new Date(at.toLocaleString("en-US", { timeZone: "UTC" })).getTime();
  return asZone - asUtc;
}

/**
 * Now — unless a demo has pinned the day.
 *
 * `DEMO_DATE=YYYY-MM-DD` moves the calendar day the application believes it is,
 * keeping the wall-clock time. It exists so a demo recorded in two sittings a
 * fortnight apart shows the same dates in both, which a viewer notices even
 * when they could not say why.
 *
 * The partner half is `demo_base_date()` in Postgres, which anchors the seed to
 * the same day. **Set one and you must set the other**, and `DEMO_DATE` does
 * both: `scripts/sql.mjs` turns it into the session setting the SQL function
 * reads. Pinning only the seed would claim a trip starting on a day the app
 * still thought was past — an empty run sheet and a lifecycle rail insisting
 * the trip had finished.
 *
 * Unset, this is `new Date()` and nothing anywhere behaves differently. It is
 * also inert in the browser: Next only inlines `NEXT_PUBLIC_` variables into
 * the client bundle, so a client component reading this gets the real clock.
 * Every caller that matters — the run sheet window, the lifecycle stage, the
 * operator's 72-hour board — renders on the server.
 */
export function now(): Date {
  const pinned = process.env.DEMO_DATE?.trim();
  if (!pinned || !/^\d{4}-\d{2}-\d{2}$/.test(pinned)) return new Date();

  const [year, month, day] = pinned.split("-").map(Number);
  const shifted = new Date();
  // setFullYear takes all three at once on purpose: setting them one at a time
  // can land on an invalid intermediate date (the 31st of a 30-day month) and
  // silently roll over into the next one.
  shifted.setFullYear(year, month - 1, day);
  return shifted;
}

/**
 * Midnight in the trip's zone, `offsetDays` from today, as a real instant.
 *
 * The coordinator's run sheet asks "what is happening today", and today is
 * defined in Positano, not on whichever Vercel region rendered the page. A
 * naive `new Date().setHours(0,0,0,0)` puts the boundary at 02:00 local in
 * summer and silently drops the first two hours of the day.
 */
export function startOfLocalDay(offsetDays = 0, tz = TRIP_TZ): Date {
  const today = now().toLocaleDateString("en-CA", { timeZone: tz });
  const midnight = new Date(`${today}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() + offsetDays);
  return new Date(midnight.getTime() - zoneOffsetMs(midnight, tz));
}

/**
 * The calendar date, in a named zone, as YYYY-MM-DD.
 *
 * "Has this trip finished?" is a question about the date where the trip is,
 * not where the server is. A group whose last day is today in Positano has not
 * finished at 23:00 UTC, and comparing `ends_on` against a UTC date says they
 * have. `en-CA` is the shortest route to an ISO-shaped date from `Intl`.
 */
export function localDay(when: Date | string = now(), tz = TRIP_TZ): string {
  return new Date(when).toLocaleDateString("en-CA", { timeZone: tz });
}

/** "Today" / "Tomorrow" / a weekday, for a run sheet that spans a day boundary. */
export function relativeDayLabel(iso: string, tz = TRIP_TZ): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const when = key(new Date(iso));
  if (when === key(startOfLocalDay(0, tz))) return "Today";
  if (when === key(startOfLocalDay(1, tz))) return "Tomorrow";
  return formatDate(iso, tz);
}

/**
 * Build an instant from a wall-clock time in a named zone.
 *
 * `new Date("2026-08-24T09:00")` is parsed in the *server's* zone, which is UTC
 * on Vercel — the same class of bug that shifted the seeded itinerary by two
 * hours. This finds the offset for that date and subtracts it.
 */
export function zonedTime(
  startsOn: string,
  day: number,
  localTime: string,
  timeZone: string
): Date {
  const base = new Date(`${startsOn}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + (day - 1));

  const [hours, minutes] = localTime.split(":").map(Number);
  const naive = new Date(base);
  naive.setUTCHours(hours, minutes, 0, 0);

  // How far the target zone sits from UTC on that date (handles DST).
  const asUtc = new Date(
    naive.toLocaleString("en-US", { timeZone: "UTC" })
  ).getTime();
  const asZone = new Date(
    naive.toLocaleString("en-US", { timeZone })
  ).getTime();

  return new Date(naive.getTime() - (asZone - asUtc));
}

