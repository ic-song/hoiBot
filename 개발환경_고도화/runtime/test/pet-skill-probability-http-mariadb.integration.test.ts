import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.WAVE14A_ISOLATED_MARIADB_TEST === "true";
const required = (name: string) => process.env[name] ?? "wave14a-not-configured";

describe("Wave14A pet skill probability actual HTTP ingress", { skip: !enabled }, () => {
  const token = "wave14a-isolated-token";
  const roomId = "990000000000581";
  const suffix = `${process.pid}-${Date.now()}`;
  const externalUserId = `wave14a-user-${suffix}`;
  const suspendedUserId = `wave14a-suspended-${suffix}`;
  const longUserId = `wave14a-long-${suffix}`;
  const playerBase = BigInt(Date.now()) * 10n;
  const replies: Array<{ room: string; data: string }> = [];
  const apps = new Set<ReturnType<typeof buildApp>>();
  let database: DatabaseClient;

  before(async () => {
    const config = appConfig();
    database = createDatabaseClient(config.database);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW',enabled=TRUE");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PET_SKILL_PROBABILITY'");
    await database.execute("INSERT INTO players(id,status,version) VALUES (?,'active',1),(?,'suspended',1),(?,'active',1)",[playerBase+1n,playerBase+2n,playerBase+3n]);
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1),(?,'정지 남',1),(?,'다섯글자임',1)",[playerBase+1n,playerBase+2n,playerBase+3n]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked'),(?,'kakao',?,'정지 남','linked'),(?,'kakao',?,'다섯글자임','linked')", [playerBase+1n,externalUserId,playerBase+2n,suspendedUserId,playerBase+3n,longUserId]);
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    for (const app of apps) await app.close();
    await database.close();
  });

  it("proves exact bytes, auth/room boundaries, duplicate/restart/concurrency, and source DML0", async () => {
    let operational = true;
    const app = appWithRoom(() => operational);
    const beforeSource = await sourceEvidence();
    const firstId = `wave14a-success-${Date.now()}`;
    assert.equal((await send(app, firstId)).statusCode, 202);
    assert.equal(replies.length, 1);
    assert.deepEqual(outputEvidence(replies[0]!.data), {
      chars: 2630, bytes: 5494, sha256: "4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a"
    });
    assert.equal(await executionCount(`iris:${firstId}`, "pet_skill_probability"), 1n);
    assert.equal((await send(app, firstId)).statusCode, 202);
    assert.equal(replies.length, 1);

    const fresh = appWithRoom(() => true);
    assert.equal((await send(fresh, firstId)).statusCode, 202);
    assert.equal(replies.length, 1);
    assert.equal(await executionCount(`iris:${firstId}`, "pet_skill_probability"), 1n);
    const firstPayloadHash = await inboxPayloadHash(`iris:${firstId}`);
    await send(fresh, firstId, externalUserId, "호이 남", "/펫스킬확률 ");
    await send(fresh, firstId, `wave14a-unregistered-${suffix}`, "미가입");
    const otherRoom = appWithRoom(() => true);
    await otherRoom.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{msg:"/펫스킬확률",room:"다른방",sender:"호이 남",json:{_id:firstId,chat_id:"990000000000582",user_id:externalUserId}}});
    const prod = appWithRoom(() => true, "prod");
    await send(prod, firstId);
    assert.equal(replies.length, 1);
    assert.equal(await inboxPayloadHash(`iris:${firstId}`), firstPayloadHash);
    assert.equal(await executionCount(`iris:${firstId}`, "pet_skill_probability"), 1n);

    const concurrentId = `wave14a-concurrent-${Date.now()}`;
    const other = appWithRoom(() => true);
    const concurrent = await Promise.all([send(fresh, concurrentId), send(other, concurrentId)]);
    assert.deepEqual(concurrent.map((response: { statusCode: number }) => response.statusCode), [202, 202]);
    assert.equal(await executionCount(`iris:${concurrentId}`, "pet_skill_probability"), 1n);

    const repliesBeforeDenied = replies.length;
    await send(app, `wave14a-unregistered-${Date.now()}`, `wave14a-unregistered-${suffix}`, "미가입");
    await send(app, `wave14a-long-${Date.now()}`, longUserId, "다섯글자임");
    assert.equal(replies.length, repliesBeforeDenied);
    await send(app, `wave14a-suspended-${Date.now()}`, suspendedUserId, "정지 남");
    assert.equal(replies.at(-1)?.data, "계정정지 상태입니다 호월고객센터로 문의해주세요");

    const beforeOutOfScope = replies.length;
    await send(app, `wave14a-status-${Date.now()}`, externalUserId, "호이 남", "/펫스킬");
    await send(app, `wave14a-info-${Date.now()}`, externalUserId, "호이 남", "/펫스킬정보");
    assert.equal(replies.length, beforeOutOfScope);

    operational = false;
    const wrongRoomId = `wave14a-room-${Date.now()}`;
    const wrongRoom = await send(app, wrongRoomId);
    assert.equal(wrongRoom.statusCode, 202);
    assert.equal((wrongRoom.json() as { ignored?: boolean }).ignored, true);
    assert.equal(await executionCount(`iris:${wrongRoomId}`, "pet_skill_probability"), 0n);

    assert.deepEqual(await sourceEvidence(), beforeSource);
  });

  function appConfig(environment: "dev" | "prod" = "dev") {
    return loadConfig({ NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:environment,IRIS_SHARED_TOKEN:token,
      USER_VERIFICATION_PEPPER:"wave14a-isolated-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:required("DATABASE_HOST"),
      DATABASE_PORT:required("DATABASE_PORT"),DATABASE_USER:required("DATABASE_USER"),DATABASE_PASSWORD:required("DATABASE_PASSWORD"),DATABASE_NAME:required("DATABASE_NAME") });
  }
  function appWithRoom(isOperational: () => boolean, environment: "dev" | "prod" = "dev") {
    const app = buildApp(appConfig(environment), { database:createDatabaseClient(appConfig(environment).database),
      inspectIrisChannel:async()=>isOperational()
        ? {mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}
        : {mode:"denied",channelClass:"open_group",reason:"not_designated",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}},
      sendIrisTextReply:async(reply)=>{replies.push(reply);} });
    apps.add(app);
    return app;
  }
  function send(app: ReturnType<typeof buildApp>, id: string, user = externalUserId, sender = "호이 남", message = "/펫스킬확률") {
    return app.inject({ method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,
      payload:{msg:message,room:"Wave14A 펫스킬방",sender,json:{_id:id,chat_id:roomId,user_id:user}} });
  }
  async function executionCount(eventId: string, commandCode: string) {
    const row = (await database.query<Array<{value:bigint}>>("SELECT COUNT(*) value FROM command_executions WHERE event_id=? AND command_code=?", [eventId,commandCode]))[0];
    return row?.value ?? 0n;
  }
  async function inboxPayloadHash(eventId: string) {
    return (await database.query<Array<{payload_hash:string}>>("SELECT payload_hash FROM event_inbox WHERE event_id=?",[eventId]))[0]!.payload_hash;
  }
  async function sourceEvidence() {
    return database.query<Array<{table_name:string;row_count:bigint;row_hash:string}>>(
      `SELECT 'definition' table_name,COUNT(*) row_count,SHA2(GROUP_CONCAT(CONCAT_WS('|',pet_skill_id,pet_skill_name,pet_skill_grade,legacy_source_key,display_order,base_draw_rate,fixed_draw_rate_flag,openable_flag,active_flag) ORDER BY pet_skill_id SEPARATOR '\n'),256) row_hash FROM canonical_pet_skill_definitions
       UNION ALL SELECT 'alias',COUNT(*),SHA2(GROUP_CONCAT(CONCAT_WS('|',pet_skill_alias_id,pet_skill_id,alias_value,normalized_alias_value,active_flag) ORDER BY pet_skill_alias_id SEPARATOR '\n'),256) FROM canonical_pet_skill_aliases
       UNION ALL SELECT 'policy',COUNT(*),SHA2(GROUP_CONCAT(CONCAT_WS('|',pet_skill_draw_grade_policy_id,pet_skill_grade,grade_probability_total,display_order,active_flag) ORDER BY pet_skill_draw_grade_policy_id SEPARATOR '\n'),256) FROM canonical_pet_skill_draw_grade_policies`
    );
  }
});

function outputEvidence(value: string) {
  return { chars:value.length,bytes:Buffer.byteLength(value,"utf8"),sha256:createHash("sha256").update(value,"utf8").digest("hex") };
}
