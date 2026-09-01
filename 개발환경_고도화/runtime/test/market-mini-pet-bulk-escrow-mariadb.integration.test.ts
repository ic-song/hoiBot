import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { releaseMiniPetEscrow, reserveMiniPetEscrow, transferMiniPetEscrow } from "../src/market/market-mini-pet-bulk-escrow.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("market mini pet bulk escrow MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;

  before(() => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5_000 });
  });

  after(async () => { if (database) await database.close(); });

  it("reserves, transfers, records and releases multiple stable mini pets", async () => {
    const suffix = Date.now().toString();
    const seller = (await database.execute("INSERT INTO players(status,version) VALUES ('active',1)")).insertId;
    const buyer = (await database.execute("INSERT INTO players(status,version) VALUES ('active',1)")).insertId;
    const definition = (await database.execute("INSERT INTO mini_pet_definitions(code,display_name,grade_code,active) VALUES (?,?,'S',TRUE)", [`bulk-escrow-${suffix}`, `합성 미니펫 ${suffix}`])).insertId;
    const first = (await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,equipped,bag_sequence,version) VALUES (?,?,0,FALSE,1,1)", [seller, definition])).insertId;
    const second = (await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,equipped,bag_sequence,version) VALUES (?,?,0,FALSE,2,1)", [seller, definition])).insertId;
    const listing = (await database.execute("INSERT INTO market_listings(seller_player_id,asset_type_code,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'mini_pet',2,'point',1000,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", [seller])).insertId;
    const operation = (await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,source_code,status) VALUES (UUID(),'test.market.mini_pet.bulk',?,'system','test','processing')", [`transfer-${suffix}`])).insertId;
    await database.withTransaction((transaction) => reserveMiniPetEscrow(transaction, { listingId: listing, playerId: seller, assets: [{ ownedMiniPetId: first, version: 1n }, { ownedMiniPetId: second, version: 1n }] }));
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_reservations WHERE listing_id=?", [listing]))[0]!.count, 2n);
    await database.withTransaction((transaction) => transferMiniPetEscrow(transaction, { operationId: operation, listingId: listing, sellerPlayerId: seller, buyerPlayerId: buyer, quantity: 2n }));
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM owned_mini_pets WHERE player_id=?", [buyer]))[0]!.count, 2n);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_transfer_ledger WHERE operation_id=?", [operation]))[0]!.count, 2n);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_reservations WHERE listing_id=?", [listing]))[0]!.count, 0n);

    const third = (await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,equipped,bag_sequence,version) VALUES (?,?,0,FALSE,1,1)", [seller, definition])).insertId;
    const fourth = (await database.execute("INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,progress,equipped,bag_sequence,version) VALUES (?,?,0,FALSE,2,1)", [seller, definition])).insertId;
    const cancelListing = (await database.execute("INSERT INTO market_listings(seller_player_id,asset_type_code,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'mini_pet',2,'point',2000,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY))", [seller])).insertId;
    await database.withTransaction((transaction) => reserveMiniPetEscrow(transaction, { listingId: cancelListing, playerId: seller, assets: [{ ownedMiniPetId: third, version: 1n }, { ownedMiniPetId: fourth, version: 1n }] }));
    await database.withTransaction((transaction) => releaseMiniPetEscrow(transaction, { listingId: cancelListing, playerId: seller, quantity: 2n }));
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM market_mini_pet_reservations WHERE listing_id=?", [cancelListing]))[0]!.count, 0n);
    assert.equal((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM owned_mini_pets WHERE player_id=?", [seller]))[0]!.count, 2n);
    await database.ping();
  });
});
