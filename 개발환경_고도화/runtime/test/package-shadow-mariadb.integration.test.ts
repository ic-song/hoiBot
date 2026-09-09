import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]))
  && process.env.PACKAGE_SHADOW_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "shadow-test-not-configured";
const playerId = "900000004";
const externalUserId = "990000000000004";
const roomId = "990000000000097";
const token = "package-shadow-token";
let database: DatabaseClient;
let app: ReturnType<typeof buildApp>;
const replies: Array<{ room: string; data: string }> = [];

(configured ? describe : describe.skip)("package MariaDB Shadow routing", () => {
  before(async () => {
    process.env.PACKAGE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 3,
      connectTimeoutMs: 5_000,
    });
    await database.execute(
      `INSERT INTO players(id,status,version,created_at,updated_at)
       VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [playerId],
    );
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status,created_at,updated_at)
       VALUES (?, 'kakao', ?, '패키지Shadow테스터', 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [playerId, externalUserId],
    );
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code IN ('PACKAGE_BAG','PACKAGE_USE')");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code='ITEM-PACKAGE-209'");
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,2,1 FROM item_definitions WHERE code='ITEM-PACKAGE-209'`,
      [playerId],
    );
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "package-shadow-pepper",
      DATABASE_ENABLED: "true",
      DATABASE_HOST: required("DATABASE_HOST"),
      DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"),
      DATABASE_PASSWORD: required("DATABASE_PASSWORD"),
      DATABASE_NAME: required("DATABASE_NAME"),
    });
    app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({
        mode: "operational",
        channelClass: "open_group",
        reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false },
      }),
      sendIrisTextReply: async (reply) => { replies.push(reply); },
    });
  });

  after(async () => {
    try {
      await app.close();
    } finally {
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

  it("records a Shadow route without package, outbox or reply mutation", async () => {
    const eventId = `package-shadow-${Date.now()}`;
    const beforeUse = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM package_domain_uses");
    const beforeOutbox = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM outbox_messages");
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: {
        msg: "/패키지사용 1 1",
        room: "고도화패키지Shadow방",
        sender: "패키지Shadow테스터",
        json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
      },
    });
    const balance = await database.query<Array<{ quantity: bigint }>>(
      `SELECT inventory_stacks.quantity FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE inventory_stacks.player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`,
      [playerId],
    );
    const afterUse = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM package_domain_uses");
    const afterOutbox = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM outbox_messages");
    const routes = await database.query<Array<{ route: string; reason_code: string }>>(
      `SELECT route,reason_code FROM command_routing_decisions
       WHERE command_code='PACKAGE_USE' ORDER BY routing_decision_id DESC LIMIT 1`,
    );
    assert.equal(response.statusCode, 202);
    assert.equal(routes[0]?.route, "SHADOW");
    assert.equal(balance[0]?.quantity, 2n);
    assert.equal(afterUse[0]?.count, beforeUse[0]?.count);
    assert.equal(afterOutbox[0]?.count, beforeOutbox[0]?.count);
    assert.equal(replies.length, 0);
  });
});
