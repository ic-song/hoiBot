import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetExploreRecordsResetService } from "../src/pet/pet-explore-records-reset-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("pet explore records reset MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "pet-explore-reset-token", roomId = "990000000000582", suffix = Date.now().toString(), adminExternalId = `pet-explore-reset-admin-${suffix}`, userExternalId = `pet-explore-reset-user-${suffix}`;
  const openDatabase = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = openDatabase();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='PET_EXPLORE_RECORDS_RESET'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','x','active')", [`pet-explore-reset-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pet-explore-reset-${suffix}`]))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [player.id, adminExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [adminExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const ordinary = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'일반 유저',1)", [ordinary.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'일반 유저','linked')", [ordinary.id, userExternalId]);
    await database.execute("INSERT INTO player_pet_explore_rank_stats(player_name,win_count,lose_count,source_order) VALUES ('가',10,2,0),('나',20,3,1),('다',30,4,2)");
  });

  after(async () => {
    if (!database) return;
    try { await database.execute("DROP TRIGGER IF EXISTS fail_pet_explore_reset_outbox"); await database.close(); }
    catch (error) { const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined; if (code !== "ER_POOL_ALREADY_CLOSED") throw error; }
  });

  it("authorizes, backs up, resets, replays, shadows, rolls back and reconnects", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "pet-explore-reset-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.PET_EXPLORE_RECORDS_RESET_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    let app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async reply => { replies.push(reply); } });
    const prepare = async (id: string) => database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('e',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]);
    const send = (id: string, externalId = adminExternalId) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/펫탐험전체전적초기화", room: "고도화펫테스트방", sender: externalId === adminExternalId ? "호이 남" : "일반 유저", json: { _id: id, chat_id: roomId, user_id: externalId } } });

    const activeId = `pet-explore-reset-active-${Date.now()}`;
    await prepare(activeId);
    const service = new PetExploreRecordsResetService(database);
    const active = await service.execute({ eventId: activeId, externalUserId: adminExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" });
    assert.equal(active.status, "reset");
    assert.match(active.data, /대상: 3명/);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM player_pet_explore_rank_stats"))[0]!.n), 0);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM pet_explore_record_reset_backups"))[0]!.n), 3);
    const replay = await service.execute({ eventId: activeId, externalUserId: adminExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" });
    assert.equal(replay.replayed, true);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM pet_explore_record_reset_operations"))[0]!.n), 1);
    const deniedId = `denied-${Date.now()}`;
    await prepare(deniedId);
    await assert.rejects(() => service.execute({ eventId: deniedId, externalUserId: userExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" }), /권한이 없습니다/);

    await database.execute("INSERT INTO player_pet_explore_rank_stats(player_name,win_count,lose_count,source_order) VALUES ('라',40,5,3),('마',50,6,4)");
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='PET_EXPLORE_RECORDS_RESET'");
    await send(`pet-explore-reset-shadow-${Date.now()}`);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM player_pet_explore_rank_stats"))[0]!.n), 2);

    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='PET_EXPLORE_RECORDS_RESET'");
    await database.execute("CREATE TRIGGER fail_pet_explore_reset_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic pet explore reset outbox failure'");
    const rollbackId = `pet-explore-reset-rollback-${Date.now()}`;
    await prepare(rollbackId);
    await assert.rejects(() => service.execute({ eventId: rollbackId, externalUserId: adminExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" }), /synthetic pet explore reset outbox failure/);
    await database.execute("DROP TRIGGER fail_pet_explore_reset_outbox");
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM player_pet_explore_rank_stats"))[0]!.n), 2);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM pet_explore_record_reset_operations"))[0]!.n), 1);

    await app.close();
    database = openDatabase();
    const afterReconnectReplay = await new PetExploreRecordsResetService(database).execute({ eventId: activeId, externalUserId: adminExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" });
    assert.equal(afterReconnectReplay.replayed, true);
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM player_pet_explore_rank_stats"))[0]!.n), 2);
    const restartId = `pet-explore-reset-restart-${Date.now()}`;
    await prepare(restartId);
    const restarted = await new PetExploreRecordsResetService(database).execute({ eventId: restartId, externalUserId: adminExternalId, destinationId: roomId, message: "/펫탐험전체전적초기화" });
    assert.equal(restarted.status, "reset");
    assert.equal(Number((await database.query<Array<{ n: bigint }>>("SELECT COUNT(*) n FROM player_pet_explore_rank_stats"))[0]!.n), 0);
    delete process.env.PET_EXPLORE_RECORDS_RESET_COMMAND_ENABLED;
    await app.close();
  });
});
