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

/** Where the seeded trip happens. Belongs on the trips table once we support
 *  more than one region; hard-coded until there is a second one. */
export const TRIP_TZ = "Europe/Rome";

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
 * Midnight in the trip's zone, `offsetDays` from today, as a real instant.
 *
 * The coordinator's run sheet asks "what is happening today", and today is
 * defined in Positano, not on whichever Vercel region rendered the page. A
 * naive `new Date().setHours(0,0,0,0)` puts the boundary at 02:00 local in
 * summer and silently drops the first two hours of the day.
 */
export function startOfLocalDay(offsetDays = 0, tz = TRIP_TZ): Date {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: tz });
  const midnight = new Date(`${today}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() + offsetDays);
  return new Date(midnight.getTime() - zoneOffsetMs(midnight, tz));
}

/** "Today" / "Tomorrow" / a weekday, for a run sheet that spans a day boundary. */
export function relativeDayLabel(iso: string, tz = TRIP_TZ): string {
  const key = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: tz });
  const when = key(new Date(iso));
  if (when === key(startOfLocalDay(0, tz))) return "Today";
  if (when === key(startOfLocalDay(1, tz))) return "Tomorrow";
  return formatDate(iso, tz);
}
