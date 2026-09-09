import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetUpgradeRankReadService } from "../src/pet/pet-upgrade-rank-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_upgrade_rank(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet upgrade rank probe blocked: ${config.database.name}`);
}
const base = process.env.PET_UPGRADE_RANK_PROBE_EVENT_ID ?? "pet-upgrade-rank-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new PetUpgradeRankReadService(database);

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pet-upgrade-rank-room','rank-viewer','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id]
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, parameters) => inner.query(sql, parameters),
    execute: (sql, parameters) => inner.execute(sql, parameters),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet upgrade rank audit failure");
        return transaction.execute(sql, parameters);
      }
    }))
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ ops: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.upgrade_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes",
      [success, success]
    );
    await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-upgrade-rank-room" });
    const after = await database.query<Array<{ ops: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.upgrade_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes",
      [success, success]
    );
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { ops: 1n, outboxes: 1n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    for (let index = 1; index <= 12; index += 1) {
      const id = 984000000 + index;
      const level = index === 1 ? "9007199254740993" : index === 2 ? "9007199254740992" : index <= 4 ? "100" : String(100 - index);
      const updatedAt = index === 3 ? "2026-08-27 01:00:00.000" : index === 4 ? "2026-08-27 02:00:00.000" : `2026-08-27 03:${String(index).padStart(2, "0")}:00.000`;
      await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, `강화유저${index}`]);
      await database.execute("INSERT INTO player_pets(id,player_id,display_name,enhancement_level,enhancement_updated_at) VALUES (?,?, '합성펫',?,?)", [id, id, level, updatedAt]);
      if (index !== 12) {
        await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🌱',?)", [id, index]);
      }
    }
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_UPGRADE_RANK_READ'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const result = await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-upgrade-rank-room" });
    assert.equal(result.rowCount, 12);
    assert.ok(result.data.indexOf("강화유저1") < result.data.indexOf("강화유저2"));
    assert.ok(result.data.indexOf("강화유저3") < result.data.indexOf("강화유저4"));
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(result.data.indexOf("강화유저10") < result.data.indexOf("\u200b"));
    assert.ok(result.data.indexOf("\u200b") < result.data.indexOf("강화유저11"));
    const replay = await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-upgrade-rank-room" });
    assert.deepEqual(replay, result);

    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(
      () => new PetUpgradeRankReadService(failAudit(database)).read({ eventId: rollback, externalUserId: "rank-viewer", destinationId: "synthetic-pet-upgrade-rank-room" }),
      /synthetic pet upgrade rank audit failure/
    );
    const effects = await database.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps",
      [success, success, rollback]
    );
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "bigint-order", "time-tie", "allsee", "replay", "rollback"], effects: { rows: 12, operation: 1, outbox: 1, rollbackOperation: 0 }, operationalDataTouched: false }) + "\n");
  }
} finally {
  await database.close();
}
