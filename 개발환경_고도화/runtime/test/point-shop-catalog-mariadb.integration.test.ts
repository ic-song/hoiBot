import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("point shop catalog MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "point-shop-catalog-token";
  const roomId = "990000000000408";
  const operatorExternalId = "point-shop-catalog-operator";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code LIKE 'POINT_SHOP_CATALOG_%'");
    await database.execute("INSERT INTO castle_state(state_code,tax_rate_basis_points,lord_guild_name,version) VALUES ('HOI_CASTLE',1250,'합성성주길드',1) ON DUPLICATE KEY UPDATE tax_rate_basis_points=1250,lord_guild_name='합성성주길드'");
    await database.execute("INSERT INTO point_shop_catalog(product_id,product_key,display_name,price,display_order,catalog_version,enabled,row_version) VALUES ('PS-FIXTURE-1','POINT-SHOP-FIXTURE-1','합성기존상품',1000,1,1,1,1) ON DUPLICATE KEY UPDATE enabled=1,deleted_at=NULL,display_order=1,price=1000");
    await database.execute("INSERT INTO admin_operators(login_id,display_name,password_hash,status) VALUES ('point-shop-op','상점 관리자','synthetic','active') ON DUPLICATE KEY UPDATE status='active'");
    await database.execute("INSERT INTO admin_roles(code,display_name,active) VALUES ('point-shop-role','상점 역할',1) ON DUPLICATE KEY UPDATE active=1");
    const operator = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_operators WHERE login_id='point-shop-op'"))[0]!;
    const role = (await database.query<Array<{ id: bigint }>>("SELECT id FROM admin_roles WHERE code='point-shop-role'"))[0]!;
    await database.execute("INSERT IGNORE INTO admin_role_permissions(role_id,permission_code) VALUES (?,'point_shop.catalog.manage')", [role.id]);
    await database.execute("INSERT IGNORE INTO admin_operator_roles(operator_id,role_id) VALUES (?,?)", [operator.id,role.id]);
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'상점 관리자','linked') ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status='linked'", [player.id,operatorExternalId]);
    const identity = (await database.query<Array<{ id: bigint }>>("SELECT id FROM external_identities WHERE provider_code='kakao' AND external_user_id=?", [operatorExternalId]))[0]!;
    await database.execute("INSERT IGNORE INTO admin_operator_external_identities(operator_id,external_identity_id) VALUES (?,?)", [operator.id,identity.id]);
    process.env.POINT_SHOP_CATALOG_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.POINT_SHOP_CATALOG_COMMAND_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("reads, upserts, replays and removes by stable identity", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "point-shop-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화포인트상점테스트방", sender: "상점 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } } });
    assert.equal((await send(`shop-read-${Date.now()}`, "/상점")).statusCode, 202);
    assert.match(replies.at(-1)?.data ?? "", /합성기존상품/);
    assert.match(replies.at(-1)?.data ?? "", /합성성주길드/);
    const upsertEvent = `shop-upsert-${Date.now()}`;
    const upsertResponse = await send(upsertEvent, "/상점추가 합성 신규 상품 2500");
    assert.equal(upsertResponse.statusCode, 202, upsertResponse.body);
    await send(upsertEvent, "/상점추가 합성 신규 상품 2500");
    const mutations = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM point_shop_catalog_mutations WHERE request_key=?", [`iris:${upsertEvent}`]);
    assert.equal(Number(mutations[0]!.count), 1);
    const snapshot = await database.query<Array<{ product_id: string; display_order: number }>>("SELECT product_id,display_order FROM point_shop_catalog WHERE display_name='합성 신규 상품' AND deleted_at IS NULL");
    assert.equal(snapshot.length, 1);
    const removeEvent = `shop-remove-${Date.now()}`;
    assert.equal((await send(removeEvent, `/상점삭제 ${snapshot[0]!.display_order}`)).statusCode, 202);
    await send(removeEvent, `/상점삭제 ${snapshot[0]!.display_order}`);
    const removed = await database.query<Array<{ deleted: number }>>("SELECT deleted_at IS NOT NULL AS deleted FROM point_shop_catalog WHERE product_id=?", [snapshot[0]!.product_id]);
    assert.equal(removed[0]?.deleted, 1);
    const fixture = await database.query<Array<{ enabled: number }>>("SELECT enabled FROM point_shop_catalog WHERE product_id='PS-FIXTURE-1'");
    assert.equal(fixture[0]?.enabled, 1);
  });

  it("records Shadow routing without mutating the catalog", async () => {
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='POINT_SHOP_CATALOG_UPSERT'");
    const before = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM point_shop_catalog WHERE display_name='Shadow 상품'");
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "point-shop-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => undefined });
    const eventId = `shop-shadow-${Date.now()}`;
    await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: { msg: "/상점추가 Shadow 상품 1", room: "고도화포인트상점테스트방", sender: "상점 관리자", json: { _id: eventId, chat_id: roomId, user_id: operatorExternalId } } });
    const afterRows = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM point_shop_catalog WHERE display_name='Shadow 상품'");
    assert.equal(afterRows[0]?.count, before[0]?.count);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
