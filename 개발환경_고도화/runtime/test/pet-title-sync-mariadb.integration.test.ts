import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetTitleSyncService } from "../src/admin/pet-title-sync-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("pet title sync MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = `${process.pid}-${Date.now()}`;
  const token = "pet-title-sync-token";
  const roomId = "990000000000453";
  const operatorExternalId = `pet-title-sync-operator-${suffix}`;
  let activePetId = 0n;
  let inactivePetId = 0n;
  let operatorId = 0n;
  let shadowSourceEventId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_PET_TITLE_SYNC'");
    await database.execute("UPDATE players player JOIN player_pets pet ON pet.player_id=player.id JOIN pet_titles title ON title.player_pet_id=pet.id SET player.status='active'");
    await database.execute(`INSERT IGNORE INTO player_profiles(player_id,current_display_name,version)
      SELECT DISTINCT pet.player_id,CONCAT('synthetic-',pet.player_id),1 FROM player_pets pet JOIN pet_titles title ON title.player_pet_id=pet.id`);
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')", [`pet-title-sync-op-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pet-title-sync-op-${suffix}`]))[0]!;
    operatorId = operator.id;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1)", [operatorPlayer.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);

    await database.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES (?,'합성 펫 타이틀','pet',1)", [`pet-title-sync-${suffix}`]);
    const title = (await database.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code=?", [`pet-title-sync-${suffix}`]))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const activePlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'활성 회원',1)", [activePlayer.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'활성 펫',1)", [activePlayer.id]);
    activePetId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [activePlayer.id]))[0]!.id;
    await database.execute("INSERT INTO pet_titles(player_pet_id,title_id,equipped) VALUES (?,?,1)", [activePetId, title.id]);

    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const inactivePlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'탈퇴 회원',1)", [inactivePlayer.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'정리 펫',1)", [inactivePlayer.id]);
    inactivePetId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [inactivePlayer.id]))[0]!.id;
    await database.execute("INSERT INTO pet_titles(player_pet_id,title_id,equipped) VALUES (?,?,1)", [inactivePetId, title.id]);
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  const appConfig = () => loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "pet-title-sync-pepper",
    DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });

  it("removes an inactive member title once while preserving pets and active titles", async () => {
    const replies: string[] = [];
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });
    const eventId = `pet-title-sync-${Date.now()}`;
    const send = () => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫타이틀동기화", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    const first = await send();
    assert.equal(first.statusCode, 202, first.body);
    await send();
    assert.match(replies.at(-1) ?? "", /펫타이틀데이터 동기화완료 \(1\)/);
    assert.equal((replies.at(-1)?.match(/\u200b/g) ?? []).length, 500);
    assert.equal(replies.at(-1)?.endsWith("탈퇴 회원"), true);
    const titles = await database.query<Array<{ player_pet_id: bigint }>>("SELECT player_pet_id FROM pet_titles WHERE player_pet_id IN (?,?) ORDER BY player_pet_id", [activePetId, inactivePetId]);
    assert.deepEqual(titles.map((row) => row.player_pet_id.toString()), [activePetId.toString()]);
    const pets = await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE id IN (?,?) ORDER BY id", [activePetId, inactivePetId]);
    assert.deepEqual(pets.map((row) => row.id.toString()), [activePetId.toString(), inactivePetId.toString()]);
    const operations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${eventId}`]);
    assert.equal(Number(operations[0]!.count), 1);
  });

  it("keeps an inactive pet title mutation-free under Shadow", async () => {
    const title = (await database.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code=?", [`pet-title-sync-${suffix}`]))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'Shadow 탈퇴 회원',1)", [player.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'Shadow 펫',1)", [player.id]);
    const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
    await database.execute("INSERT INTO pet_titles(player_pet_id,title_id,equipped) VALUES (?,?,1)", [pet.id, title.id]);
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_PET_TITLE_SYNC'");
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => undefined });
    const eventId = `pet-title-sync-shadow-${Date.now()}`;
    shadowSourceEventId = `iris:${eventId}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫타이틀동기화", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    const retained = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM pet_titles WHERE player_pet_id=?", [pet.id]);
    assert.equal(Number(retained[0]!.count), 1);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
  });

  it("rolls back title deletion when audit persistence fails", async () => {
    const title = (await database.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE code=?", [`pet-title-sync-${suffix}`]))[0]!;
    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'Rollback 탈퇴 회원',1)", [player.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'Rollback 펫',1)", [player.id]);
    const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
    await database.execute("INSERT INTO pet_titles(player_pet_id,title_id,equipped) VALUES (?,?,1)", [pet.id, title.id]);
    await database.execute(`CREATE TRIGGER fail_pet_title_sync_audit BEFORE INSERT ON command_audit FOR EACH ROW
      BEGIN IF NEW.action_code='pet_title.sync' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet title sync audit failure'; END IF; END`);
    const eventId = `pet-title-sync-rollback-${Date.now()}`;
    try {
      await assert.rejects(() => new PetTitleSyncService(database).sync({
        idempotencyKey: eventId, sourceEventId: shadowSourceEventId, destinationId: roomId, operatorId: operatorId.toString(),
      }), /forced pet title sync audit failure/);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS fail_pet_title_sync_audit");
    }
    const state = await database.query<Array<{ title_count: bigint; pet_count: bigint; operation_count: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM pet_titles WHERE player_pet_id=?) AS title_count,
        (SELECT COUNT(*) FROM player_pets WHERE id=?) AS pet_count,
        (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count`,
      [pet.id, pet.id, eventId],
    );
    assert.deepEqual(state[0], { title_count: 1n, pet_count: 1n, operation_count: 0n });
  });
});

