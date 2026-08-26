import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetIntimacyRankReadService } from "../src/pet/pet-intimacy-rank-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_intimacy_rank(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet intimacy rank probe blocked: ${config.database.name}`);
}
const base = process.env.PET_INTIMACY_RANK_PROBE_EVENT_ID ?? "pet-intimacy-rank-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new PetIntimacyRankReadService(database);

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pet-intimacy-rank-room','rank-viewer','message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id],
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters),
    execute: (sql, parameters) => inner.execute(sql, parameters), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet intimacy rank audit failure");
        return transaction.execute(sql, parameters);
      },
    })),
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ ops: bigint; outboxes: bigint; version: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.intimacy_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT version FROM pet_intimacy_ranking_state WHERE state_key='current') version",
      [success, success],
    );
    await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-intimacy-rank-room" });
    const after = await database.query<typeof before>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.intimacy_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT version FROM pet_intimacy_ranking_state WHERE state_key='current') version",
      [success, success],
    );
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { ops: 1n, outboxes: 1n, version: 1n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, stateVersion: 1, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    for (let index = 1; index <= 101; index += 1) {
      const id = 986000000 + index;
      const level = index === 1 ? "9007199254740993" : String(200 - index);
      const fullness = index === 1 ? "1550" : String(10000 - index);
      await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, `친밀유저${String(index).padStart(3, "0")}`]);
      await database.execute("INSERT INTO player_pets(id,player_id,display_name,image_value,experience) VALUES (?,?,?,'🐶',0)", [id, id, `친밀펫${index}`]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🌱',?)", [id, index]);
      await database.execute("INSERT INTO player_pet_intimacy(player_pet_id,intimacy_level,progress,charm) VALUES (?,?,?,?)", [id, level, index % 1000, fullness]);
    }
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_INTIMACY_RANK_READ'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const result = await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-intimacy-rank-room" });
    assert.equal(result.rowCount, 100);
    assert.match(result.data, /1등 \[🍼친밀유저001\] : Lv\.9007199254740993 \( 1\.6k🍼 \)/);
    assert.doesNotMatch(result.data, /친밀유저101/);
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-intimacy-rank-room" }), result);
    assert.equal((await database.query<Array<{ top_player_id: bigint; version: bigint }>>("SELECT top_player_id,version FROM pet_intimacy_ranking_state WHERE state_key='current'"))[0]!.top_player_id, 986000001n);

    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(
      () => new PetIntimacyRankReadService(failAudit(database)).read({ eventId: rollback, externalUserId: "rank-viewer", destinationId: "synthetic-pet-intimacy-rank-room" }),
      /synthetic pet intimacy rank audit failure/,
    );
    const effects = await database.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint; version: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT version FROM pet_intimacy_ranking_state WHERE state_key='current') version",
      [success, success, rollback],
    );
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n, version: 1n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "normalized-intimacy", "level-fullness-name-order", "bigint", "top-state", "limit100", "allsee", "replay", "rollback"], effects: { rows: 100, operation: 1, outbox: 1, rollbackOperation: 0, stateVersion: 1 }, operationalDataTouched: false }) + "\n");
  }
} finally {
  await database.close();
}
