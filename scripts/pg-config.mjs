/**
 * Shared Postgres connection settings for the scripts that need SQL rather
 * than the REST API.
 *
 * Supabase's direct host, `db.<ref>.supabase.co`, publishes **only an AAAA
 * record**. On a network without an IPv6 route — a lot of conference wifi,
 * plenty of corporate VPNs, some mobile hotspots — Node's resolver returns
 * ENOTFOUND and every one of these scripts dies with what looks like "the
 * project is gone". It is not; it is unreachable from where you are standing,
 * and it can start working again when you change networks, which makes it
 * maddening to diagnose under time pressure.
 *
 * The pooler is dual-stack, so it works either way. Set SUPABASE_DB_URL to the
 * connection string from Supabase → Settings → Database → Connection string →
 * **Transaction pooler**, and every script here uses it. Without it we fall
 * back to the direct host, which is fine on IPv6 and fails clearly otherwise.
 */
import fs from "node:fs";

export function loadEnv(file = ".env.local") {
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

export function connectionConfig() {
  const explicit = process.env.SUPABASE_DB_URL;
  if (explicit) {
    return { connectionString: explicit, ssl: { rejectUnauthorized: false } };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  const ref = new URL(url).hostname.split(".")[0];

  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set in .env.local");

  return {
    host: `db.${ref}.supabase.co`,
    port: 5432,
    user: "postgres",
    password,
    database: "postgres",
    ssl: { rejectUnauthorized: false },
  };
}

/** Turn the resolver's unhelpful ENOTFOUND into the sentence that saves the
 *  twenty minutes. Call this from a script's catch. */
export function explain(err) {
  if (err?.code === "ENOTFOUND" && String(err.hostname ?? "").startsWith("db.")) {
    return (
      `${err.message}\n\n` +
      `That host is IPv6-only and this network has no IPv6 route, so it cannot\n` +
      `be reached from here — the project is almost certainly fine. Put the\n` +
      `transaction pooler URL in SUPABASE_DB_URL (.env.local) and re-run:\n` +
      `Supabase → Settings → Database → Connection string → Transaction pooler.`
    );
  }
  return err?.message ?? String(err);
}
