import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetExploreParticipationProvider } from "../src/pet/pet-explore-participation-provider.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("pet explore participation provider MariaDB integration", () => {
  let database: DatabaseClient;
  const prefix = `pet-explore-participation-${Date.now()}`;
  const players = [984720001, 984720002, 984720003];
  let roundOne = 0n;
  let roundTwo = 0n;
  let autoTicketId = 0n;
  let mazeTicketId = 0n;

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1),(?,'active',1)", players);
    roundOne = (await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',4)", [`${prefix}-manual`])).insertId;
    roundTwo = (await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code,version) VALUES (?,'open',1)", [`${prefix}-auto`])).insertId;
    autoTicketId = await ensureItem("자동탐험권🌄", `${prefix}-auto-ticket`);
    mazeTicketId = await ensureItem("미궁 입장권🕋", `${prefix}-maze-ticket`);
    await database.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1),(?,?,2,1)", [players[1], autoTicketId, players[0], mazeTicketId]);
  });

  after(async () => database.close());

  it("preserves manual/auto CAS, exact replay, noop, ticket read-only, rollback and reconnect evidence", async () => {
    const provider = new PetExploreParticipationProvider(database);
    const manualInput = {
      mode: "manual" as const, roundKey: `${prefix}-manual`, playerId: String(players[0]), destinationCode: "pet_enhancement_mine" as const,
      expectedRoundVersion: "4", expectedParticipationVersion: null, idempotencyKey: `${prefix}-manual-create`, reason: "Maria 수동 참가 생성 검증", sourceCode: "iris" as const,
    };
    const created = await provider.reserve(manualInput);
    assert.deepEqual([created.status, created.version, created.ticketAvailable], ["created", "1", true]);
    assert.equal((await provider.reserve(manualInput)).replayed, true);
    await assert.rejects(
      () => provider.reserve({ ...manualInput, destinationCode: "intimacy_mine" }),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_PARTICIPATION_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
    const changed = await provider.reserve({
      ...manualInput, destinationCode: "belcar_maze", expectedParticipationVersion: "1", idempotencyKey: `${prefix}-manual-change`, reason: "Maria 수동 참가 변경 검증",
    });
    assert.deepEqual([changed.status, changed.previousVersion, changed.version, changed.checkedTicketQuantity], ["changed", "1", "2", "2"]);
    const same = await provider.reserve({
      ...manualInput, destinationCode: "belcar_maze", expectedParticipationVersion: "2", idempotencyKey: `${prefix}-manual-noop`, reason: "Maria 동일 참가 noop 검증",
    });
    assert.deepEqual([same.status, same.detailCode, same.version], ["noop", "same_destination", "2"]);

    const autoInput = {
      mode: "auto" as const, roundKey: `${prefix}-auto`, playerId: String(players[1]), destinationCode: "intimacy_mine" as const,
      expectedRoundVersion: "1", expectedParticipationVersion: null, idempotencyKey: `${prefix}-auto-create`, reason: "Maria 자동 다음 round 생성 검증", sourceCode: "scheduler" as const,
    };
    const autoCreated = await provider.reserve(autoInput);
    assert.deepEqual([autoCreated.status, autoCreated.checkedTicketQuantity, autoCreated.version], ["created", "1", "1"]);
    const autoExisting = await provider.reserve({ ...autoInput, destinationCode: "luck_mine", idempotencyKey: `${prefix}-auto-existing` });
    assert.deepEqual([autoExisting.status, autoExisting.detailCode, autoExisting.destinationCode], ["noop", "auto_existing", "intimacy_mine"]);
    const unavailable = await provider.reserve({ ...autoInput, playerId: String(players[2]), idempotencyKey: `${prefix}-auto-unavailable` });
    assert.deepEqual([unavailable.status, unavailable.detailCode, unavailable.participationId], ["noop", "ticket_unavailable", null]);
    await assert.rejects(
      () => provider.reserve({ ...manualInput, expectedRoundVersion: "3", expectedParticipationVersion: "2", idempotencyKey: `${prefix}-stale` }),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_ROUND_VERSION_CONFLICT",
    );

    const before = await snapshot();
    await assert.rejects(
      () => new PetExploreParticipationProvider(failAudit(database)).reserve({
        ...manualInput, destinationCode: "luck_mine", expectedParticipationVersion: "2", idempotencyKey: `${prefix}-rollback`, reason: "Maria 참가 rollback 검증",
      }),
      /synthetic pet explore participation audit failure/,
    );
    assert.deepEqual(await snapshot(), before);
    assert.equal(await database.verifyRollback(), true);
    await database.close();
    database = createDatabaseClient(loadConfig().database);
    assert.equal((await new PetExploreParticipationProvider(database).reserve(manualInput)).replayed, true);
  });

  async function ensureItem(displayName: string, code: string): Promise<bigint> {
    const existing = (await database.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE display_name=? AND active=TRUE ORDER BY id LIMIT 1", [displayName]))[0];
    if (existing !== undefined) return existing.id;
    return (await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,active,version) VALUES (?,?,'item',TRUE,TRUE,1)", [code, displayName])).insertId;
  }

  async function snapshot() {
    return database.query<Array<{ manualDestination: string; manualVersion: bigint; autoDestination: string; inventoryQuantity: string; ledgerWrites: bigint; operations: bigint; changes: bigint; audits: bigint; outboxes: bigint }>>(
      `SELECT
        (SELECT destination_code FROM pet_explore_participations WHERE round_id=${roundOne.toString()} AND player_id=${players[0]}) manualDestination,
        (SELECT version FROM pet_explore_participations WHERE round_id=${roundOne.toString()} AND player_id=${players[0]}) manualVersion,
        (SELECT destination_code FROM pet_explore_participations WHERE round_id=${roundTwo.toString()} AND player_id=${players[1]}) autoDestination,
        CAST((SELECT quantity FROM inventory_stacks WHERE player_id=${players[1]} AND item_id=${autoTicketId.toString()}) AS CHAR) inventoryQuantity,
        (SELECT COUNT(*) FROM inventory_ledger WHERE player_id IN (${players.join(",")})) ledgerWrites,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope LIKE 'pet_explore.participation.%') operations,
        (SELECT COUNT(*) FROM pet_explore_participation_changes) changes,
        (SELECT COUNT(*) FROM command_audit WHERE action_code LIKE 'pet_explore.participation.%') audits,
        (SELECT COUNT(*) FROM outbox_messages WHERE message_type='pet_explore.participation') outboxes`,
    );
  }
});

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, values) => inner.query(sql, values),
    execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) =>
      inner.withTransaction((transaction) => work({
        query: (sql, values) => transaction.query(sql, values),
        execute: async (sql, values) => {
          if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet explore participation audit failure");
          return transaction.execute(sql, values);
        },
      })),
  };
}
