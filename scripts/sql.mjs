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
  const result = await client.query(sql);
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
