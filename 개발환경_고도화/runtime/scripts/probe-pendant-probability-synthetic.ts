import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { PendantProbabilityService } from "../src/pet/pendant-probability-service.js";

const config = loadConfig();
if (!config.database.enabled) throw new Error("DATABASE_ENABLED must be true.");
if (!/^hoibot_pendant_probability(?:_[a-z0-9_]+)?$/i.test(config.database.name)) {
  throw new Error(`Synthetic pendant probability probe blocked: ${config.database.name}`);
}

const base = process.env.PENDANT_PROBABILITY_PROBE_EVENT_ID ?? "pendant-probability-g7-20260827-r1";
const restart = process.argv.includes("--verify-restart");
const db = createDatabaseClient(config.database);
const service = new PendantProbabilityService(db);
const success = `${base}-success`;

async function event(id: string) {
  await db.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,'synthetic-pendant-probability-room','probability-user','message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [id, id],
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(),
    query: (sql, params) => inner.query(sql, params),
    execute: (sql, params) => inner.execute(sql, params),
    verifyRollback: () => inner.verifyRollback(),
    close: async () => undefined,
    withTransaction: <T>(work: (tx: DatabaseTransaction) => Promise<T>) => inner.withTransaction((tx) => work({
      query: (sql, params) => tx.query(sql, params),
      execute: async (sql, params) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic pendant probability audit failure");
        return tx.execute(sql, params);
      },
    })),
  };
}

async function snapshot() {
  return db.query<Array<{ operations: bigint; outboxes: bigint; audits: bigint; inventory: bigint }>>(
    "SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_scope='pendant.probability.read') operations,(SELECT COUNT(*) FROM outbox_messages o JOIN operations p ON p.id=o.operation_id WHERE p.idempotency_scope='pendant.probability.read') outboxes,(SELECT COUNT(*) FROM command_audit WHERE action_code='pendant.probability.read') audits,(SELECT COUNT(*) FROM inventory_instances) inventory",
  );
}

try {
  const expected = { operations: 1n, outboxes: 1n, audits: 1n, inventory: 0n };
  if (restart) {
    const before = await snapshot();
    await service.handle({ eventId: success, externalUserId: "probability-user", destinationId: "synthetic-pendant-probability-room", message: "/펜던트확률" });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(before[0], expected);
    process.stdout.write(JSON.stringify({ mode: "verify-restart", operations: 1, additionalMutation: false, operationalDataTouched: false }) + "\n");
  } else {
    await db.execute("INSERT INTO players(id,status) VALUES (989000101,'active')");
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name) VALUES (989000101,'확률 조회자')");
    await db.execute("INSERT INTO external_identities(provider_code,external_user_id,player_id,status) VALUES ('kakao','probability-user',989000101,'linked')");
    assert.equal((await db.query<Array<{ rollout_state: string }>>("SELECT rollout_state FROM command_registry WHERE command_code='PENDANT_PROBABILITY_READ'"))[0]!.rollout_state, "SHADOW");
    const rows = await db.query<Array<{ name: string; icon: string; grade: string; rate: string }>>("SELECT display_name name,JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.icon')) icon,JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.grade')) grade,JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.rate')) rate FROM item_definitions WHERE JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.objectType'))='pendant' AND JSON_EXTRACT(metadata_json,'$.drawOrder') IS NOT NULL ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.drawOrder')) AS UNSIGNED)");
    assert.equal(rows.length, 13);
    assert.deepEqual(rows[0], { name: "고요의 펜던트", icon: "🌙", grade: "최하급", rate: "39.89" });
    assert.deepEqual(rows[12], { name: "창조의 펜던트", icon: "🪬", grade: "창조", rate: "0.01" });
    assert.equal(rows.reduce((sum, row) => sum + Number(row.rate), 0), 100);
    await event(success);
    const result = await service.handle({ eventId: success, externalUserId: "probability-user", destinationId: "synthetic-pendant-probability-room", message: "/펜던트확률" });
    assert.equal(result.rowCount, 13);
    assert.equal(result.rateTotal, 100);
    assert.match(result.data, /^💎 펜던트 확률\n━━━━━━━━━━━━\n고요의 펜던트🌙\[최하급\] 39\.89%/);
    assert.match(result.data, /창조의 펜던트🪬\[창조\] 0\.01%$/);
    assert.deepEqual(await service.handle({ eventId: success, externalUserId: "probability-user", destinationId: "synthetic-pendant-probability-room", message: "/펜던트확률" }), result);
    const rollback = `${base}-rollback`;
    await event(rollback);
    await assert.rejects(() => new PendantProbabilityService(failAudit(db)).handle({ eventId: rollback, externalUserId: "probability-user", destinationId: "synthetic-pendant-probability-room", message: "/펜던트확률" }), /synthetic pendant probability audit failure/);
    assert.deepEqual((await snapshot())[0], expected);
    assert.equal(await db.verifyRollback(), true);
    process.stdout.write(JSON.stringify({ mode: "probe", migrationCount: 134, scenarios: ["shadow-registry", "source-definition-correction", "ordered-rates", "rate-total", "read-only", "replay", "rollback"], effects: { operations: 1, outboxes: 1, audits: 1, inventory: 0 }, operationalDataTouched: false }) + "\n");
  }
} finally {
  await db.close();
}
