import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetCharmRankReadService } from "../src/pet/pet-charm-rank-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_ranking_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pet charm rank probe blocked: ${config.database.name}`);
}
const base = process.env.PET_CHARM_RANK_PROBE_EVENT_ID ?? "pet-charm-rank-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new PetCharmRankReadService(database);

async function event(id: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pet-charm-rank-room','rank-viewer','message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id]
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters),
    execute: (sql, parameters) => inner.execute(sql, parameters), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet charm rank audit failure");
        return transaction.execute(sql, parameters);
      }
    }))
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ ops: bigint; outboxes: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.charm_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes",
      [success, success]
    );
    await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-charm-rank-room" });
    const after = await database.query<typeof before>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.charm_rank_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes",
      [success, success]
    );
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { ops: 1n, outboxes: 1n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    const title = await database.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES ('PET-RANK-SYNTHETIC','[용감한]','pet',TRUE)");
    for (let index = 1; index <= 12; index += 1) {
      const id = 985000000 + index;
      const experience = index === 1 ? "9007199254740993" : index === 2 ? "9007199254740992" : index === 12 ? "5" : String(100 - index);
      await database.execute("INSERT INTO players(id,status) VALUES (?,'active')", [id]);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (?,?)", [id, `매력유저${index}`]);
      await database.execute("INSERT INTO player_pets(id,player_id,display_name,image_value,experience) VALUES (?,?,?,'🐶',?)", [id, id, `매력펫${index}`, experience]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,'🌱',?)", [id, index]);
      if (index === 1) await database.execute("INSERT INTO pet_titles(player_pet_id,title_id,acquired_at,equipped) VALUES (?,?,UTC_TIMESTAMP(3),TRUE)", [id, title.insertId]);
    }
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_CHARM_RANK_READ'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const result = await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-charm-rank-room" });
    assert.equal(result.rowCount, 11);
    assert.match(result.data, /🐶\[용감한\] 매력펫1 💕 9,007,199,254,740,993/);
    assert.ok(result.data.indexOf("매력펫1") < result.data.indexOf("매력펫2"));
    assert.doesNotMatch(result.data, /매력펫12/);
    assert.equal((result.data.match(/\u200b/g) ?? []).length, 500);
    assert.ok(result.data.indexOf("매력펫10") < result.data.indexOf("\u200b"));
    assert.ok(result.data.indexOf("\u200b") < result.data.indexOf("매력펫11"));
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "rank-viewer", destinationId: "synthetic-pet-charm-rank-room" }), result);

    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(
      () => new PetCharmRankReadService(failAudit(database)).read({ eventId: rollback, externalUserId: "rank-viewer", destinationId: "synthetic-pet-charm-rank-room" }),
      /synthetic pet charm rank audit failure/
    );
    const effects = await database.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps",
      [success, success, rollback]
    );
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "threshold", "bigint-order", "title", "allsee", "replay", "rollback"], effects: { rows: 11, operation: 1, outbox: 1, rollbackOperation: 0 }, operationalDataTouched: false }) + "\n");
  }
} finally {
  await database.close();
}
