import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetExploreSettlementProvider } from "../src/pet/pet-explore-settlement-provider.js";
import { settlementPlan } from "./fixtures/pet-explore-settlement-provider.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;
integration("pet explore settlement provider MariaDB integration", () => {
  let db: DatabaseClient; const prefix = `pet-explore-settlement-${Date.now()}`; const players = [984730001, 984730002, 984730003, 984730004] as const;
  before(async () => { db = createDatabaseClient(loadConfig().database); await db.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1),(?,'active',1),(?,'active',1)", players); await seedItem("ITEM-PET-DUNGEON-TICKET", "펫던전 입장권🌋"); await seedItem("ITEM-AUTO-EXPLORE-TICKET", "자동탐험권🌄"); await seedItem("ITEM-PET-FOOD", "펫먹이🍼"); });
  after(async () => db.close());

  it("settles once with ticket/reward/record/next-auto and rolls everything back on failure", async () => {
    const current = (await db.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',3)", [`${prefix}-current`])).insertId;
    const next = (await db.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',1)", [`${prefix}-next`])).insertId;
    const part = (await db.execute("INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code,version) VALUES (?,?,?,'jeondor_dungeon','active',1)", [`${prefix}-part`, current, players[0]])).insertId;
    await stack(players[0], "ITEM-PET-DUNGEON-TICKET", 2); await stack(players[1], "ITEM-AUTO-EXPLORE-TICKET", 1);
    const input = {
      roundKey: `${prefix}-current`, expectedRoundVersion: "3", source: "scheduler" as const, actorId: String(players[3]), idempotencyKey: `${prefix}-settle`, policyHash: "a".repeat(64), reason: "Maria round 정산 원자성 검증", destinationId: "internal",
      plans: [settlementPlan(part.toString(), { ticketPolicy: "consume_or_regular_fallback", ticketItemCode: "ITEM-PET-DUNGEON-TICKET", fallbackDestinations: ["pet_enhancement_mine", "intimacy_mine", "luck_mine"] })],
      nextAutoReservations: [{ mode: "auto" as const, roundKey: `${prefix}-next`, playerId: String(players[1]), destinationCode: "intimacy_mine" as const, expectedRoundVersion: "1", expectedParticipationVersion: null, idempotencyKey: `${prefix}-next-auto`, reason: "정산 후 자동 다음 round 참가", sourceCode: "scheduler" as const }],
    };
    const settled = await new PetExploreSettlementProvider(db).settle(input);
    assert.deepEqual([settled.status, settled.participantCount, settled.nextAutoResults.length, settled.participants[0]?.ticketConsumed], ["settled", "1", 1, true]);
    assert.equal((await new PetExploreSettlementProvider(db).settle(input)).replayed, true);
    await assert.rejects(() => new PetExploreSettlementProvider(db).settle({ ...input, policyHash: "b".repeat(64) }), (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_SETTLEMENT_IDEMPOTENCY_PAYLOAD_MISMATCH");
    const state = (await db.query<Array<{ ticket: string; autoTicket: string; food: string; ticketLedger: bigint; nextCount: bigint; recordAttempts: bigint; roundState: string }>>(`SELECT CAST((SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${players[0]} AND item.code='ITEM-PET-DUNGEON-TICKET') AS CHAR) ticket,CAST((SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${players[1]} AND item.code='ITEM-AUTO-EXPLORE-TICKET') AS CHAR) autoTicket,CAST((SELECT quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=${players[0]} AND item.code='ITEM-PET-FOOD') AS CHAR) food,(SELECT COUNT(*) FROM inventory_ledger ledger JOIN item_definitions item ON item.id=ledger.item_id WHERE ledger.player_id=${players[0]} AND item.code='ITEM-PET-DUNGEON-TICKET') ticketLedger,(SELECT COUNT(*) FROM pet_explore_participations WHERE round_id=${next.toString()} AND player_id=${players[1]}) nextCount,(SELECT attempts FROM pet_explore_player_records WHERE player_id=${players[0]}) recordAttempts,(SELECT state_code FROM pet_explore_rounds WHERE id=${current.toString()}) roundState`))[0]!;
    assert.deepEqual(state, { ticket: "1", autoTicket: "1", food: "2", ticketLedger: 1n, nextCount: 1n, recordAttempts: 1n, roundState: "closed" });

    const rollbackRound = (await db.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',1)", [`${prefix}-rollback`])).insertId;
    const rollbackPart = (await db.execute("INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code,version) VALUES (?,?,?,'pet_enhancement_mine','active',1)", [`${prefix}-rollback-part`, rollbackRound, players[2]])).insertId;
    const before = await snapshot(rollbackRound, players[2]);
    await assert.rejects(() => new PetExploreSettlementProvider(failAudit(db)).settle({ ...input, roundKey: `${prefix}-rollback`, expectedRoundVersion: "1", idempotencyKey: `${prefix}-rollback-op`, plans: [settlementPlan(rollbackPart.toString())], nextAutoReservations: [] }), /synthetic settlement audit failure/);
    assert.deepEqual(await snapshot(rollbackRound, players[2]), before); assert.equal(await db.verifyRollback(), true);
    await db.close(); db = createDatabaseClient(loadConfig().database); assert.equal((await new PetExploreSettlementProvider(db).settle(input)).replayed, true);
  });

  async function seedItem(code: string, name: string) { await db.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES (?,?,'item',TRUE,TRUE,1) ON DUPLICATE KEY UPDATE code=VALUES(code)", [code, name]); await db.execute("INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled) VALUES (?,'STACK',?,TRUE,JSON_OBJECT(),TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE", [code, name]); }
  async function stack(player: number, code: string, quantity: number) { await db.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) SELECT ?,id,?,1 FROM item_definitions WHERE code=? ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),version=inventory_stacks.version+1", [player, quantity, code]); }
  async function snapshot(round: bigint, player: number) { return db.query("SELECT (SELECT state_code FROM pet_explore_rounds WHERE id=?) roundState,(SELECT state_code FROM pet_explore_participations WHERE round_id=? AND player_id=?) participationState,(SELECT COUNT(*) FROM pet_explore_settlements WHERE round_id=?) settlements,(SELECT COUNT(*) FROM pet_explore_player_records WHERE player_id=?) records", [round, round, player, round, player]); }
});
function failAudit(inner: DatabaseClient): DatabaseClient { return { ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values), verifyRollback: () => inner.verifyRollback(), close: async () => undefined, withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({ query: (sql, values) => transaction.query(sql, values), execute: async (sql, values) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic settlement audit failure"); return transaction.execute(sql, values); } })) }; }
