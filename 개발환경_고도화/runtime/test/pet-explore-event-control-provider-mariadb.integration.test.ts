import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetExploreEventControlProvider } from "../src/pet/pet-explore-event-control-provider.js";

const integration = process.env.RUN_MARIADB_INTEGRATION === "true" ? describe : describe.skip;

integration("pet explore event control provider MariaDB integration", () => {
  let database: DatabaseClient;
  const prefix = `pet-explore-event-control-${Date.now()}`;
  const players = [984710001, 984710002, 984710003];

  before(async () => {
    database = createDatabaseClient(loadConfig().database);
    await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1),(?,'active',1)", players);
    const round = await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code) VALUES (?,'open')", [`${prefix}-round`]);
    await database.execute(
      "INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code) VALUES (?,?,?,'diamond_mine_event','active'),(?,?,?,'guild_raid_event','active'),(?,?,?,'regular_mine','active')",
      [`${prefix}-diamond`, round.insertId, players[0], `${prefix}-guild`, round.insertId, players[1], `${prefix}-regular`, round.insertId, players[2]],
    );
  });

  after(async () => database.close());

  it("preserves CAS, exact replay, payload mismatch, relocation, rollback and atomic evidence", async () => {
    const provider = new PetExploreEventControlProvider(database);
    const common = { operatorId: "984700001", reason: "Maria 이벤트 제어 검증", sourceCode: "admin_api" as const };
    const diamondOn = await provider.setActive({ ...common, eventCode: "diamond_mine", active: true, expectedVersion: "1", idempotencyKey: `${prefix}-diamond-on` });
    assert.deepEqual([diamondOn.status, diamondOn.version, diamondOn.relocatedParticipantCount], ["changed", "2", "0"]);
    const diamondOffInput = { ...common, eventCode: "diamond_mine" as const, active: false, expectedVersion: "2", idempotencyKey: `${prefix}-diamond-off` };
    const diamondOff = await provider.setActive(diamondOffInput);
    assert.deepEqual([diamondOff.version, diamondOff.relocatedParticipantCount], ["3", "1"]);
    assert.equal((await provider.setActive(diamondOffInput)).replayed, true);
    await assert.rejects(
      () => provider.setActive({ ...diamondOffInput, active: true }),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_EVENT_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
    await assert.rejects(
      () => provider.setActive({ ...common, eventCode: "guild_raid", active: true, expectedVersion: "2", idempotencyKey: `${prefix}-stale` }),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_EVENT_VERSION_CONFLICT",
    );
    const guildOn = await provider.setActive({ ...common, eventCode: "guild_raid", active: true, expectedVersion: "3", idempotencyKey: `${prefix}-guild-on` });
    const guildOff = await provider.setActive({ ...common, eventCode: "guild_raid", active: false, expectedVersion: "4", idempotencyKey: `${prefix}-guild-off` });
    assert.deepEqual([guildOn.version, guildOff.version, guildOff.relocatedParticipantCount], ["4", "5", "1"]);

    const before = await snapshot();
    await assert.rejects(
      () => new PetExploreEventControlProvider(failAudit(database)).setActive({
        ...common,
        eventCode: "diamond_mine",
        active: true,
        expectedVersion: "5",
        idempotencyKey: `${prefix}-rollback`,
      }),
      /synthetic pet explore event audit failure/,
    );
    assert.deepEqual(await snapshot(), before);
    assert.equal(await database.verifyRollback(), true);
  });

  async function snapshot() {
    return database.query<Array<{ version: bigint; eventMine: number; guildRaid: number; regularParticipants: bigint; operations: bigint; changes: bigint; audits: bigint; outboxes: bigint }>>(
      `SELECT config.version,config.event_mine_active eventMine,config.guild_raid_active guildRaid,
        (SELECT COUNT(*) FROM pet_explore_participations WHERE destination_code='regular_mine' AND state_code='active') regularParticipants,
        (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.pet_explore_event_control:984700001') operations,
        (SELECT COUNT(*) FROM pet_explore_event_control_changes) changes,
        (SELECT COUNT(*) FROM command_audit WHERE action_code='pet_explore.event_control') audits,
        (SELECT COUNT(*) FROM outbox_messages WHERE message_type='pet_explore.event_control') outboxes
       FROM pet_explore_runtime_config config WHERE config.config_id=1`,
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
          if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet explore event audit failure");
          return transaction.execute(sql, values);
        },
      })),
  };
}
