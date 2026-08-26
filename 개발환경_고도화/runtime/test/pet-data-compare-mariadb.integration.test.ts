import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { PetDataCompareService } from "../src/admin/pet-data-compare-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("pet data compare MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const suffix = `${process.pid}-${Date.now()}`;
  const token = "pet-data-compare-token";
  const roomId = "990000000000449";
  const operatorExternalId = `pet-data-compare-operator-${suffix}`;
  let operatorId = 0n;
  let shadowSourceEventId = "";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='ADMIN_PET_DATA_COMPARE'");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES (?,'호이 남','synthetic','active')", [`pet-compare-op-${suffix}`]);
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [`pet-compare-op-${suffix}`]))[0]!;
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
    const memberOnly = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'비교 전용 회원',1)", [memberOnly.id]);
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

  const appConfig = () => loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "pet-compare-pepper",
    DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
    DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });

  it("queues both current database counts once for a repeated Iris event", async () => {
    const expected = (await database.query<Array<{ member_count: bigint; pet_count: bigint }>>(
      "SELECT (SELECT COUNT(*) FROM player_profiles) AS member_count,(SELECT COUNT(*) FROM player_pets) AS pet_count",
    ))[0]!;
    const replies: string[] = [];
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply.data); } });
    const eventId = `pet-compare-${Date.now()}`;
    const send = () => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫데이터비교", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    const first = await send();
    assert.equal(first.statusCode, 202, first.body);
    await send();
    assert.deepEqual(replies, [
      `member.json 회원 수=> ${expected.member_count}`,
      `member_pet.json 회원 수 => ${expected.pet_count}`,
    ]);
    const operations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${eventId}`]);
    assert.equal(Number(operations[0]!.count), 1);
  });

  it("keeps Shadow comparison free of operations and outbox", async () => {
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='ADMIN_PET_DATA_COMPARE'");
    const app = buildApp(appConfig(), { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => undefined });
    const eventId = `pet-compare-shadow-${Date.now()}`;
    shadowSourceEventId = `iris:${eventId}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/펫데이터비교", room: "고도화팻테스트방", sender: "호이 남",
      json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    const operation = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM operations WHERE idempotency_key=?", [`iris:${eventId}`]);
    assert.equal(Number(operation[0]!.count), 0);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
  });

  it("rolls back both replies and operation when audit persistence fails", async () => {
    await database.execute(`CREATE TRIGGER fail_pet_data_compare_audit BEFORE INSERT ON command_audit FOR EACH ROW
      BEGIN IF NEW.action_code='pet_data.compare' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced pet compare audit failure'; END IF; END`);
    const eventId = `pet-compare-rollback-${Date.now()}`;
    try {
      await assert.rejects(() => new PetDataCompareService(database).compare({
        idempotencyKey: eventId, sourceEventId: shadowSourceEventId, destinationId: roomId, operatorId: operatorId.toString(),
      }), /forced pet compare audit failure/);
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS fail_pet_data_compare_audit");
    }
    const state = (await database.query<Array<{ operation_count: bigint; outbox_count: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM operations WHERE idempotency_key=?) AS operation_count,
        (SELECT COUNT(*) FROM outbox_messages outbox JOIN operations operation ON operation.id=outbox.operation_id
          WHERE operation.idempotency_key=?) AS outbox_count`, [eventId, eventId],
    ))[0]!;
    assert.deepEqual(state, { operation_count: 0n, outbox_count: 0n });
  });
});
