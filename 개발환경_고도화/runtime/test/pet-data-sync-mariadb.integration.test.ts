import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetDataSyncService } from "../src/admin/pet-data-sync-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("pet data sync MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = `${process.pid}-${Date.now()}`;
  const token = "pet-data-sync-token";
  const roomId = "990000000000447";
  const operatorExternalId = `pet-data-sync-operator-${suffix}`;
  let activePetId = 0n;
  let inactivePetId = 0n;
  let operatorId = 0n;
  let shadowSourceEventId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_PET_DATA_SYNC'");
    await database.execute("UPDATE players player JOIN player_pets pet ON pet.player_id=player.id SET player.status='active' WHERE player.status<>'active'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')", [`pet-sync-op-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pet-sync-op-${suffix}`]))[0]!;
    operatorId = operator.id;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='super_admin'"))[0]!;
    await database.execute("INSERT INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id, role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const operatorPlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'호이 남',1)", [operatorPlayer.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'호이 남','linked')", [operatorPlayer.id, operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id, identity.id]);

    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const activePlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'활성 회원',1)", [activePlayer.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'활성 펫',1)", [activePlayer.id]);
    activePetId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [activePlayer.id]))[0]!.id;

    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const inactivePlayer = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'탈퇴 회원',1)", [inactivePlayer.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'정리 펫',1)", [inactivePlayer.id]);
    const inactivePet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [inactivePlayer.id]))[0]!;
    inactivePetId = inactivePet.id;
    await database.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,version) VALUES (?,'정리 정령','synthetic','합성',1)", [inactivePet.id]);
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

  const appConfig = () => loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "pet-sync-pepper",
    DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });

  it("removes an inactive member pet once and preserves the active member pet", async () => {
    const replies: string[] = [];
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });
    const eventId = `pet-sync-${Date.now()}`;
    const send = () => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫데이터동기화", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    const first = await send();
    assert.equal(first.statusCode, 202, first.body);
    await send();
    assert.match(replies.at(-1) ?? "", /펫데이터 동기화완료 \(1\)/);
    assert.equal((replies.at(-1)?.match(/\u200b/g) ?? []).length, 500);
    assert.equal(replies.at(-1)?.endsWith("탈퇴 회원"), true);
    const pets = await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE id IN (?,?) ORDER BY id", [activePetId, inactivePetId]);
    assert.deepEqual(pets.map((row) => row.id.toString()), [activePetId.toString()]);
    const elementals = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_pet_elementals WHERE player_pet_id=?", [inactivePetId]);
    assert.equal(Number(elementals[0]!.count), 0);
    const operations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${eventId}`]);
    assert.equal(Number(operations[0]!.count), 1);
  });

  it("keeps an inactive pet mutation-free under Shadow", async () => {
    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'Shadow 탈퇴 회원',1)", [player.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'Shadow 펫',1)", [player.id]);
    const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_PET_DATA_SYNC'");
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => undefined });
    const eventId = `pet-sync-shadow-${Date.now()}`;
    shadowSourceEventId = `iris:${eventId}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫데이터동기화", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    const retained = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM player_pets WHERE id=?", [pet.id]);
    assert.equal(Number(retained[0]!.count), 1);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
  });

  it("rolls back every pet deletion when audit persistence fails", async () => {
    await database.execute("INSERT INTO players(status,version) VALUES ('inactive',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'Rollback 탈퇴 회원',1)", [player.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'Rollback 펫',1)", [player.id]);
    const pet = (await database.query<Array<{ id: bigint }>>("SELECT id FROM player_pets WHERE player_id=?", [player.id]))[0]!;
    await database.execute("INSERT INTO player_pet_elementals(player_pet_id,display_name,grade_code,grade_display_name,version) VALUES (?,'Rollback 정령','synthetic','합성',1)", [pet.id]);
    await database.execute(`CREATE TRIGGER fail_pet_data_sync_audit BEFORE INSERT ON command_audit FOR EACH ROW
      BEGIN IF NEW.action_code='pet_data.sync' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet sync audit failure'; END IF; END`);
    const eventId = `pet-sync-rollback-${Date.now()}`;
    try {
      await assert.rejects(() => new PetDataSyncService(database).sync({
        idempotencyKey: eventId, sourceEventId: shadowSourceEventId, destinationId: roomId, operatorId: operatorId.toString(),
      }), /forced pet sync audit failure/);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS fail_pet_data_sync_audit");
    }
    const state = await database.query<Array<{ pet_count: bigint; elemental_count: bigint; operation_count: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM player_pets WHERE id=?) AS pet_count,
        (SELECT COUNT(*) FROM player_pet_elementals WHERE player_pet_id=?) AS elemental_count,
        (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count`,
      [pet.id, pet.id, eventId],
    );
    assert.deepEqual(state[0], { pet_count: 1n, elemental_count: 1n, operation_count: 0n });
  });
});
