"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Wifi, WifiOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { tripChannel, type TripEvent } from "@/lib/realtime/channel";

/**
 * Keeps a surface current while someone is looking at it.
 *
 * Subscribes to the trip's broadcast topic and calls `router.refresh()` when
 * anything moves, so the server components re-render against fresh data
 * without a full navigation and without losing scroll position.
 *
 * The visible indicator is not decoration. The claim being demonstrated is that
 * three people see the same change at the same moment, and a screen that
 * silently swapped its contents would be indistinguishable from one that was
 * always going to say that. Showing what arrived, and when, is the evidence.
 */

const LABEL: Record<TripEvent, string> = {
  itinerary_changed: "Itinerary updated",
  disruption_opened: "Disruption reported",
  disruption_cleared: "Disruption cleared",
  replan_ready: "New plans proposed",
  field_report: "Update from the field",
};

export default function LiveRefresh({
  tripIds,
  className = "",
}: {
  /** Every trip this screen is showing. The operator board watches all of
   *  them; the traveler and field views watch exactly one. */
  tripIds: string[];
  className?: string;
}) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Joined into a string so a fresh array literal on every render does not
  // tear down and rebuild the subscriptions on each refresh — which, since a
  // refresh is exactly what this component causes, would loop.
  const key = tripIds.join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) return;

    const supabase = createClient();
    const channels = ids.map((id) =>
      supabase
        .channel(tripChannel(id))
        // A single wildcard handler rather than one per event: every event
        // means the same thing to a server-rendered page — the data underneath
        // it is stale — and only the label differs.
        .on("broadcast", { event: "*" }, ({ event }) => {
          setNotice(LABEL[event as TripEvent] ?? "Trip updated");
          router.refresh();

          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setNotice(null), 6000);
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") setConnected(true);
        })
    );

    return () => {
      if (timer.current) clearTimeout(timer.current);
      for (const channel of channels) supabase.removeChannel(channel);
    };
  }, [key, router]);

  return (
    <div
      className={`flex items-center gap-2 font-sans text-xs uppercase tracking-wider ${className}`}
      aria-live="polite"
    >
      {notice ? (
        <span className="flex items-center gap-1.5 text-accent">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          {notice}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-muted">
          {connected ? (
            <Wifi className="w-3.5 h-3.5" />
          ) : (
            <WifiOff className="w-3.5 h-3.5" />
          )}
          {connected ? "Live" : "Offline"}
        </span>
      )}
    </div>
  );
}
