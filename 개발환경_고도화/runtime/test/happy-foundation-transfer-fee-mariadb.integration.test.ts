import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("happy foundation transfer and fee MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "happy-foundation-transfer-token";
  const roomId = "990000000000307";
  const senderExternal = "happy-foundation-app-sender";
  const recipientName = "합성앱받는회원 여";
  const senderId = 998_200_001n;
  const recipientId = 998_200_002n;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=TRUE WHERE command_code IN ('HAPPY_FOUNDATION_FEE_CHANGE','HAPPY_FOUNDATION_READ','POINT_TRANSFER')");
    for (const [id, name, external] of [[senderId, "합성앱보낸회원 남", senderExternal], [recipientId, recipientName, "happy-foundation-app-recipient"]] as const) {
      await database.execute("INSERT IGNORE INTO players(id,status,version) VALUES (?,'active',1)", [id]);
      await database.execute("INSERT IGNORE INTO player_profiles(player_id,current_display_name,tier_code,version) VALUES (?,?,'king',1)", [id, name]);
      await database.execute("INSERT IGNORE INTO external_identities(id,player_id,provider_code,external_user_id,display_name,status) VALUES (?,?, 'kakao',?,?, 'linked')", [id + 10_000n, id, external, name]);
      await database.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',?,1) ON DUPLICATE KEY UPDATE balance=VALUES(balance),version=version+1", [id, id === senderId ? 50_000n : 0n]);
    }
    await database.execute("UPDATE foundation_states SET captain_player_id=?,fee_rate=10,total_amount=0,version=version+1 WHERE foundation_code='happy'", [senderId]);
    await database.execute("UPDATE guild_territory_wars SET active=FALSE");
  });

  after(async () => {
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes fee, read and transfer commands through the application exactly once", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "happy-foundation-app-pepper", PARTIAL_COMMAND_DISPATCH_ENABLED: "true",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화팻테스트방", sender: "합성앱보낸회원 남", json: { _id: eventId, chat_id: roomId, user_id: senderExternal } } });
    assert.equal((await send("happy-app-fee", "/이체수수료변경 12.50")).statusCode, 202);
    assert.equal((await send("happy-app-read", "/호이행복재단")).statusCode, 202);
    assert.equal((await send("happy-app-transfer", `/이체 ${recipientName} 10000`)).statusCode, 202);
    assert.equal((await send("happy-app-transfer", `/이체 ${recipientName} 10000`)).statusCode, 202);
    const balances = await database.query<Array<{ player_id: bigint; balance: string }>>("SELECT player_id,CAST(balance AS CHAR) balance FROM currency_accounts WHERE player_id IN (?,?) AND currency_code='point' ORDER BY player_id", [senderId, recipientId]);
    assert.deepEqual(balances.map((row) => row.balance), ["38750.000", "10000.000"]);
    const state = (await database.query<Array<{ total_amount: string; fee_rate: string }>>("SELECT CAST(total_amount AS CHAR) total_amount,CAST(fee_rate AS CHAR) fee_rate FROM foundation_states WHERE foundation_code='happy'"))[0]!;
    assert.deepEqual(state, { total_amount: "1250.000", fee_rate: "12.50" });
    const evidence = (await database.query<Array<{ transfers: bigint; ledgers: bigint; executions: bigint }>>(`SELECT
      (SELECT COUNT(*) FROM foundation_transfers WHERE sender_player_id=?) transfers,
      (SELECT COUNT(*) FROM currency_ledger ledger JOIN operations operation ON operation.id=ledger.operation_id WHERE operation.idempotency_scope LIKE 'foundation.happy.transfer:%' AND operation.actor_id=?) ledgers,
      (SELECT COUNT(*) FROM command_executions WHERE event_id IN ('iris:happy-app-fee','iris:happy-app-read','iris:happy-app-transfer')) executions`, [senderId, senderId + 10_000n]))[0]!;
    assert.deepEqual(evidence, { transfers: 1n, ledgers: 2n, executions: 3n });
    assert.equal(replies.some((reply) => reply.data.includes("이체 완료")), true);
    await app.close();
  });
});
