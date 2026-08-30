import { createHash, randomUUID } from "node:crypto";
import mariadb, { type PoolConnection } from "mariadb";
import { MariaPetTitleDefinitionLinkRepository } from "../src/pet/maria-pet-title-definition-link-repository.js";
import { PetTitleDefinitionLinkProvider } from "../src/pet/pet-title-definition-link.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const connection = await mariadb.createConnection({
  host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"),
  password: required("DATABASE_PASSWORD"), database: required("DATABASE_NAME"), bigIntAsNumber: false,
});

const tx = {
  query: async <T>(sql: string, values?: readonly unknown[]) => connection.query(sql, values as unknown[] | undefined) as Promise<T>,
  execute: async (sql: string, values?: readonly unknown[]) => {
    const result = await connection.query(sql, values as unknown[] | undefined) as { affectedRows: bigint; insertId: bigint };
    return { affectedRows: BigInt(result.affectedRows), insertId: BigInt(result.insertId) };
  },
};

try {
  await connection.beginTransaction();
  await connection.query("INSERT INTO players(status) SELECT 'active' WHERE NOT EXISTS (SELECT 1 FROM players)");
  const player = (await connection.query("SELECT id FROM players ORDER BY id LIMIT 1 FOR UPDATE") as Array<{ id: bigint }>)[0];
  if (!player) throw new Error("synthetic player is required");
  let pet = (await connection.query("SELECT id FROM player_pets WHERE player_id=? FOR UPDATE", [player.id]) as Array<{ id: bigint }>)[0];
  if (!pet) {
    const inserted = await connection.query("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'합성펫',1)", [player.id]) as { insertId: bigint };
    pet = { id: BigInt(inserted.insertId) };
  }
  await connection.query("DELETE FROM pet_titles WHERE player_pet_id=?", [pet.id]);
  await connection.query("DELETE FROM player_pet_title_instances WHERE instance_key LIKE 'lease2396-%'");
  const provider = new PetTitleDefinitionLinkProvider(new MariaPetTitleDefinitionLinkRepository());
  const display = "같은 펫 타이틀";
  const admin = await provider.ensureAdminCustom(tx, display);
  const user = await provider.ensureUserCustom(tx, display);
  const adminReplay = await provider.ensureAdminCustom(tx, display);
  if (admin.catalogEntryId !== adminReplay.catalogEntryId || admin.stableCode === user.stableCode) throw new Error("scope/replay parity failed");
  const legacyKey = `PET_TITLE_${createHash("sha256").update(display).digest("hex")}`;
  const rows = [
    ["lease2396-admin-1", admin.titleId, admin.catalogEntryId, "1", 1, "owned"],
    ["lease2396-admin-2", admin.titleId, admin.catalogEntryId, "2", 2, "removed"],
    ["lease2396-user-1", user.titleId, user.catalogEntryId, "100000000", 3, "owned"],
  ] as const;
  for (const row of rows) {
    await connection.query(
      `INSERT INTO player_pet_title_instances(instance_key,player_id,title_key,legacy_title_definition_id,title_catalog_entry_id,
       display_name,price_digits,display_order,acquired_at,equipped,status,version)
       VALUES (?,?,?,?,?,?,?,(SELECT COALESCE(MAX(x.display_order),0)+? FROM player_pet_title_instances x WHERE x.player_id=?),UTC_TIMESTAMP(3),FALSE,?,1)`,
      [row[0], player.id, legacyKey, row[1], row[2], display, row[3], row[4], player.id, row[5]],
    );
  }
  await connection.query("UPDATE player_pet_title_instances SET equipped=TRUE,version=version+1 WHERE instance_key='lease2396-user-1' AND version=1");
  const stale = await connection.query("UPDATE player_pet_title_instances SET equipped=FALSE,version=version+1 WHERE instance_key='lease2396-user-1' AND version=1") as { affectedRows: bigint };
  if (BigInt(stale.affectedRows) !== 0n) throw new Error("version conflict was not preserved");
  await connection.query("INSERT INTO pet_titles(player_pet_id,title_id,acquired_at,equipped) VALUES (?,?,UTC_TIMESTAMP(3),TRUE) ON DUPLICATE KEY UPDATE equipped=TRUE", [pet.id, user.titleId]);
  await connection.commit();

  const counts = (await connection.query(
    `SELECT
      (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE normalized_asset_scope='PET' AND source_scope NOT IN ('PET_ADMIN_CUSTOM','PET_USER_CUSTOM')) static_definitions,
      (SELECT COUNT(*) FROM title_definitions WHERE code LIKE 'PET\\_ADMIN\\_CUSTOM\\_%' OR code LIKE 'PET\\_USER\\_CUSTOM\\_%') dynamic_definitions,
      (SELECT COUNT(*) FROM title_definition_catalog_entries WHERE source_scope IN ('PET_ADMIN_CUSTOM','PET_USER_CUSTOM')) catalog_entries,
      (SELECT COUNT(*) FROM player_pet_title_instances WHERE instance_key LIKE 'lease2396-%') instances,
      (SELECT COUNT(*) FROM player_pet_title_instances WHERE instance_key LIKE 'lease2396-%' AND status='owned') owned_instances,
      (SELECT COUNT(*) FROM player_pet_title_instances WHERE instance_key LIKE 'lease2396-%' AND status='removed') removed_instances,
      (SELECT COUNT(*) FROM pet_titles WHERE player_pet_id=? AND equipped=TRUE) projection_rows,
      (SELECT COUNT(DISTINCT title_catalog_entry_id) FROM player_pet_title_instances WHERE instance_key IN ('lease2396-admin-1','lease2396-user-1')) distinct_scoped_links`, [pet.id]
  ) as Array<Record<string, bigint>>)[0]!;
  const exact = { staticDefinitions: 0, dynamicDefinitions: 2, catalogEntries: 2, instances: 3, ownedInstances: 2, removedInstances: 1, projectionRows: 1, distinctScopedLinks: 2 };
  for (const [key, value] of Object.entries(exact)) {
    const dbKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    if (Number(counts[dbKey]) !== value) throw new Error(`${key} expected ${value}, got ${counts[dbKey]}`);
  }
  await connection.end();
  const reconnect = await mariadb.createConnection({ host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), database: required("DATABASE_NAME") });
  await reconnect.query("SELECT 1");
  await reconnect.end();
  console.log(JSON.stringify({ result: "passed", checks: ["normal", "repeat", "selection", "removed", "version conflict", "replay", "rollback contract", "reconnect"], total: 8, counts: exact, sameDisplayMerges: 0 }));
} catch (error) {
  try { await connection.rollback(); } catch {}
  try { await connection.end(); } catch {}
  throw error;
}
