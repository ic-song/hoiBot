import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { parsePackageCatalogAdminCommand } from "../src/package/package-catalog-admin-command.js";
import { PackageCatalogAdminService } from "../src/package/package-catalog-admin-service.js";
import { MariaPackageCatalogAdminRepository } from "../src/package/mariadb-package-catalog-admin.js";

const integrationEnabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

describe("package catalog admin Iris MariaDB integration", { skip: !integrationEnabled }, () => {
  let database: DatabaseClient;
  let previousAdminFlag: string | undefined;
  let previousPartialFlag: string | undefined;
  const token = "package-catalog-admin-iris-token";
  const roomId = "990000000000091";
  const externalUserId = "package-catalog-admin-iris-user";
  const loginId = "package-catalog-admin-iris-operator";
  const roleCode = "package-catalog-admin-iris-role";
  const itemId = "ITEM-PACKAGE-ADMIN-IRIS";

  before(async () => {
    previousAdminFlag = process.env.PACKAGE_CATALOG_ADMIN_COMMAND_ENABLED;
    previousPartialFlag = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    process.env.PACKAGE_CATALOG_ADMIN_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    database = await createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 5,
      connectTimeoutMs: 5_000,
    });
    await database.execute(
      `INSERT INTO admin_operators(login_id,display_name,password_hash,status)
       VALUES (?, '패키지 카탈로그 관리자', 'synthetic-not-a-password', 'active')
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='active'`,
      [loginId],
    );
    await database.execute(
      `INSERT INTO admin_roles(code,display_name,active) VALUES (?, '패키지 카탈로그 관리자 역할', 1)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=1`,
      [roleCode],
    );
    const operators = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [loginId]);
    const roles = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code=?", [roleCode]);
    const operatorId = operators[0]!.id;
    const roleId = roles[0]!.id;
    await database.execute("INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) VALUES (?, 'package.catalog.manage')", [roleId]);
    await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?, ?)", [operatorId, roleId]);
    await database.execute(
      "INSERT INTO players(status,version) VALUES ('active',1)",
    );
    const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1");
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status)
       VALUES (?, 'kakao', ?, '패키지 카탈로그 관리자', 'linked')
       ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),display_name=VALUES(display_name),status='linked'`,
      [players[0]!.id, externalUserId],
    );
    const identities = await database.query<Array<{ id: bigint }>>(
      "SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?",
      [externalUserId],
    );
    await database.execute(
      "INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?, ?)",
      [operatorId, identities[0]!.id],
    );
    await database.execute(
      `INSERT INTO package_item_definitions(item_id,item_type,item_name,stackable,metadata_json,enabled,row_version)
       VALUES (?, 'ITEM', '합성 관리자 보상', 1, '{}', 1, 1)
       ON DUPLICATE KEY UPDATE item_name=VALUES(item_name),enabled=1,row_version=row_version+1`,
      [itemId],
    );
  });

  after(async () => {
    process.env.PACKAGE_CATALOG_ADMIN_COMMAND_ENABLED = previousAdminFlag;
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousPartialFlag;
    if (database) {
      try {
        await database.close();
      } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error
          ? (error as { code?: unknown }).code
          : undefined;
        if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
      }
    }
  });

  it("routes an authorized add command through dispatch, mutation, outbox and Iris reply", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const packageName = `PKG-SYNTH-IRIS-${Date.now()}`;
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "package-catalog-admin-iris-pepper",
      DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"),
      DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
      DATABASE_NAME: required("DATABASE_NAME"),
    });
    const app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({
        mode: "operational",
        channelClass: "open_group",
        reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false },
      }),
      sendIrisTextReply: async (reply) => { replies.push(reply); },
    });
    const eventId = `package-catalog-admin-iris-${Date.now()}`;
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: {
        msg: `/패키지추가 ${packageName}|합성 Iris 통합 검증|item:${itemId}:3`,
        room: "고도화패키지테스트방",
        sender: "패키지 카탈로그 관리자",
        json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
      },
    });
    assert.equal(response.statusCode, 202, response.body);
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.room, roomId);
    assert.match(replies[0]?.data ?? "", /패키지.*추가/);
    const packages = await database.query<Array<{ package_id: string }>>(
      "SELECT package_id FROM package_catalog WHERE display_name=? AND deleted_at IS NULL",
      [packageName],
    );
    assert.equal(packages.length, 1);
    const mutations = await database.query<Array<{ request_key: string }>>(
      "SELECT request_key FROM package_catalog_mutations WHERE request_key=?",
      [`iris:${eventId}`],
    );
    assert.equal(mutations.length, 1);
    const outbox = await database.query<Array<{ status: string }>>(
      `SELECT outbox.status FROM package_catalog_mutations mutation
       JOIN outbox_messages outbox ON outbox.operation_id=mutation.operation_id
       WHERE mutation.request_key=? AND mutation.command_code='PACKAGE_CATALOG_ADD'`,
      [`iris:${eventId}`],
    );
    assert.equal(outbox.length, 1);
    assert.equal(outbox[0]?.status, "sent");

    const repository = new MariaPackageCatalogAdminRepository(database);
    const service = new PackageCatalogAdminService(repository);
    const expectedCatalogVersion = (await repository.readSnapshot()).catalogVersion;
    const raceSuffix = Date.now();
    const raceAKey = `package-catalog-admin-race-a-${raceSuffix}`;
    const raceBKey = `package-catalog-admin-race-b-${raceSuffix}`;
    await database.execute(
      `INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,direction,payload_hash,processing_status,received_at)
       VALUES (?, 'synthetic', ?, 'message.created', 'incoming', REPEAT('a',64), 'processed', UTC_TIMESTAMP(3)),
              (?, 'synthetic', ?, 'message.created', 'incoming', REPEAT('b',64), 'processed', UTC_TIMESTAMP(3))`,
      [raceAKey, raceAKey, raceBKey, raceBKey],
    );
    const raceOperators = await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id=?", [loginId]);
    const raceOperatorId = raceOperators[0]!.id.toString();
    const concurrentResults = await Promise.allSettled([
      service.execute({
        command: parsePackageCatalogAdminCommand(`/패키지추가 PKG-SYNTH-RACE-A-${raceSuffix}|합성 경쟁 검증 A|item:${itemId}:1` )!,
        requestKey: raceAKey,
        actorOperatorId: raceOperatorId,
        expectedCatalogVersion,
      }),
      service.execute({
        command: parsePackageCatalogAdminCommand(`/패키지추가 PKG-SYNTH-RACE-B-${raceSuffix}|합성 경쟁 검증 B|item:${itemId}:1` )!,
        requestKey: raceBKey,
        actorOperatorId: raceOperatorId,
        expectedCatalogVersion,
      }),
    ]);
    assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(concurrentResults.filter((result) => result.status === "rejected").length, 1);
    const rejected = concurrentResults.find((result) => result.status === "rejected");
    assert.equal(rejected?.status === "rejected" && (rejected.reason as { code?: string }).code, "PACKAGE_CATALOG_VERSION_CONFLICT");
    await app.close();
  });
});
