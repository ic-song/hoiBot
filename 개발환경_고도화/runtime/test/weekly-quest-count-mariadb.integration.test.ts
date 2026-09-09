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

describe("weekly quest count MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = Date.now().toString();
  const token = "weekly-quest-count-token";
  const roomId = "990000000000445";
  const operatorExternalId = `weekly-count-admin-${suffix}`;
  const targetName = `합성 주간 회원 ${suffix}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_WEEKLY_QUEST_COUNT_MUTATE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,?,?,'active')", [`weekly-count-${suffix}`, "주간 횟수 관리자", "synthetic"]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`weekly-count-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const adminPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'주간 횟수 관리자','linked')", [adminPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    for (const [name, count] of [[targetName, 2], [`합성 주간 회원 B ${suffix}`, 7], [`합성 주간 회원 C ${suffix}`, null]] as const) {
      await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
      const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
      await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [player.id, name]);
      if (count !== null) await database.execute("INSERT INTO player_pet_daily_records(player_id,record_date,weekly_quest_count,version) VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,1)", [player.id, count]);
    }
  });

  after(async () => { if (database) { try { await database.close(); } catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; } } });

  it("updates one player, resets every active player and keeps Shadow mutation-free", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "weekly-count-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (id: string, message: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: message, room: "고도화주간횟수방", sender: "주간 횟수 관리자", json: { _id: id, chat_id: roomId, user_id: operatorExternalId } } });
    const updateId = `weekly-count-update-${Date.now()}`;
    await send(updateId, `/주간횟수수정 ${targetName}, 6`);
    await waitForReply(replies, 1);
    assert.equal(replies.at(-1)!.data, `[${targetName}] 님의 주간횟수가 6회로 수정되었습니다.`);
    await send(updateId, `/주간횟수수정 ${targetName}, 6`);
    const resetId = `weekly-count-reset-${Date.now()}`;
    await send(resetId, "/주간횟수초기화");
    await waitForReply(replies, 2);
    assert.equal(replies.at(-1)!.data, "전체 유저 주간횟수 초기화 완료\n초기화된 유저 수: 4명");
    let state = (await database.query<Array<{ total: string; positive: bigint; rows_count: bigint }>>(
      "SELECT CAST(SUM(weekly_quest_count) AS CHAR) total,SUM(weekly_quest_count>0) positive,COUNT(*) rows_count FROM player_pet_daily_records WHERE record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))"
    ))[0]!;
    assert.deepEqual([state.total, Number(state.positive), Number(state.rows_count)], ["0", 0, 4]);
    const mutations = (await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM admin_weekly_quest_count_mutations"))[0]!;
    assert.equal(Number(mutations.count), 2);
    await database.execute("UPDATE player_pet_daily_records SET weekly_quest_count=777 WHERE player_id=(SELECT MIN(player_id) FROM player_pet_daily_records)");
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_WEEKLY_QUEST_COUNT_MUTATE'");
    const shadowId = `weekly-count-shadow-${Date.now()}`;
    await send(shadowId, "/주간횟수초기화");
    state = (await database.query<Array<{ total: string; positive: bigint; rows_count: bigint }>>(
      "SELECT CAST(SUM(weekly_quest_count) AS CHAR) total,SUM(weekly_quest_count>0) positive,COUNT(*) rows_count FROM player_pet_daily_records WHERE record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))"
    ))[0]!;
    assert.equal(state.total, "777");
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${shadowId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
