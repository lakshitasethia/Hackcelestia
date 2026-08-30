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

function loadEnv(file = ".env.local") {
  if (!fs.existsSync(file)) throw new Error(`${file} not found`);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (value && !process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set in .env.local");

const args = process.argv.slice(2);
const inline = args[0] === "-c";
const sql = inline
  ? args.slice(1).join(" ")
  : fs.readFileSync(args[0], "utf8");

const client = new pg.Client({
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: "postgres",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

await client.connect();
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
  console.error(`\nSQL error: ${err.message}`);
  if (err.detail) console.error(`detail:   ${err.detail}`);
  if (err.hint) console.error(`hint:     ${err.hint}`);
  if (err.position) console.error(`position: ${err.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
