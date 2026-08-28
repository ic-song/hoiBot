import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { MemberVoiceAuthRewardService } from "../src/admin/member-voice-auth-reward-service.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

async function waitForReply(replies: Array<{ room: string; data: string }>, count: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (replies.length < count && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length >= count, true, "Iris reply was not delivered within 5 seconds");
}

describe("member voice auth reward MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let operatorId: bigint;
  let operatorPlayerId: bigint;
  let targetPlayerId: bigint;
  let rollbackTargetPlayerId: bigint;
  const suffix = Date.now().toString();
  const token = "member-voice-auth-token";
  const roomId = "990000000000508";
  const operatorExternalId = `voice-admin-${suffix}`;
  const userExternalId = `voice-user-${suffix}`;
  const targetName = `🌟합성 인증 회원 ${suffix}`;
  const rollbackTargetName = `🌟합성 롤백 회원 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_MEMBER_VOICE_AUTH_REWARD'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`voice-admin-${suffix}`, "합성 인증 관리자", "synthetic"]);
    operatorId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`voice-admin-${suffix}`]))[0]!.id;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='manager'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operatorId, role.id]);
    for (const [externalId, displayName, link] of [[operatorExternalId, "합성 인증 관리자", true], [userExternalId, "권한 없는 회원", false]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [player.id, externalId, displayName]);
      if (link) {
        operatorPlayerId = player.id;
        const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [externalId]))[0]!;
        await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operatorId, identity.id]);
      }
    }
    for (const [displayName, assign] of [[targetName, "normal"], [rollbackTargetName, "rollback"]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, displayName]);
      if (assign === "normal") targetPlayerId = player.id; else rollbackTargetPlayerId = player.id;
    }
  });

  after(async () => {
    if (database) {
      try { await database.close(); }
      catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
        if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
      }
    }
  });

  it("authenticates once, rewards atomically, blocks unauthorized and missing targets, rolls back and replays after reconnect", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "member-voice-auth-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, externalId: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "합성 인증 관리자방", sender: externalId, json: { _id: id, chat_id: roomId, user_id: externalId } } });

    const firstEvent = `voice-auth-${Date.now()}`;
    await send(firstEvent, operatorExternalId, `/인증 ${targetName}`);
    await waitForReply(replies, 1);
    assert.match(replies.at(-1)!.data, /음성 인증을 완료했습니다/);
    const state = (await database.query<Array<{ verifications: bigint; item_quantity: bigint; point_balance: string; check_count: string; inventory_ledgers: bigint; currency_ledgers: bigint; reward_events: bigint }>>(
      `SELECT
       (SELECT COUNT(*) FROM player_verifications WHERE player_id=? AND verification_code='voice' AND status='verified') verifications,
       (SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code='ITEM-RWD-001') item_quantity,
       (SELECT CAST(balance AS CHAR) FROM currency_accounts WHERE player_id=? AND currency_code='POINT') point_balance,
       (SELECT CAST(check_count AS CHAR) FROM player_check_counts WHERE player_id=?) check_count,
       (SELECT COUNT(*) FROM inventory_ledger WHERE player_id=? AND reason_code='member_voice_auth_reward') inventory_ledgers,
       (SELECT COUNT(*) FROM currency_ledger WHERE player_id=? AND reason_code='member_voice_auth_reward') currency_ledgers,
       (SELECT COUNT(*) FROM admin_member_voice_auth_reward_events WHERE target_player_id=?) reward_events`,
      [targetPlayerId, operatorPlayerId, operatorPlayerId, operatorPlayerId, operatorPlayerId, operatorPlayerId, targetPlayerId]
    ))[0]!;
    assert.deepEqual([Number(state.verifications), Number(state.item_quantity), state.point_balance, state.check_count, Number(state.inventory_ledgers), Number(state.currency_ledgers), Number(state.reward_events)], [1,20,"5000000.000","1",1,1,1]);

    await send(`voice-auth-repeat-${Date.now()}`, operatorExternalId, `/인증 ${targetName}`);
    await waitForReply(replies, 2);
    assert.match(replies.at(-1)!.data, /이미 인증되었습니다/);
    await send(`voice-auth-denied-${Date.now()}`, userExternalId, `/인증 ${rollbackTargetName}`);
    await waitForReply(replies, 3);
    assert.match(replies.at(-1)!.data, /인증 권한이 없습니다/);
    await send(`voice-auth-missing-${Date.now()}`, operatorExternalId, "/인증 존재하지않는합성회원");
    await waitForReply(replies, 4);
    assert.match(replies.at(-1)!.data, /존재하지 않습니다/);

    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_MEMBER_VOICE_AUTH_REWARD'");
    const shadowId = `voice-auth-shadow-${Date.now()}`;
    await send(shadowId, operatorExternalId, `/인증 ${rollbackTargetName}`);
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_verifications WHERE player_id=?", [rollbackTargetPlayerId]))[0]!.count), 0);
    assert.equal((await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!.route, "SHADOW");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='ADMIN_MEMBER_VOICE_AUTH_REWARD'");

    const directEvent = `iris:voice-auth-direct-${Date.now()}`;
    await database.execute(
      "INSERT INTO event_inbox(event_id,event_kind,processing_status,received_at) VALUES (?,'command','processed',UTC_TIMESTAMP(3))",
      [directEvent]
    );
    const service = new MemberVoiceAuthRewardService(database);
    await database.execute("DROP TRIGGER IF EXISTS trg_member_voice_auth_rollback");
    await database.execute("CREATE TRIGGER trg_member_voice_auth_rollback BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced member voice auth rollback'");
    await assert.rejects(service.grant({ message: `/인증 ${rollbackTargetName}`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorPlayerId: operatorPlayerId.toString(), operatorDisplayName: "합성 인증 관리자" }), /forced member voice auth rollback/);
    await database.execute("DROP TRIGGER trg_member_voice_auth_rollback");
    assert.equal(Number((await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM player_verifications WHERE player_id=?", [rollbackTargetPlayerId]))[0]!.count), 0);
    const beforeReconnect = await service.grant({ message: `/인증 ${rollbackTargetName}`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorPlayerId: operatorPlayerId.toString(), operatorDisplayName: "합성 인증 관리자" });
    await app.close();
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    const afterReconnect = await new MemberVoiceAuthRewardService(database).grant({ message: `/인증 ${rollbackTargetName}`, idempotencyKey: directEvent, sourceEventId: directEvent, destinationId: roomId, operatorId: operatorId.toString(), operatorPlayerId: operatorPlayerId.toString(), operatorDisplayName: "합성 인증 관리자" });
    assert.deepEqual(afterReconnect, beforeReconnect);
  });
});
