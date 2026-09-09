import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { SpecialBadgeGrantService } from "../src/admin/special-badge-grant-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("special badge grant MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let targetPlayerId: bigint;
  let operatorId: bigint;
  const suffix = Date.now().toString();
  const token = "special-badge-grant-token";
  const roomId = "990000000000450";
  const operatorExternalId = `badge-grant-admin-${suffix}`;
  const userExternalId = `badge-grant-user-${suffix}`;
  const targetName = `🌟합성 지급 회원 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_SPECIAL_BADGE_GRANT'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`badge-grant-${suffix}`, "특별 뱃지 지급 관리자", "synthetic"]);
    operatorId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`badge-grant-${suffix}`]))[0]!.id;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operatorId, role.id]);
    for (const [externalId, displayName, link] of [[operatorExternalId, "특별 뱃지 지급 관리자", true], [userExternalId, "일반 회원", false]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (link) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operatorId, identity.id]);
      }
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    targetPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [targetPlayerId, targetName]);
    await database.execute("INSERT INTO player_home_badge_exclusions(player_id,badge_code,reason_code) VALUES (?,'S02','legacy_permanent_delete')", [targetPlayerId]);
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("grants once, rejects excluded and unauthorized requests, keeps Shadow mutation-free, rolls back and replays after reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "special-badge-grant-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, externalId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "합성 뱃지 관리자방", sender: externalId, json: { _id: id, chat_id: roomId, user_id: externalId } } });
    const firstEvent = `badge-grant-${Date.now()}`;
    await send(firstEvent, operatorExternalId, `/특별뱃지지급 ${targetName}, [S01]`);
    await waitForReply(replies, 1);
    assert.equal(replies.at(-1)!.data, `✅ 특별 뱃지를 지급했습니다.\n━━━━━━━━━━━━\n대상: ${targetName}\n지급 뱃지: 🎂 펫홈 1주년 [S01]\n처리 관리자: 특별 뱃지 지급 관리자`);
    await send(firstEvent, operatorExternalId, `/특별뱃지지급 ${targetName}, [S01]`);
    await send(`badge-grant-owned-${Date.now()}`, operatorExternalId, `/특별뱃지지급 ${targetName} 펫홈 1주년`);
    await waitForReply(replies, 2);
    assert.equal(replies.at(-1)!.data, `⚠️ 해당 유저가 이미 보유한 특별 뱃지입니다.\n대상: ${targetName}\n뱃지: 🎂 펫홈 1주년 [S01]`);
    await send(`badge-grant-excluded-${Date.now()}`, operatorExternalId, `/특별뱃지지급 ${targetName} S02`);
    await waitForReply(replies, 3);
    assert.equal(replies.at(-1)!.data, "❌ 해당 유저가 영구 삭제한 뱃지라 다시 지급할 수 없습니다.");
    await send(`badge-grant-denied-${Date.now()}`, userExternalId, `/특별뱃지지급 ${targetName} S03`);
    await waitForReply(replies, 4);
    assert.equal(replies.at(-1)!.data, "❌ 특별 뱃지 관리 권한이 없습니다.");
    const granted = (await database.query<Array<{ assignments: bigint; alerts: bigint; mutations: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM player_badge_assignments WHERE player_id=? AND badge_code='S01') assignments,
       (SELECT COUNT(*) FROM player_badge_alerts WHERE player_id=? AND alert_type='special_badge_granted') alerts,
       (SELECT COUNT(*) FROM player_special_badge_mutations WHERE player_id=? AND mutation_kind='grant') mutations`, [targetPlayerId,targetPlayerId,targetPlayerId]
    ))[0]!;
    assert.deepEqual([Number(granted.assignments), Number(granted.alerts), Number(granted.mutations)], [1,1,1]);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_SPECIAL_BADGE_GRANT'");
    const shadowId = `badge-grant-shadow-${Date.now()}`;
    await send(shadowId, operatorExternalId, `/특별뱃지지급 ${targetName} S03`);
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_badge_assignments WHERE player_id=? AND badge_code='S03'", [targetPlayerId]))[0]!.count), 0);
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!.route, "SHADOW");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_SPECIAL_BADGE_GRANT'");
    const directEvent = `iris:${shadowId}`;
    await database.execute("DROP TRIGGER IF EXISTS trg_special_badge_grant_rollback");
    await database.execute("CREATE TRIGGER trg_special_badge_grant_rollback BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced special badge grant rollback'");
    const service = new SpecialBadgeGrantService(database);
    await assert.rejects(service.grant({ message: `/특별뱃지지급 ${targetName} S03`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorDisplayName: "특별 뱃지 지급 관리자" }), /forced special badge grant rollback/);
    await database.execute("DROP TRIGGER trg_special_badge_grant_rollback");
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_badge_assignments WHERE player_id=? AND badge_code='S03'", [targetPlayerId]))[0]!.count), 0);
    const beforeReconnect = await service.grant({ message: `/특별뱃지지급 ${targetName} S03`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorDisplayName: "특별 뱃지 지급 관리자" });
    await app.close();
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    const afterReconnect = await new SpecialBadgeGrantService(database).grant({ message: `/특별뱃지지급 ${targetName} S03`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorDisplayName: "특별 뱃지 지급 관리자" });
    assert.deepEqual(afterReconnect, beforeReconnect);
  });
});
