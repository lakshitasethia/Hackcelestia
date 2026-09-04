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
 * The pooler is dual-stack, so it works either way. Set SUPABASE_POOLER_HOST
 * to the hostname from Supabase → Settings → Database → Connection string and
 * every script here prefers it, building the user and password from what is
 * already configured. Without it we fall back to the direct host, which is
 * fine on IPv6 and fails clearly otherwise.
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

/** Blank means unset. `Number("")` is 0, which as a port is a baffling
 *  connection refusal rather than an obvious misconfiguration — and every
 *  optional key in .env.example ships blank, so this case is the norm. */
function envValue(name) {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function connectionConfig() {
  // A full connection string pasted from the dashboard wins outright.
  const explicit = envValue("SUPABASE_DB_URL");
  if (explicit) {
    return { connectionString: explicit, ssl: { rejectUnauthorized: false } };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local");
  const ref = new URL(url).hostname.split(".")[0];

  const password = envValue("SUPABASE_DB_PASSWORD");
  if (!password) throw new Error("SUPABASE_DB_PASSWORD is not set in .env.local");

  /**
   * The pooler, preferred whenever its host is known.
   *
   * Deliberately assembled from the same SUPABASE_DB_PASSWORD the direct host
   * uses rather than taking a second full connection string: the password
   * needs rotating from time to time, and a copy of it living in a second
   * variable is a copy somebody forgets. Only the hostname differs, so only
   * the hostname is configured.
   *
   * The pooler authenticates by tenant, which is why the user is
   * `postgres.<project-ref>` here and a bare `postgres` on the direct host.
   */
  const pooler = envValue("SUPABASE_POOLER_HOST");
  if (pooler) {
    return {
      host: pooler,
      port: Number(envValue("SUPABASE_POOLER_PORT") ?? 5432),
      user: `postgres.${ref}`,
      password,
      database: "postgres",
      ssl: { rejectUnauthorized: false },
    };
  }

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
      `pooler hostname in SUPABASE_POOLER_HOST (.env.local) and re-run:\n` +
      `Supabase → Settings → Database → Connection string → Transaction pooler.`
    );
  }
  return err?.message ?? String(err);
}
