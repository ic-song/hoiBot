import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetExploreParticipationProvider } from "../src/pet/pet-explore-participation-provider.js";

const config = loadConfig();
if (!config.database.enabled || !/^hoibot_pet_explore_participation_lease2427$/i.test(config.database.name)) {
  throw new Error(`Blocked database: ${config.database.name}`);
}

let database = createDatabaseClient(config.database);
const provider = () => new PetExploreParticipationProvider(database);
const prefix = `lease2427-${Date.now()}`;
const players = [984721001, 984721002, 984721003];

try {
  await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1),(?,'active',1)", players);
  const manualRound = (await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',3)", [`${prefix}-manual`])).insertId;
  const autoRound = (await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',1)", [`${prefix}-auto`])).insertId;
  const autoTicket = await ensureItem("자동탐험권🌄", `${prefix}-auto-ticket`);
  const mazeTicket = await ensureItem("미궁 입장권🕋", `${prefix}-maze-ticket`);
  await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1),(?,?,2,1)", [players[1], autoTicket, players[0], mazeTicket]);

  const manualInput = {
    mode: "manual" as const, roundKey: `${prefix}-manual`, playerId: String(players[0]), destinationCode: "pet_enhancement_mine" as const,
    expectedRoundVersion: "3", expectedParticipationVersion: null, idempotencyKey: `${prefix}-manual-create`, reason: "Shadow 수동 참가 생성 검증", sourceCode: "iris" as const,
  };
  const created = await provider().reserve(manualInput);
  assert.deepEqual([created.status, created.version], ["created", "1"]);
  assert.equal((await provider().reserve(manualInput)).replayed, true);
  await assert.rejects(() => provider().reserve({ ...manualInput, destinationCode: "luck_mine" }), (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_PARTICIPATION_IDEMPOTENCY_PAYLOAD_MISMATCH");
  const changed = await provider().reserve({ ...manualInput, destinationCode: "belcar_maze", expectedParticipationVersion: "1", idempotencyKey: `${prefix}-manual-change` });
  assert.deepEqual([changed.status, changed.version, changed.checkedTicketQuantity], ["changed", "2", "2"]);
  const same = await provider().reserve({ ...manualInput, destinationCode: "belcar_maze", expectedParticipationVersion: "2", idempotencyKey: `${prefix}-manual-noop` });
  assert.deepEqual([same.status, same.detailCode], ["noop", "same_destination"]);

  const autoInput = {
    mode: "auto" as const, roundKey: `${prefix}-auto`, playerId: String(players[1]), destinationCode: "intimacy_mine" as const,
    expectedRoundVersion: "1", expectedParticipationVersion: null, idempotencyKey: `${prefix}-auto-create`, reason: "Shadow 자동 다음 round 생성 검증", sourceCode: "scheduler" as const,
  };
  const autoCreated = await provider().reserve(autoInput);
  assert.deepEqual([autoCreated.status, autoCreated.checkedTicketQuantity], ["created", "1"]);
  assert.equal((await provider().reserve({ ...autoInput, destinationCode: "luck_mine", idempotencyKey: `${prefix}-auto-existing` })).detailCode, "auto_existing");
  assert.equal((await provider().reserve({ ...autoInput, playerId: String(players[2]), idempotencyKey: `${prefix}-ticket-unavailable` })).detailCode, "ticket_unavailable");

  const before = await snapshot();
  await assert.rejects(
    () => new PetExploreParticipationProvider(failAudit(database)).reserve({ ...manualInput, destinationCode: "luck_mine", expectedParticipationVersion: "2", idempotencyKey: `${prefix}-rollback` }),
    /synthetic participation audit failure/,
  );
  assert.deepEqual(await snapshot(), before);
  assert.equal(await database.verifyRollback(), true);
  await database.close();
  database = createDatabaseClient(config.database);
  assert.equal((await provider().reserve(manualInput)).replayed, true);
  const state = await snapshot();
  assert.equal(state[0]?.ticketQuantity, "1");
  assert.equal(state[0]?.inventoryLedgerWrites, 0n);
  process.stdout.write(JSON.stringify({
    scenarios: ["manual-create", "manual-change", "manual-noop", "auto-create", "auto-existing-noop", "ticket-read-only", "exact-replay", "payload-mismatch-409", "rollback", "reconnect-replay"],
    manualRoundId: manualRound.toString(), autoRoundId: autoRound.toString(), state,
  }, (_key, value) => typeof value === "bigint" ? value.toString() : value) + "\n");

  async function ensureItem(displayName: string, code: string): Promise<bigint> {
    const existing = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE display_name=? AND active=TRUE ORDER BY id LIMIT 1", [displayName]))[0];
    if (existing !== undefined) return existing.id;
    return (await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES (?,?,'item',TRUE,TRUE,1)", [code, displayName])).insertId;
  }

  async function snapshot() {
    return database.query<Array<{ manualDestination: string; manualVersion: bigint; autoDestination: string; ticketQuantity: string; inventoryLedgerWrites: bigint; operations: bigint; changes: bigint; audits: bigint; outboxes: bigint }>>(
      `SELECT
        (SELECT destination_code FROM pet_explore_participations WHERE round_id=${manualRound.toString()} AND player_id=${players[0]}) manualDestination,
        (SELECT version FROM pet_explore_participations WHERE round_id=${manualRound.toString()} AND player_id=${players[0]}) manualVersion,
        (SELECT destination_code FROM pet_explore_participations WHERE round_id=${autoRound.toString()} AND player_id=${players[1]}) autoDestination,
        CAST((SELECT quantity FROM inventory_stacks WHERE player_id=${players[1]} AND item_id=${autoTicket.toString()}) AS CHAR) ticketQuantity,
        (SELECT COUNT(*) FROM inventory_ledger WHERE player_id IN (${players.join(",")})) inventoryLedgerWrites,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'pet_explore.participation.%') operations,
        (SELECT COUNT(*) FROM pet_explore_participation_changes) changes,
        (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'pet_explore.participation.%') audits,
        (SELECT COUNT(*) FROM outbox_messages WHERE message_type='pet_explore.participation') outboxes`,
    );
  }
} finally {
  await database.close();
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic participation audit failure");
        return transaction.execute(sql, values);
      },
    })),
  };
}
