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
