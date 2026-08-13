import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import mariadb from "mariadb";
import { loadConfig } from "../src/config.js";

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const verifyOnly = args.has("--verify-only");
if (apply && verifyOnly) throw new Error("--apply and --verify-only cannot be used together.");

const fixturePath = path.resolve("../migration-control/fixtures/synthetic-relational/functional-v1.sql");
const fixtureSql = await readFile(fixturePath, "utf8");
const fixtureChecksum = createHash("sha256").update(fixtureSql).digest("hex");
const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (config.database.name !== "hoibot_schema_design" && !/^hoibot_rehearsal_[a-z0-9_]+$/i.test(config.database.name)) {
  throw new Error(`Synthetic fixture is blocked for database: ${config.database.name}`);
}

const expectedMinimumRows: Record<string, number> = {
  players: 3,
  external_identities: 3,
  player_profiles: 3,
  pre_signup_attendance: 1,
  currency_accounts: 6,
  inventory_stacks: 3,
  player_pets: 2,
  player_pet_elementals: 1,
  pet_skills: 1,
  pet_skill_inventory: 1,
  owned_mini_pets: 1,
  mini_pet_collection_entries: 1,
  player_homes: 2,
  furniture_placements: 2,
  home_comments: 1,
  guilds: 2,
  guild_members: 3,
  player_attendance: 2,
  community_posts: 2,
  castle_battle_participants: 2,
  package_purchases: 1,
  currency_ledger: 1,
  inventory_ledger: 1,
  home_activity_events: 1,
  pet_expedition_runs: 1,
  player_event_progress: 2,
  leaderboard_entries: 2,
  player_tower_progress: 2,
  market_listings: 1,
  bag_integrity_checks: 1,
  request_monitor_policies: 1
};

const connection = await mariadb.createConnection({
  host: config.database.host,
  port: config.database.port,
  user: config.database.user,
  password: config.database.password,
  database: config.database.name,
  connectTimeout: config.database.connectTimeoutMs,
  charset: "utf8mb4",
  timezone: "Z",
  multipleStatements: true,
  bigIntAsNumber: false
});

async function verifyFixture(): Promise<Record<string, number>> {
  const actual: Record<string, number> = {};
  for (const [table, minimum] of Object.entries(expectedMinimumRows)) {
    const rows = await connection.query<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM \`${table}\` WHERE ${
        table === "players" ? "id BETWEEN 900000001 AND 900000003" :
        table === "external_identities" ? "provider_code = 'synthetic'" :
        table === "currency_accounts" ? "player_id BETWEEN 900000001 AND 900000003" :
        table === "pre_signup_attendance" ? "id = 900000100 AND status = 'active'" :
        table === "player_profiles" || table === "inventory_stacks" || table === "player_pets" || table === "owned_mini_pets" || table === "mini_pet_collection_entries" || table === "player_homes" || table === "player_attendance" || table === "player_event_progress" || table === "player_tower_progress" || table === "bag_integrity_checks" ? "player_id BETWEEN 900000001 AND 900000003" :
        table === "guild_members" ? "guild_id BETWEEN 900000001 AND 900000002" :
        table === "castle_battle_participants" ? "season_id = 900000001" :
        table === "leaderboard_entries" ? "leaderboard_id = 900000001" :
        table === "pet_skills" || table === "pet_skill_inventory" || table === "player_pet_elementals" ? "player_pet_id BETWEEN 900000001 AND 900000002" :
        "id BETWEEN 900000001 AND 900000010"
      }`
    );
    const count = Number(rows[0]?.count ?? 0n);
    if (count < minimum) throw new Error(`Synthetic fixture verification failed: ${table}=${count}, expected>=${minimum}`);
    actual[table] = count;
  }
  return actual;
}

try {
  const lockRows = await connection.query<Array<{ acquired: number }>>(
    "SELECT GET_LOCK('hoibot_synthetic_fixture', 10) AS acquired"
  );
  if (Number(lockRows[0]?.acquired) !== 1) throw new Error("Could not acquire synthetic fixture lock.");

  if (!apply && !verifyOnly) {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", database: config.database.name, fixtureChecksum, statements: fixtureSql.split(";").filter((part) => part.trim() !== "").length })}\n`);
  } else if (apply) {
    await connection.beginTransaction();
    try {
      await connection.query(fixtureSql);
      const counts = await verifyFixture();
      await connection.commit();
      process.stdout.write(`${JSON.stringify({ mode: "apply", database: config.database.name, fixtureChecksum, verifiedTables: Object.keys(counts).length, counts })}\n`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } else {
    const counts = await verifyFixture();
    process.stdout.write(`${JSON.stringify({ mode: "verify-only", database: config.database.name, fixtureChecksum, verifiedTables: Object.keys(counts).length, counts })}\n`);
  }
} finally {
  try {
    await connection.query("SELECT RELEASE_LOCK('hoibot_synthetic_fixture')");
  } finally {
    await connection.end();
  }
}
