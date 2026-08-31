import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HoiPassService } from "../src/pass/hoi-pass-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("hoi pass lifecycle MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "hoi-pass-test-token";
  const room = "990000000000641";
  const suffix = Date.now().toString();
  const adminExternalId = `hoi-pass-admin-${suffix}`;
  const targetName = `호이패스 대상 ${suffix}`;
  const open = (): DatabaseClient => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOI_PASS_REGISTRY'");
    await database.execute("INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES ('hoi_pass_auto_explore_ticket_fixture','자동탐험권🌄','STACK',TRUE,JSON_OBJECT('fixture',TRUE),TRUE,1) ON DUPLICATE KEY UPDATE active=TRUE");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','x','active')", [`hoi-pass-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`hoi-pass-${suffix}`]))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const admin = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1)", [admin.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [admin.id, adminExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE external_user_id=?", [adminExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const target = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [target.id, targetName]);
  });

  after(async () => {
    if (!database) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_hoi_pass_outbox");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("adds, replays, shadows, rolls back, retains or revokes tickets and reconnects", async () => {
    const prepare = async (eventId: string): Promise<unknown> => database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('h',64),'parsed','processing',UTC_TIMESTAMP(3))", [eventId, eventId]);
    const service = new HoiPassService(database);
    const addId = `hoi-pass-add-${Date.now()}`;
    await prepare(addId);
    const added = await service.execute({ eventId: addId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스추가, ${targetName}` });
    assert.equal(added.ticketDelta, "1");
    const replay = await service.execute({ eventId: addId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스추가, ${targetName}` });
    assert.equal(replay.replayed, true);
    const updateId = `hoi-pass-update-${Date.now()}`;
    await prepare(updateId);
    const updated = await service.execute({ eventId: updateId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스추가, ${targetName} 99.12.31` });
    assert.match(updated.data, /기존 종료일/);
    assert.match(updated.data, /자동탐험권🌄 2개/);
    const target = (await database.query<Array<{ player_id: bigint }>>("SELECT player_id FROM player_profiles WHERE current_display_name=?", [targetName]))[0]!;
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'premium',TRUE,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE,permanent=TRUE", [target.player_id]);
    const retainId = `hoi-pass-retain-${Date.now()}`;
    await prepare(retainId);
    const retained = await service.execute({ eventId: retainId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스삭제, ${targetName}` });
    assert.equal(retained.ticketDelta, "0");
    assert.match(retained.data, /유지합니다/);
    const reAddId = `hoi-pass-readd-${Date.now()}`;
    await prepare(reAddId);
    await service.execute({ eventId: reAddId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스추가, ${targetName}` });
    await database.execute("UPDATE player_passes SET enabled=FALSE WHERE player_id=? AND pass_code='premium'", [target.player_id]);
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "hoi-pass-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.HOI_PASS_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOI_PASS_REGISTRY'");
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: `/호이패스삭제, ${targetName}`, room: "고도화펫테스트방", sender: "호이 남", json: { _id: `hoi-pass-shadow-${Date.now()}`, chat_id: room, user_id: adminExternalId } } });
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM player_support_passes WHERE player_id=? AND pass_code='hoi'", [target.player_id]))[0]!.status, "active");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='HOI_PASS_REGISTRY'");
    const rollbackId = `hoi-pass-rollback-${Date.now()}`;
    await prepare(rollbackId);
    await database.execute("CREATE TRIGGER fail_hoi_pass_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic hoi pass outbox failure'");
    await assert.rejects(() => service.execute({ eventId: rollbackId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스삭제, ${targetName}` }), /synthetic hoi pass outbox failure/);
    await database.execute("DROP TRIGGER fail_hoi_pass_outbox");
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM player_support_passes WHERE player_id=? AND pass_code='hoi'", [target.player_id]))[0]!.status, "active");
    const deleteId = `hoi-pass-delete-${Date.now()}`;
    await prepare(deleteId);
    const deleted = await service.execute({ eventId: deleteId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스삭제, ${targetName}` });
    assert.equal(deleted.ticketDelta, "-3");
    await app.close();
    database = open();
    const reconnected = await new HoiPassService(database).execute({ eventId: deleteId, externalUserId: adminExternalId, destinationId: room, message: `/호이패스삭제, ${targetName}` });
    assert.equal(reconnected.replayed, true);
    assert.equal((await database.query<Array<{ quantity: bigint }>>("SELECT stack.quantity FROM inventory_stacks stack JOIN item_definitions definition ON definition.id=stack.item_id WHERE stack.player_id=? AND definition.display_name='자동탐험권🌄'", [target.player_id]))[0]!.quantity, 0n);
    delete process.env.HOI_PASS_COMMAND_ENABLED;
  });
});
