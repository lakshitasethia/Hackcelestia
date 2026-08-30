#!/usr/bin/env node
/**
 * Bring an empty Supabase project up to a working demo, in one command.
 *
 *   node scripts/db-setup.mjs              # migrate, seed, verify
 *   node scripts/db-setup.mjs --no-seed    # schema only
 *
 * This exists because a free-tier Supabase project pauses after a week idle and
 * is deleted after ninety days — so "restore the database" is a thing that
 * genuinely happens between building a demo and giving it, and it should not be
 * a scavenger hunt through the migration folder.
 *
 * Applied versions are recorded in `supabase_migrations.schema_migrations`,
 * which is the same ledger the Supabase CLI keeps. That means this and
 * `supabase db push` agree about what has run, and using one does not confuse
 * the other.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) process.env[t.slice(0, eq).trim()] ||= t.slice(eq + 1).trim();
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set in .env.local");

const ref = new URL(url).hostname.split(".")[0];
const client = new pg.Client({
  host: `db.${ref}.supabase.co`,
  port: 5432,
  user: "postgres",
  password,
  database: "postgres",
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
} catch (err) {
  // The failure mode this script is written for, named explicitly — the error
  // node hands you for a paused or deleted project is a bare ENOTFOUND.
  console.error(`\nCould not reach db.${ref}.supabase.co — ${err.message}`);
  if (err.code === "ENOTFOUND") {
    console.error(
      "\nThat hostname does not resolve at all, which means the project is\n" +
        "paused or gone rather than merely unreachable. Restore or recreate it\n" +
        "at supabase.com/dashboard, then put the new URL, anon key, service\n" +
        "role key and database password in .env.local and run this again."
    );
  }
  process.exit(1);
}

const step = (msg) => console.log(`\n\x1b[1m${msg}\x1b[0m`);

await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key,
    name    text,
    statements text[]
  );
`);

const dir = "supabase/migrations";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const { rows: applied } = await client.query(
  "select version from supabase_migrations.schema_migrations"
);
const done = new Set(applied.map((r) => r.version));

step(`Migrations (${files.length} on disk, ${done.size} already applied)`);

for (const file of files) {
  const version = file.split("_")[0];
  if (done.has(version)) {
    console.log(`  skip  ${file}`);
    continue;
  }

  const sql = fs.readFileSync(path.join(dir, file), "utf8");
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query(
      "insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)",
      [version, file.replace(/^\d+_/, "").replace(/\.sql$/, "")]
    );
    await client.query("commit");
    console.log(`  run   ${file}`);
  } catch (err) {
    await client.query("rollback");
    console.error(`\n  FAIL  ${file}\n  ${err.message}`);
    if (err.detail) console.error(`  detail: ${err.detail}`);
    if (err.hint) console.error(`  hint:   ${err.hint}`);
    await client.end();
    process.exit(1);
  }
}

if (!process.argv.includes("--no-seed")) {
  step("Seed");
  await client.query(fs.readFileSync("supabase/seed.sql", "utf8"));
  console.log("  seeded the Amalfi demo group");
}

step("Verify");
const result = await client.query(fs.readFileSync("supabase/verify.sql", "utf8"));
const checks = (Array.isArray(result) ? result.at(-1) : result).rows;
for (const row of checks) {
  const mark = row.result === "PASS" ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
  console.log(`  ${mark}  ${row.label}`);
}

const failed = checks.filter((r) => r.result !== "PASS").length;
await client.end();

console.log(
  failed === 0
    ? "\nDatabase ready. Next: npm run db:types, then npm run dev\n"
    : `\n${failed} check(s) failed — the demo will not behave correctly.\n`
);
process.exit(failed === 0 ? 0 : 1);
