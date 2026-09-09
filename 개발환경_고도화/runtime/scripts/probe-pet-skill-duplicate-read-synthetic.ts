import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetSkillDuplicateReadService } from "../src/pet/pet-skill-duplicate-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_skill_duplicate_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pet skill duplicate probe blocked: ${config.database.name}`);
const base = process.env.PET_SKILL_DUPLICATE_PROBE_EVENT_ID ?? "pet-skill-duplicate-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new PetSkillDuplicateReadService(database);

async function event(id: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pet-skill-duplicate-room','duplicate-viewer','message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return { ping: () => inner.ping(), query: (sql, p) => inner.query(sql, p), execute: (sql, p) => inner.execute(sql, p), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, p) => transaction.query(sql, p),
      execute: async (sql, p) => { if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet skill duplicate audit failure"); return transaction.execute(sql, p); },
    })),
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ ops: bigint; outboxes: bigint; groups: bigint; members: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_duplicate_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM pet_skill_compatibility_groups WHERE active=TRUE) groups,(SELECT COUNT(*) FROM pet_skill_compatibility_members) members", [success, success]);
    await service.read({ eventId: success, externalUserId: "duplicate-viewer", destinationId: "synthetic-pet-skill-duplicate-room" });
    const after = await database.query<typeof before>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_duplicate_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM pet_skill_compatibility_groups WHERE active=TRUE) groups,(SELECT COUNT(*) FROM pet_skill_compatibility_members) members", [success, success]);
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { ops: 1n, outboxes: 1n, groups: 3n, members: 6n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, groups: 3, members: 6, additionalMutation: false }) + "\n");
  } else {
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_SKILL_DUPLICATE_READ'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const result = await service.read({ eventId: success, externalUserId: "duplicate-viewer", destinationId: "synthetic-pet-skill-duplicate-room" });
    assert.equal(result.groupCount, 3);
    assert.equal(result.memberCount, 6);
    assert.equal(result.reply, "📙 중복 장착 불가 목록 📙\n\n- 십원📙 ↔ 구원📙\n- 헌터📙 ↔ 만렙헌터📙\n- 건물주📙 ↔ 하느님 위에 갓물주📙");
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "duplicate-viewer", destinationId: "synthetic-pet-skill-duplicate-room" }), result);
    const rollback = `${base}-rollback`; await event(rollback);
    await assert.rejects(() => new PetSkillDuplicateReadService(failAudit(database)).read({ eventId: rollback, externalUserId: "duplicate-viewer", destinationId: "synthetic-pet-skill-duplicate-room" }), /synthetic pet skill duplicate audit failure/);
    const effects = await database.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint; groups: bigint; members: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT COUNT(*) FROM pet_skill_compatibility_groups WHERE active=TRUE) groups,(SELECT COUNT(*) FROM pet_skill_compatibility_members) members", [success, success, rollback]);
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n, groups: 3n, members: 6n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "seed-parity", "exact-format", "stable-order", "replay", "rollback", "no-domain-mutation"], effects: { operation: 1, outbox: 1, rollbackOperation: 0 }, groups: 3, members: 6 }) + "\n");
  }
} finally { await database.close(); }
