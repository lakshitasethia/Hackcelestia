#!/usr/bin/env node
/**
 * Run a .sql file, or an inline query, against the Supabase Postgres.
 *
 *   node scripts/sql.mjs supabase/seed.sql
 *   node scripts/sql.mjs -c "select count(*) from itinerary_items"
 *
 * Reads credentials from .env.local. The CLI's `db push` covers migrations;
 * this covers seeding and the verification queries that migrations can't do.
 */
import fs from "node:fs";
import pg from "pg";
import { loadEnv, connectionConfig, explain } from "./pg-config.mjs";

loadEnv();

const args = process.argv.slice(2);
const inline = args[0] === "-c";
const sql = inline
  ? args.slice(1).join(" ")
  : fs.readFileSync(args[0], "utf8");

/**
 * The day the seed anchors to, when one is pinned.
 *
 * `demo_base_date()` reads this setting and falls back to today, so an unset
 * DEMO_DATE leaves every existing behaviour exactly as it was. It is prepended
 * to the statement rather than issued separately because the whole file runs as
 * one query, and a `set` in a different call would land in a different session.
 *
 * `false` on set_config means "for the session", not "until this transaction
 * ends" — the seed files open their own transactions, and a transaction-local
 * setting would be discarded by the first `begin`.
 */
const pinned = process.env.DEMO_DATE?.trim();
if (pinned && !/^\d{4}-\d{2}-\d{2}$/.test(pinned)) {
  console.error(`DEMO_DATE must be YYYY-MM-DD, got "${pinned}".`);
  process.exit(1);
}

const client = new pg.Client(connectionConfig());

try {
  await client.connect();
} catch (err) {
  // connect() throws outside the query try/catch below, so without this
  // the resolver's bare ENOTFOUND is the last thing you see.
  console.error(`\nSQL could not connect: ${explain(err)}`);
  process.exit(1);
}
try {
  const result = await client.query(
    pinned
      ? `select set_config('voyage.base_date', '${pinned}', false);\n${sql}`
      : sql
  );
  const results = Array.isArray(result) ? result : [result];
  let failed = 0;
  for (const r of results) {
    if (r.rows?.length) console.table(r.rows);
    else if (r.command) console.log(`${r.command} ${r.rowCount ?? ""}`.trim());

    // verify.sql reports its findings as rows rather than errors, so without
    // this the script exits 0 with FAIL printed on screen — which means it
    // cannot gate anything that runs after it.
    failed += (r.rows ?? []).filter((row) => row.result === "FAIL").length;
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) FAILED.`);
    process.exitCode = 1;
  }
} catch (err) {
  // Postgres puts the useful part in position/detail, which the bare message drops.
  console.error(`\nSQL error: ${explain(err)}`);
  if (err.detail) console.error(`detail:   ${err.detail}`);
  if (err.hint) console.error(`hint:     ${err.hint}`);
  if (err.position) console.error(`position: ${err.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
