import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("special badge revoke MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let targetPlayerId: bigint;
  const suffix = Date.now().toString();
  const token = "special-badge-revoke-token";
  const roomId = "990000000000449";
  const operatorExternalId = `badge-admin-${suffix}`;
  const userExternalId = `badge-user-${suffix}`;
  const targetName = `🌟합성 특별 회원 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_SPECIAL_BADGE_REVOKE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`badge-${suffix}`, "특별 뱃지 관리자", "synthetic"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`badge-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    for (const [externalId, displayName, link] of [[operatorExternalId, "특별 뱃지 관리자", true], [userExternalId, "일반 회원", false]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (link) {
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
      }
    }
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    targetPlayerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [targetPlayerId, targetName]);
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,'S01','🎂 펫홈 1주년',100),(?,'S02','🎊 이벤트 스타',90)", [targetPlayerId, targetPlayerId]);
    await database.execute("INSERT INTO player_badge_equipment(player_id,equipped_badge_code,version) VALUES (?,'S01',3)", [targetPlayerId]);
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("revokes owned and equipped badges, replays, rejects invalid actors and keeps Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "special-badge-revoke-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, externalId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "합성 뱃지 관리자방", sender: externalId, json: { _id: id, chat_id: roomId, user_id: externalId } } });
    const firstEvent = `badge-revoke-${Date.now()}`;
    await send(firstEvent, operatorExternalId, `/특별뱃지회수 ${targetName}, [S01]`);
    await waitForReply(replies, 1);
    assert.equal(replies.at(-1)!.data, `✅ 특별 뱃지를 회수했습니다.\n━━━━━━━━━━━━\n대상: ${targetName}\n회수 뱃지: 🎂 펫홈 1주년 [S01]\n처리 관리자: 특별 뱃지 관리자`);
    await send(firstEvent, operatorExternalId, `/특별뱃지회수 ${targetName}, [S01]`);
    await send(`badge-revoke-name-${Date.now()}`, operatorExternalId, `/특별뱃지회수 ${targetName} 이벤트 스타`);
    await waitForReply(replies, 2);
    await send(`badge-revoke-unowned-${Date.now()}`, operatorExternalId, `/특별뱃지회수 ${targetName} S03`);
    await waitForReply(replies, 3);
    assert.equal(replies.at(-1)!.data, "❌ 해당 유저가 보유하지 않은 특별 뱃지입니다.");
    await send(`badge-revoke-denied-${Date.now()}`, userExternalId, `/특별뱃지회수 ${targetName} S03`);
    await waitForReply(replies, 4);
    assert.equal(replies.at(-1)!.data, "❌ 특별 뱃지 관리 권한이 없습니다.");
    const state = (await database.query<Array<{ assignments: bigint; equipped: string | null; equipment_version: string; alerts: bigint; mutations: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM player_badge_assignments WHERE player_id=?) assignments,
       (SELECT equipped_badge_code FROM player_badge_equipment WHERE player_id=?) equipped,
       (SELECT CAST(version AS CHAR) FROM player_badge_equipment WHERE player_id=?) equipment_version,
       (SELECT COUNT(*) FROM player_badge_alerts WHERE player_id=?) alerts,
       (SELECT COUNT(*) FROM player_special_badge_mutations WHERE player_id=?) mutations`, [targetPlayerId,targetPlayerId,targetPlayerId,targetPlayerId,targetPlayerId]
    ))[0]!;
    assert.deepEqual([Number(state.assignments), state.equipped, state.equipment_version, Number(state.alerts), Number(state.mutations)], [0, null, "4", 2, 2]);
    await database.execute("INSERT INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,'S03','🛠️ 펫홈 개척자',80)", [targetPlayerId]);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_SPECIAL_BADGE_REVOKE'");
    const shadowId = `badge-shadow-${Date.now()}`;
    await send(shadowId, operatorExternalId, `/특별뱃지회수 ${targetName} [S03] 🛠️ 펫홈 개척자`);
    const retained = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_badge_assignments WHERE player_id=? AND badge_code='S03'", [targetPlayerId]))[0]!;
    assert.equal(Number(retained.count), 1);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
