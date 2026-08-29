import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { BeginnerPassService } from "../src/pass/beginner-pass-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string) => process.env[name] ?? "integration-not-configured";

describe("beginner pass registry MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "beginner-pass-token";
  const room = "990000000000590";
  const suffix = Date.now().toString();
  const adminExternalId = `beginner-admin-${suffix}`;
  const targetExternalId = `beginner-user-${suffix}`;
  const targetName = `초보 대상 ${suffix}`;
  let targetPlayerId = 0n;

  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
  const prepare = async (eventId: string) => database.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES (?,'iris',?,'message','test','incoming',REPEAT('b',64),'parsed','processing',UTC_TIMESTAMP(3))", [eventId, eventId]);

  before(async () => {
    database = open();
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='BEGINNER_PASS_REGISTRY'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','x','active')", [`beginner-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`beginner-${suffix}`]))[0]!;
    const admin = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1)", [admin.insertId]);
    const adminIdentity = await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [admin.insertId, adminExternalId]);
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, adminIdentity.insertId]);
    const target = await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    targetPlayerId = target.insertId;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,?,1)", [targetPlayerId, targetName]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?, 'linked')", [targetPlayerId, targetExternalId, targetName]);
  });

  after(async () => {
    if (database === undefined) return;
    try {
      await database.execute("DROP TRIGGER IF EXISTS fail_beginner_pass_outbox");
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("grants on every add, replays, shadows, rolls back, conditionally revokes and reconnects", async () => {
    const service = new BeginnerPassService(database);
    const addEvent = `beginner-add-${Date.now()}`;
    await prepare(addEvent);
    const added = await service.execute({ eventId: addEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보추가, ${targetName}` });
    assert.equal(added.status, "changed");
    assert.equal(added.ticketDelta, "1");
    const replayed = await service.execute({ eventId: addEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보추가, ${targetName}` });
    assert.equal(replayed.replayed, true);
    assert.equal(replayed.ticketBalance, "1");

    const updateEvent = `beginner-update-${Date.now()}`;
    await prepare(updateEvent);
    const updated = await service.execute({ eventId: updateEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보패스추가, ${targetName} 99.12.31` });
    assert.equal(updated.ticketBalance, "2");
    assert.match(updated.data, /갱신/);

    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "beginner-pass-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    process.env.BEGINNER_PASS_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => {} });
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='BEGINNER_PASS_REGISTRY'");
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: `/초보삭제, ${targetName}`, room: "고도화펫테스트방", sender: "호이 남", json: { _id: `beginner-shadow-${Date.now()}`, chat_id: room, user_id: adminExternalId } } });
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM player_support_passes WHERE player_id=? AND pass_code='beginner'", [targetPlayerId]))[0]!.status, "active");
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='BEGINNER_PASS_REGISTRY'");

    const rollbackEvent = `beginner-rollback-${Date.now()}`;
    await prepare(rollbackEvent);
    await database.execute("CREATE TRIGGER fail_beginner_pass_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic beginner pass outbox failure'");
    await assert.rejects(() => service.execute({ eventId: rollbackEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보삭제, ${targetName}` }), /synthetic beginner pass outbox failure/);
    await database.execute("DROP TRIGGER fail_beginner_pass_outbox");
    assert.equal((await database.query<Array<{ status: string }>>("SELECT status FROM player_support_passes WHERE player_id=? AND pass_code='beginner'", [targetPlayerId]))[0]!.status, "active");
    assert.equal(String((await database.query<Array<{ quantity: bigint }>>(`SELECT stack.quantity FROM inventory_stacks stack JOIN beginner_pass_policy policy ON policy.ticket_item_id=stack.item_id AND policy.policy_key='default' WHERE stack.player_id=?`, [targetPlayerId]))[0]!.quantity), "2");

    const deleteEvent = `beginner-delete-${Date.now()}`;
    await prepare(deleteEvent);
    const deleted = await service.execute({ eventId: deleteEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보삭제, ${targetName}` });
    assert.equal(deleted.ticketDelta, "-2");
    assert.equal(deleted.ticketBalance, "0");

    const reAddEvent = `beginner-readd-${Date.now()}`;
    await prepare(reAddEvent);
    await service.execute({ eventId: reAddEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보추가, ${targetName}` });
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES (?,'premium',TRUE,TRUE) ON DUPLICATE KEY UPDATE enabled=TRUE,permanent=TRUE", [targetPlayerId]);
    const retainedDeleteEvent = `beginner-retained-delete-${Date.now()}`;
    await prepare(retainedDeleteEvent);
    const retained = await service.execute({ eventId: retainedDeleteEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보패스삭제, ${targetName}` });
    assert.equal(retained.ticketDelta, "0");
    assert.equal(retained.ticketBalance, "1");

    await app.close();
    database = open();
    const restartedReplay = await new BeginnerPassService(database).execute({ eventId: retainedDeleteEvent, externalUserId: adminExternalId, destinationId: room, message: `/초보삭제, ${targetName}` });
    assert.equal(restartedReplay.replayed, true);
    assert.equal(restartedReplay.ticketBalance, "1");
    delete process.env.BEGINNER_PASS_COMMAND_ENABLED;
  });
});
