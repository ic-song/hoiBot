import { loadConfig } from "../src/config.js";
import { createDatabaseClient } from "../src/database.js";

const database = createDatabaseClient(loadConfig().database);
try {
  const rows = await database.query<Array<{
    profiles: bigint; mappings: bigint; unresolved: bigint; anomalies: bigint; currencies: bigint;
    pets: bigint; titles: bigint; homes: bigint; guild_members: bigint; leaderboard_entries: bigint; orphan_profiles: bigint;
  }>>(`SELECT
    (SELECT COUNT(*) FROM player_profiles) AS profiles,
    (SELECT COUNT(*) FROM legacy_identity_map) AS mappings,
    (SELECT COUNT(*) FROM legacy_identity_map WHERE resolution_status = 'unresolved') AS unresolved,
    (SELECT COUNT(*) FROM legacy_import_anomalies) AS anomalies,
    (SELECT COUNT(*) FROM currency_accounts) AS currencies,
    (SELECT COUNT(*) FROM player_pets) AS pets,
    (SELECT COUNT(*) FROM player_titles) AS titles,
    (SELECT COUNT(*) FROM player_homes) AS homes,
    (SELECT COUNT(*) FROM guild_members) AS guild_members,
    (SELECT COUNT(*) FROM leaderboard_entries) AS leaderboard_entries,
    (SELECT COUNT(*) FROM player_profiles profile LEFT JOIN players player ON player.id = profile.player_id WHERE player.id IS NULL) AS orphan_profiles`);
  const value = rows[0];
  if (value === undefined || value.profiles !== 610n || value.mappings !== 610n || value.unresolved !== 610n
    || value.anomalies !== 1n || value.currencies < 610n || value.pets === 0n || value.titles === 0n
    || value.homes === 0n || value.guild_members === 0n || value.leaderboard_entries === 0n || value.orphan_profiles !== 0n) {
    throw new Error("Disposable legacy import reconciliation failed.");
  }
  process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toString()]))) + "\n");
} finally {
  await database.close();
}
