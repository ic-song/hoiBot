import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PetSkillReadService } from "../src/pet/pet-skill-read-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pet_skill_read(?:_[a-z0-9_]+)?$/i.test(config.database.name)) throw new Error(`Synthetic pet skill read probe blocked: ${config.database.name}`);
const base = process.env.PET_SKILL_READ_PROBE_EVENT_ID ?? "pet-skill-read-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const database = createDatabaseClient(config.database);
const service = new PetSkillReadService(database);

async function event(id: string): Promise<void> {
  await database.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pet-skill-room','skill-viewer','message','incoming',REPEAT('4',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)", [id, id]);
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, parameters) => inner.query(sql, parameters), execute: (sql, parameters) => inner.execute(sql, parameters), verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, parameters) => transaction.query(sql, parameters),
      execute: async (sql, parameters) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pet skill read audit failure");
        return transaction.execute(sql, parameters);
      },
    })),
  };
}

try {
  const success = `${base}-success`;
  if (restart) {
    const before = await database.query<Array<{ ops: bigint; outboxes: bigint; quantity: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=987100001 AND skill_id=987100003) quantity", [success, success]);
    await service.read({ eventId: success, externalUserId: "skill-viewer", destinationId: "synthetic-pet-skill-room" });
    const after = await database.query<typeof before>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pet.skill_read' AND idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=987100001 AND skill_id=987100003) quantity", [success, success]);
    assert.deepEqual(after, before);
    assert.deepEqual(after[0], { ops: 1n, outboxes: 1n, quantity: 9007199254740993n });
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operationCount: 1, outboxCount: 1, inventoryQuantity: "9007199254740993", additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await database.execute("INSERT INTO players(id,status) VALUES (987100001,'active')");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (987100001,'펫스킬테스터')");
    await database.execute("INSERT INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (987100001,987100001,'iris','skill-viewer','펫스킬테스터','linked')");
    await database.execute("INSERT INTO player_pets(id,player_id,display_name,image_value,experience) VALUES (987100001,987100001,'호이','🐶',0)");
    await database.execute("INSERT INTO player_pet_intimacy(player_pet_id,intimacy_level,progress,charm) VALUES (987100001,9007199254740993,0,0)");
    await database.execute("INSERT INTO skill_definitions(id,code,display_name,rules_json,active) VALUES (987100002,'pet_skill_textbook','펫스킬 학개론📙',JSON_OBJECT('grade','전설'),TRUE),(987100003,'pet_skill_heal','회복',JSON_OBJECT('grade','희귀'),TRUE)");
    await database.execute("INSERT INTO pet_skills(player_pet_id,slot_no,skill_id,level,equipped) VALUES (987100001,1,987100002,2,TRUE)");
    await database.execute("INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity) VALUES (987100001,987100003,9007199254740993)");
    assert.equal((await database.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PET_SKILL_READ'"))[0]!.rollout_state, "SHADOW");
    await event(success);
    const result = await service.read({ eventId: success, externalUserId: "skill-viewer", destinationId: "synthetic-pet-skill-room" });
    assert.equal(result.slotLimit, 33);
    assert.equal(result.equippedCount, 1);
    assert.equal(result.inventoryCount, 1);
    assert.match(result.reply, /장착 슬롯 1\/33/);
    assert.match(result.reply, /회복 x9007199254740993/);
    assert.deepEqual(await service.read({ eventId: success, externalUserId: "skill-viewer", destinationId: "synthetic-pet-skill-room" }), result);
    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(() => new PetSkillReadService(failAudit(database)).read({ eventId: rollback, externalUserId: "skill-viewer", destinationId: "synthetic-pet-skill-room" }), /synthetic pet skill read audit failure/);
    const effects = await database.query<Array<{ ops: bigint; outboxes: bigint; rollbackOps: bigint; quantity: bigint }>>("SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) ops,(SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_key=?) outboxes,(SELECT COUNT(*) FROM operations WHERE idempotency_key=?) rollbackOps,(SELECT quantity FROM pet_skill_inventory WHERE player_pet_id=987100001 AND skill_id=987100003) quantity", [success, success, rollback]);
    assert.deepEqual(effects[0], { ops: 1n, outboxes: 1n, rollbackOps: 0n, quantity: 9007199254740993n });
    assert.equal(await database.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", scenarios: ["shadow-registry", "normalized-projection", "slot30-33", "bigint", "replay", "rollback", "no-domain-mutation"], effects: { operation: 1, outbox: 1, rollbackOperation: 0, inventoryQuantity: "9007199254740993" }, operationalDataTouched: false }) + "\n");
  }
} finally {
  await database.close();
}
