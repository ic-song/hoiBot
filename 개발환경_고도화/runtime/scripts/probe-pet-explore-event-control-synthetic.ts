import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetExploreEventControlProvider } from "../src/pet/pet-explore-event-control-provider.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_explore_event_control_g7(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet explore event control probe blocked: ${config.database.name}`);
}
const database = createDatabaseClient(config.database);
const provider = new PetExploreEventControlProvider(database);
const restart = process.argv.includes("--verify-restart");
const prefix = process.env.PET_EXPLORE_EVENT_CONTROL_PROBE_ID ?? "pet-explore-event-control-g7-20260831-r1";
const players = [984720001, 984720002, 984720003];
const common = { operatorId: "984700002", reason: "합성 이벤트 제어 검증", sourceCode: "admin_api" as const };

try {
  if (!restart) {
    await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'active',1),(?,'active',1)", players);
    const round = await database.execute("INSERT INTO pet_explore_rounds(round_key,state_code) VALUES (?,'open')", [`${prefix}-round`]);
    await database.execute(
      "INSERT INTO pet_explore_participations(participation_key,round_id,player_id,destination_code,state_code) VALUES (?,?,?,'diamond_mine_event','active'),(?,?,?,'guild_raid_event','active'),(?,?,?,'regular_mine','active')",
      [`${prefix}-diamond`, round.insertId, players[0], `${prefix}-guild`, round.insertId, players[1], `${prefix}-regular`, round.insertId, players[2]],
    );
    await provider.setActive({ ...common, eventCode: "diamond_mine", active: true, expectedVersion: "1", idempotencyKey: `${prefix}-diamond-on` });
    const diamondOffInput = { ...common, eventCode: "diamond_mine" as const, active: false, expectedVersion: "2", idempotencyKey: `${prefix}-diamond-off` };
    const diamondOff = await provider.setActive(diamondOffInput);
    assert.equal(diamondOff.relocatedParticipantCount, "1");
    assert.equal((await provider.setActive(diamondOffInput)).replayed, true);
    await assert.rejects(
      () => provider.setActive({ ...diamondOffInput, active: true }),
      (error: unknown) => (error as { code?: string }).code === "PET_EXPLORE_EVENT_IDEMPOTENCY_PAYLOAD_MISMATCH",
    );
    await provider.setActive({ ...common, eventCode: "guild_raid", active: true, expectedVersion: "3", idempotencyKey: `${prefix}-guild-on` });
    const guildOff = await provider.setActive({ ...common, eventCode: "guild_raid", active: false, expectedVersion: "4", idempotencyKey: `${prefix}-guild-off` });
    assert.equal(guildOff.relocatedParticipantCount, "1");

    const beforeRollback = await snapshot();
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
    assert.deepEqual(await snapshot(), beforeRollback);
    assert.equal(await database.verifyRollback(), true);
    assert.deepEqual(beforeRollback[0], {
      version: 5n,
      eventMine: 0,
      guildRaid: 0,
      regularParticipants: 3n,
      operations: 4n,
      changes: 4n,
      audits: 4n,
      outboxes: 4n,
    });
    process.stdout.write(JSON.stringify({
      mode: "synthetic-shadow",
      migrationCount: 392,
      scenarios: ["migration160-carry-forward", "semantic-event-identity", "cas", "on", "off-relocation", "exact-replay", "payload-mismatch", "rollback", "audit-outbox", "restart-ready"],
      version: "5",
      relocatedParticipants: 2,
      participantDestination: "regular_mine",
      operations: 4,
      schemaOwnership: "canonical-round-participation-base",
      settlementWrites: 0,
      rewardWrites: 0,
      rngCalls: 0,
      operationalDataTouched: false,
    }) + "\n");
  } else {
    const before = await snapshot();
    const replay = await provider.setActive({
      ...common,
      eventCode: "diamond_mine",
      active: false,
      expectedVersion: "2",
      idempotencyKey: `${prefix}-diamond-off`,
    });
    assert.equal(replay.replayed, true);
    assert.deepEqual(await snapshot(), before);
    process.stdout.write(JSON.stringify({
      mode: "verify-restart",
      version: replay.version,
      replayPreserved: true,
      additionalMutation: false,
      operationalDataTouched: false,
    }) + "\n");
  }
} finally {
  await database.close();
}

async function snapshot() {
  return database.query<Array<{ version: bigint; eventMine: number; guildRaid: number; regularParticipants: bigint; operations: bigint; changes: bigint; audits: bigint; outboxes: bigint }>>(
    `SELECT config.version,config.event_mine_active eventMine,config.guild_raid_active guildRaid,
      (SELECT COUNT(*) FROM pet_explore_participations WHERE destination_code='regular_mine' AND state_code='active') regularParticipants,
      (SELECT COUNT(*) FROM operations WHERE idempotency_scope='admin.pet_explore_event_control:984700002') operations,
      (SELECT COUNT(*) FROM pet_explore_event_control_changes) changes,
      (SELECT COUNT(*) FROM command_audit WHERE action_code='pet_explore.event_control') audits,
      (SELECT COUNT(*) FROM outbox_messages WHERE message_type='pet_explore.event_control') outboxes
     FROM pet_explore_runtime_config config WHERE config.config_id=1`,
  );
}

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
