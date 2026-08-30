/** Proves a change on one surface reaches the others. npx tsx scripts/test-realtime.mts */
import fs from "node:fs";
for (const l of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = l.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) process.env[t.slice(0, i).trim()] ||= t.slice(i + 1).trim();
}

import { createClient } from "@supabase/supabase-js";
const { DEMO_TRIP_ID } = await import("../src/lib/db/queries.js");
const { notifyTrip } = await import("../src/lib/realtime/notify.js");
const { tripChannel } = await import("../src/lib/realtime/channel.js");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
  if (!ok) failures++;
};

/**
 * Subscribes with the *anon* key, exactly as the browser does. That is the
 * point of the test: the server broadcasts with the service role, the
 * surfaces listen with the key the public gets, and if those two ever stop
 * agreeing the demo fails silently — three screens that simply never update.
 */
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } }
);

const received: { event: string; payload: Record<string, unknown> }[] = [];

const subscribed = await new Promise<boolean>((resolve) => {
  const timeout = setTimeout(() => resolve(false), 15_000);
  supabase
    .channel(tripChannel(DEMO_TRIP_ID))
    // The wildcard the client component uses, not a named event — a handler
    // bound to one event would pass here and miss every other kind on screen.
    .on("broadcast", { event: "*" }, (message) => {
      received.push({ event: message.event, payload: message.payload });
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(true);
      }
    });
});

check("a browser-key client can subscribe to the trip topic", subscribed);
if (!subscribed) process.exit(1);

await notifyTrip(DEMO_TRIP_ID, "itinerary_changed", { proposals: 2 });
await notifyTrip(DEMO_TRIP_ID, "field_report", { item: "Private boat day" });

// Broadcast is fire-and-forget; give the round trip room without making the
// suite slow enough that nobody runs it.
await new Promise((r) => setTimeout(r, 3000));

check("the accept broadcast arrives", received.some((m) => m.event === "itinerary_changed"));
check("a second, different event also arrives", received.some((m) => m.event === "field_report"));
check("both arrived", received.length === 2, `${received.length} messages`);

const accepted = received.find((m) => m.event === "itinerary_changed");
check("the payload survives the round trip", accepted?.payload?.proposals === 2,
  JSON.stringify(accepted?.payload ?? {}));
check("the server stamps a send time", typeof accepted?.payload?.at === "string");

// A broadcast on another trip's topic must not wake this one, or the operator
// board would refresh on every group in the system.
await notifyTrip("00000000-0000-4000-a000-000000000000", "itinerary_changed");
await new Promise((r) => setTimeout(r, 2000));
check("a different trip's broadcast does not leak in", received.length === 2,
  `${received.length} messages`);

await supabase.removeAllChannels();
console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
