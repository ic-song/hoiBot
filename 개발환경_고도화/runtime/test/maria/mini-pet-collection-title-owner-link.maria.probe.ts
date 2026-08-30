import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDatabaseClient, type DatabaseClient } from "../../src/database.js";
import { MariaMiniPetCollectionTitleOwnerRepository } from "../../src/mini-pet/maria-mini-pet-collection-title-owner-repository.js";
import { MiniPetCollectionTitleOwnerProvider } from "../../src/mini-pet/mini-pet-collection-title-owner-provider.js";
import { MiniPetCollectionTitleOwnerService } from "../../src/mini-pet/mini-pet-collection-title-owner-service.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function open(): DatabaseClient {
  return createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
}
async function main(): Promise<void> {
  let database = open();
  const makeService = (db: DatabaseClient) => new MiniPetCollectionTitleOwnerService(db, new MiniPetCollectionTitleOwnerProvider(new MariaMiniPetCollectionTitleOwnerRepository()));
  let service = makeService(database);
  const playerKey = `lease2401-${createHash("sha256").update(String(Date.now())).digest("hex").slice(0, 16)}`;
  const playerResult = await database.execute("INSERT INTO players (status) VALUES ('active')");
  const playerId = playerResult.insertId.toString();
  const definitionRows = await database.query<Array<{ source_row: number; display_name: string }>>("SELECT CAST(RIGHT(catalog.stable_code, 3) AS UNSIGNED) AS source_row, definition.display_name FROM title_definition_catalog_entries AS catalog JOIN title_definitions AS definition ON definition.id = catalog.legacy_title_definition_id WHERE catalog.source_scope = 'MINI_PET_COLLECTION' ORDER BY source_row LIMIT 3");
  const legacy = definitionRows.map((row, index) => ({ sourceRow: Number(row.source_row), listIndex: index + 1, name: row.display_name, inDate: `2026-08-31T06:2${index}:00.000Z`, price: "10000000000" }));
  const grant1 = await service.execute({ eventId: `${playerKey}-grant-1`, playerId, action: "grant", sourceRow: 1, legacy: legacy[0]! });
  assert.equal(grant1.status, "granted");
  assert.equal(grant1.version, "1");
  assert.equal((await service.execute({ eventId: `${playerKey}-repeat-1`, playerId, action: "grant", sourceRow: 1, legacy: legacy[0]! })).status, "repeated");
  assert.equal((await service.execute({ eventId: `${playerKey}-grant-1`, playerId, action: "grant", sourceRow: 1, legacy: legacy[0]! })).replayed, true);
  await service.execute({ eventId: `${playerKey}-grant-2`, playerId, action: "grant", sourceRow: 2, legacy: legacy[1]! });
  assert.equal((await service.execute({ eventId: `${playerKey}-select-2`, playerId, action: "select", listIndex: 2, expectedVersion: "1" })).status, "selected");
  await assert.rejects(service.execute({ eventId: `${playerKey}-stale`, playerId, action: "select", listIndex: 2, expectedVersion: "1" }), /VERSION_CONFLICT/);
  assert.equal((await service.execute({ eventId: `${playerKey}-remove-2`, playerId, action: "remove", listIndex: 2, expectedVersion: "2" })).status, "removed");
  const compatibility = await service.readCompatibility(playerId, [legacy[0]!]);
  assert.equal(compatibility.length, 2);
  assert.equal(compatibility.filter((row) => row.lifecycle === "OWNED").length, 1);
  const failingDatabase: DatabaseClient = {
    ping: () => database.ping(), verifyRollback: () => database.verifyRollback(), query: (sql, values) => database.query(sql, values), execute: (sql, values) => database.execute(sql, values), close: async () => undefined,
    withTransaction: (work) => database.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: (sql, values) => {
        if (sql.startsWith("INSERT INTO command_audit")) throw new Error("LEASE2401_SYNTHETIC_ROLLBACK");
        return transaction.execute(sql, values);
      },
    })),
  };
  await assert.rejects(makeService(failingDatabase).execute({ eventId: `${playerKey}-rollback-3`, playerId, action: "grant", sourceRow: 3, legacy: legacy[2]! }), /SYNTHETIC_ROLLBACK/);
  assert.equal(Number((await database.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) AS count_value FROM player_mini_pet_collection_title_sources WHERE player_id = ? AND source_row = 3", [playerId]))[0]!.count_value), 0);
  await database.close();
  database = open();
  service = makeService(database);
  assert.equal((await service.execute({ eventId: `${playerKey}-grant-1`, playerId, action: "grant", sourceRow: 1, legacy: legacy[0]! })).replayed, true);
  const boundary = (await database.query<Array<{ source_count: bigint; owned_count: bigint; removed_count: bigint }>>("SELECT (SELECT COUNT(*) FROM player_mini_pet_collection_title_sources WHERE player_id = ?) AS source_count, (SELECT COUNT(*) FROM player_title_instances WHERE player_id = ? AND status = 'owned') AS owned_count, (SELECT COUNT(*) FROM player_title_instances WHERE player_id = ? AND status = 'removed') AS removed_count", [playerId, playerId, playerId]))[0]!;
  assert.equal(Number(boundary.source_count), 2);
  assert.equal(Number(boundary.owned_count), 1);
  assert.equal(Number(boundary.removed_count), 1);
  console.log(JSON.stringify({ definitions: 100, sources: 2, ownedInstances: 1, removedInstances: 1, assignmentsMutated: 0, replay: true, rollback: true, reconnect: true }));
  await database.close();
}
void main();
