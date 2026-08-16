import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const argumentsList = process.argv.slice(2);

// 이름이 있는 필수 CLI 인수를 반환합니다.
function requiredArgument(name: string): string {
  const index = argumentsList.indexOf(name);
  const value = index >= 0 ? argumentsList[index + 1] : undefined;
  if (value === undefined || value.trim() === "") throw new Error(`Missing required argument: ${name}`);
  return value;
}

// 음수가 아닌 정수 CLI 인수를 BigInt로 변환합니다.
function requiredCount(name: string): bigint {
  const value = requiredArgument(name);
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(value);
}

const rootHash = requiredArgument("--root-hash");
if (!/^[a-f0-9]{64}$/.test(rootHash)) throw new Error("--root-hash must be a lowercase SHA-256 hash");
const expectedMembers = requiredCount("--member-count");
const expectedFiles = requiredCount("--file-count");
const expectedAnomalies = requiredCount("--anomaly-count");

const database = createDatabaseClient(loadConfig().database);
try {
  const runs = await database.query<Array<{ id: bigint }>>(
    `SELECT id FROM legacy_import_runs
     WHERE source_root_hash = ? AND mode = 'apply' AND status = 'completed'
     ORDER BY id DESC LIMIT 1`,
    [rootHash]
  );
  const importRunId = runs[0]?.id;
  if (importRunId === undefined) throw new Error("No completed import run matches the selected source snapshot.");

  const rows = await database.query<Array<{
    files: bigint;
    mappings: bigint;
    mapped_players: bigint;
    unresolved: bigint;
    anomalies: bigint;
    missing_profiles: bigint;
    duplicate_players: bigint;
    currencies: bigint;
    inventory_definitions: bigint;
    inventory_stacks: bigint;
    inventory_quantity: string;
    orphan_inventory: bigint;
    pets: bigint;
    titles: bigint;
    homes: bigint;
    guild_members: bigint;
    leaderboard_entries: bigint;
  }>>(`SELECT
    (SELECT COUNT(*) FROM legacy_import_files WHERE import_run_id = ?) AS files,
    (SELECT COUNT(*) FROM legacy_identity_map WHERE import_run_id = ?) AS mappings,
    (SELECT COUNT(DISTINCT player_id) FROM legacy_identity_map WHERE import_run_id = ?) AS mapped_players,
    (SELECT COUNT(*) FROM legacy_identity_map WHERE import_run_id = ? AND resolution_status = 'unresolved') AS unresolved,
    (SELECT COUNT(*) FROM legacy_import_anomalies WHERE import_run_id = ?) AS anomalies,
    (SELECT COUNT(*) FROM legacy_identity_map map
      LEFT JOIN player_profiles profile ON profile.player_id = map.player_id
      WHERE map.import_run_id = ? AND profile.player_id IS NULL) AS missing_profiles,
    (SELECT COUNT(*) FROM (SELECT player_id FROM legacy_identity_map WHERE import_run_id = ? GROUP BY player_id HAVING COUNT(*) > 1) duplicates) AS duplicate_players,
    (SELECT COUNT(*) FROM currency_accounts currency JOIN legacy_identity_map map ON map.player_id = currency.player_id WHERE map.import_run_id = ?) AS currencies,
    (SELECT COUNT(DISTINCT item.id) FROM item_definitions item JOIN inventory_stacks stack ON stack.item_id = item.id
      JOIN legacy_identity_map map ON map.player_id = stack.player_id WHERE map.import_run_id = ?) AS inventory_definitions,
    (SELECT COUNT(*) FROM inventory_stacks stack JOIN legacy_identity_map map ON map.player_id = stack.player_id WHERE map.import_run_id = ?) AS inventory_stacks,
    (SELECT CAST(COALESCE(SUM(stack.quantity), 0) AS CHAR) FROM inventory_stacks stack
      JOIN legacy_identity_map map ON map.player_id = stack.player_id WHERE map.import_run_id = ?) AS inventory_quantity,
    (SELECT COUNT(*) FROM inventory_stacks stack JOIN legacy_identity_map map ON map.player_id = stack.player_id
      LEFT JOIN players player ON player.id = stack.player_id LEFT JOIN item_definitions item ON item.id = stack.item_id
      WHERE map.import_run_id = ? AND (player.id IS NULL OR item.id IS NULL)) AS orphan_inventory,
    (SELECT COUNT(*) FROM player_pets pet JOIN legacy_identity_map map ON map.player_id = pet.player_id WHERE map.import_run_id = ?) AS pets,
    (SELECT COUNT(*) FROM player_titles title_row JOIN legacy_identity_map map ON map.player_id = title_row.player_id WHERE map.import_run_id = ?) AS titles,
    (SELECT COUNT(*) FROM player_homes home JOIN legacy_identity_map map ON map.player_id = home.player_id WHERE map.import_run_id = ?) AS homes,
    (SELECT COUNT(*) FROM guild_members member_row JOIN legacy_identity_map map ON map.player_id = member_row.player_id WHERE map.import_run_id = ?) AS guild_members,
    (SELECT COUNT(*) FROM leaderboard_entries entry JOIN legacy_identity_map map ON map.player_id = entry.player_id WHERE map.import_run_id = ?) AS leaderboard_entries`,
    Array(17).fill(importRunId)
  );
  const value = rows[0];
  if (value === undefined || value.files !== expectedFiles || value.mappings !== expectedMembers
    || value.mapped_players !== expectedMembers || value.anomalies !== expectedAnomalies
    || value.missing_profiles !== 0n || value.duplicate_players !== 0n
    || value.inventory_definitions === 0n || value.inventory_stacks === 0n
    || BigInt(value.inventory_quantity) < 0n || value.orphan_inventory !== 0n) {
    throw new Error("Selected legacy import reconciliation failed.");
  }

  process.stdout.write(JSON.stringify({
    importRunId: importRunId.toString(),
    rootHash,
    ...Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toString()]))
  }) + "\n");
} finally {
  await database.close();
}
