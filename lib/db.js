/**
 * Redis-backed datastore, replacing the plain JSON file this app used
 * before it needed to run on Vercel. Vercel's serverless functions run
 * on a read-only filesystem (aside from /tmp, which isn't shared or
 * persisted across invocations) — a file-based store simply doesn't
 * survive there, so this stores the same shape of data as one JSON blob
 * under a single Redis key instead.
 *
 * Uses @upstash/redis (HTTP-based, so no connection pooling concerns in
 * a serverless environment). Provision via Vercel Dashboard -> Storage ->
 * Marketplace Database Providers -> Upstash, which auto-injects the
 * right environment variables into your project — see the "Deploying to
 * Vercel" section of README.md.
 *
 * IMPORTANT TRADEOFF: like the JSON-file version before it, withDb()
 * below is read-modify-write over the WHOLE dataset, not a real
 * transaction. Two requests that both read, then both write, can race —
 * the second write wins and silently discards whatever the first one
 * changed. For a small personal/community puzzle site, occasional
 * concurrent admin edits or simultaneous solves are low-stakes and this
 * is an acceptable, documented tradeoff. If you outgrow it, the fix is a
 * real relational database (e.g. Neon Postgres via the Vercel
 * Marketplace) with row-level writes instead of one giant blob — every
 * route in this project only calls withDb(), so that's the one place
 * you'd need to change.
 */

const { Redis } = require("@upstash/redis");

const DB_KEY = "logicdle:db";

function defaultDb() {
  return { users: [], sessions: {}, puzzles: [], completions: [], starts: [], submissions: [], leaderboards: [] };
}

let client = null;
function getClient() {
  if (client) return client;

  // Different Marketplace Redis providers (and Vercel's own historical
  // naming) inject slightly different env var names. Check the common
  // ones rather than assuming — if this throws, check Vercel Dashboard ->
  // your project -> Settings -> Environment Variables for the exact
  // names your integration actually set, and adjust here if needed.
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      "No Redis connection configured. Add an Upstash Redis database to this " +
      "project (Vercel Dashboard -> Storage -> Marketplace Database Providers -> " +
      "Upstash) and redeploy, or set KV_REST_API_URL/KV_REST_API_TOKEN " +
      "(or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN) yourself."
    );
  }

  client = new Redis({ url, token });
  return client;
}

async function load() {
  const raw = await getClient().get(DB_KEY);
  if (!raw) return defaultDb();
  // @upstash/redis auto-deserializes JSON values, but handle a raw
  // string too in case automaticDeserialization is off in some setup.
  const db = typeof raw === "string" ? JSON.parse(raw) : raw;
  // Defensive backfill for data saved before a given collection existed,
  // so older deployments self-heal instead of throwing on `db.x.find(...)`.
  db.submissions = db.submissions || [];
  db.leaderboards = db.leaderboards || [];
  return db;
}

async function save(db) {
  await getClient().set(DB_KEY, db);
}

/**
 * Read the whole DB, let `mutator` change it in place (or return a
 * result to hand back to the caller), then persist. Every route calls
 * this instead of touching Redis directly, so the one-big-blob
 * limitation above lives in exactly one place if it ever needs to change.
 */
async function withDb(mutator) {
  const db = await load();
  const result = await mutator(db);
  await save(db);
  return result;
}

module.exports = { withDb };
