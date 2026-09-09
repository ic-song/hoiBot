import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("player diamond rank read MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "player-diamond-rank-read-token";
  const roomId = "990000000000588";
  const suffix = Date.now().toString();
  const externalUserId = `diamond-rank-reader-${suffix}`;
  const connect = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = connect();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PLAYER_DIAMOND_RANK_READ'");
    for (let index = 0; index < 12; index += 1) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      const displayName = index === 0 ? `다이아왕-${suffix}` : `다이아회원${String(index + 1).padStart(2, "0")}-${suffix}`;
      const granted = index === 0 ? 9007199254740993n : BigInt((12 - index) * 1000);
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
      await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (?,?,?)", [player.id, index === 0 ? "⭐" : "", index + 1]);
      await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',1,1)", [player.id]);
      const operation = await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at,completed_at) VALUES (?, 'fixture.diamond', ?, 'system', NULL, 'fixture', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", [`df-${index}`, `diamond-fixture-${suffix}-${index}`]);
      await database.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'diamond',?,?,'SYNTHETIC_GRANT'),(?,2,?,'diamond',-7,1,'SYNTHETIC_SPEND')", [operation.insertId, player.id, granted, granted, operation.insertId, player.id]);
      if (index === 0) await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalUserId, displayName]);
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('suspended',1)");
    const excluded = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'제외회원',1)", [excluded.id]);
    await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'diamond',999999999,1)", [excluded.id]);
    const excludedOperation = await database.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at,completed_at) VALUES (?, 'fixture.diamond', ?, 'system', NULL, 'fixture', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))", ["df-x", `diamond-fixture-${suffix}-excluded`]);
    await database.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'diamond',999999999,999999999,'SYNTHETIC_GRANT')", [excludedOperation.insertId, excluded.id]);
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => { delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; if (!database) return; try { await database.execute("DROP TRIGGER IF EXISTS fail_diamond_rank_audit"); await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } });

  it("uses positive grants only, rolls back evidence, replays, blocks suffixes, shadows and survives reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "player-diamond-rank-read-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, message = "/다이아순위", userId: string | null = externalUserId) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화펫테스트방", sender: `다이아왕-${suffix}`, json: { _id: eventId, chat_id: roomId, user_id: userId } } });
    const evidenceCounts = async () => ({ operation: Number((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='player.diamond_rank_read'"))[0]!.value), audit: Number((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM command_audit WHERE action_code='player.diamond_rank_read'"))[0]!.value), execution: Number((await database.query<Array<{ value: bigint }>>("SELECT COUNT(*) value FROM command_executions WHERE command_code='PLAYER_DIAMOND_RANK_READ'"))[0]!.value) });
    const ledgerState = async () => (await database.query<Array<{ count_value: bigint; delta_sum: string }>>("SELECT COUNT(*) count_value,CAST(SUM(delta) AS CHAR) delta_sum FROM currency_ledger"))[0]!;
    const beforeLedger = await ledgerState();

    await send(`diamond-rank-no-user-${suffix}`, "/다이아순위", null);
    assert.deepEqual(await evidenceCounts(), { operation: 0, audit: 0, execution: 0 });
    await database.execute("CREATE TRIGGER fail_diamond_rank_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic diamond rank audit failure'");
    assert.equal((await send(`diamond-rank-rollback-${suffix}`)).statusCode, 500);
    await database.execute("DROP TRIGGER fail_diamond_rank_audit");
    assert.deepEqual(await evidenceCounts(), { operation: 0, audit: 0, execution: 0 });

    const eventId = `diamond-rank-success-${suffix}`;
    assert.equal((await send(eventId)).statusCode, 202);
    const data = replies.at(-1)!.data;
    assert.match(data, new RegExp(`🥇\\. ⭐다이아왕-${suffix} - 💎: 9,007,199,254,740,993`));
    assert.equal(data.includes("제외회원"), false);
    assert.equal((data.match(/\u200b/g) ?? []).length, 500);
    assert.match(data, /11위\./);
    assert.match(data, /12위\./);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    assert.deepEqual(await ledgerState(), beforeLedger);
    await send(eventId);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    const replyCount = replies.length;
    await send(`diamond-rank-suffix-${suffix}`, "/다이아순위 1");
    assert.equal(replies.length, replyCount);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PLAYER_DIAMOND_RANK_READ'");
    await send(`diamond-rank-shadow-${suffix}`);
    assert.deepEqual(await evidenceCounts(), { operation: 1, audit: 1, execution: 1 });
    assert.deepEqual(await ledgerState(), beforeLedger);
    const beforeReconnect = await evidenceCounts();
    await app.close(); database = connect();
    assert.deepEqual(await evidenceCounts(), beforeReconnect);
    assert.deepEqual(await ledgerState(), beforeLedger);
    app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }) });
    await app.close();
  });
});
