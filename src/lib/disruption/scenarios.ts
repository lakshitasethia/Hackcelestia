import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { injectDisruption } from "./engine";
import type { Disruption } from "@/lib/db/types";

/**
 * Named disruption scenarios for the demo.
 *
 * These pick their target by *property* rather than by hard-coded id — the
 * storm looks for a weather-sensitive item in the window, the vendor scenario
 * looks for the priciest confirmed booking. So they keep working if the seed
 * changes, and they read as plausible operations rather than a scripted trick.
 */

export type ScenarioId = "storm" | "vendor_cancel" | "transport_delay";

export const SCENARIOS: {
  id: ScenarioId;
  label: string;
  description: string;
}[] = [
  {
    id: "storm",
    label: "Storm front",
    description: "Rules out anything on the water tomorrow.",
  },
  {
    id: "vendor_cancel",
    label: "Vendor cancels",
    description: "Highest-value supplier drops out at short notice.",
  },
  {
    id: "transport_delay",
    label: "Transfer delayed",
    description: "A transfer slips, and everything behind it moves.",
  },
];

export async function runScenario(
  tripId: string,
  scenario: ScenarioId
): Promise<Disruption | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("itinerary_items")
    .select("*, inventory(weather_sensitive)")
    .eq("trip_id", tripId)
    .gte("starts_at", new Date().toISOString())
    .neq("status", "cancelled")
    .order("starts_at");

  if (error) throw new Error(`runScenario: ${error.message}`);

  type Row = {
    id: string;
    title: string;
    type: string;
    cost: number;
    starts_at: string;
    inventory: { weather_sensitive: boolean } | null;
  };
  const upcoming = (data ?? []) as unknown as Row[];
  if (upcoming.length === 0) return null;

  if (scenario === "storm") {
    const target = upcoming.find((i) => i.inventory?.weather_sensitive);
    if (!target) return null;
    return injectDisruption({
      tripId,
      rootItemId: target.id,
      source: "weather",
      severity: "high",
      headline: `Storm warning — ${target.title} cannot sail`,
      payload: {
        condition: "Force 6 gale, 2.5m swell",
        wind_kts: 28,
        rain_mm: 14,
      },
    });
  }

  if (scenario === "vendor_cancel") {
    const target = [...upcoming].sort((a, b) => Number(b.cost) - Number(a.cost))[0];
    return injectDisruption({
      tripId,
      rootItemId: target.id,
      source: "vendor",
      severity: "high",
      headline: `Supplier cancelled — ${target.title}`,
      payload: {
        vendor_message: "Skipper unwell, no replacement crew available.",
      },
    });
  }

  const target =
    upcoming.find((i) => i.type === "transport") ?? upcoming[0];
  return injectDisruption({
    tripId,
    rootItemId: target.id,
    source: "transport",
    severity: "medium",
    headline: `Delay — ${target.title} running 90 minutes late`,
    payload: { delay_min: 90 },
  });
}
