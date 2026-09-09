import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000003";
const externalUserId = "990000000000003";
const roomId = "990000000000098";
const token = "package-resilience-token";
let database: DatabaseClient;
let app: ReturnType<typeof buildApp>;
let failDelivery = false;
const replies: Array<{ room: string; data: string }> = [];

async function setPackageQuantity(quantity: number): Promise<void> {
  await database.execute(
    `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
     SELECT ?,id,?,1 FROM item_definitions WHERE code='ITEM-PACKAGE-209'
     ON DUPLICATE KEY UPDATE
       inventory_stacks.quantity=VALUES(quantity),
       inventory_stacks.version=inventory_stacks.version+1`,
    [playerId, quantity],
  );
}

async function send(message: string, eventId: string) {
  return app.inject({
    method: "POST",
    url: `/api/v1/integrations/iris/events?token=${token}`,
    payload: {
      msg: message,
      room: "고도화패키지테스트방",
      sender: "패키지복원테스터",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
    },
  });
}

(configured ? describe : describe.skip)("package MariaDB resilience parity", () => {
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
      connectionLimit: 5,
      connectTimeoutMs: 5_000,
    });
    await database.execute(
      `INSERT INTO players(id,status,version,created_at,updated_at)
       VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status='active',updated_at=UTC_TIMESTAMP(3)`,
      [playerId],
    );
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status,created_at,updated_at)
       VALUES (?, 'kakao', ?, '패키지복원테스터', 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),display_name=VALUES(display_name),status='linked',updated_at=UTC_TIMESTAMP(3)`,
      [playerId, externalUserId],
    );
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=1 WHERE package_id='PKG-209'");
    await database.execute(
      `UPDATE package_item_definitions SET enabled=1
       WHERE item_id='ITEM-PACKAGE-209'
          OR item_id IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    await database.execute(
      `UPDATE item_definitions SET active=1
       WHERE code='ITEM-PACKAGE-209'
          OR code IN (SELECT item_id FROM package_reward_rules WHERE package_id='PKG-209' AND item_id IS NOT NULL)`,
    );
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "package-resilience-pepper",
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
      sendIrisTextReply: async (reply) => {
        if (failDelivery) throw new Error("SYNTHETIC_IRIS_DELIVERY_FAILURE");
        replies.push(reply);
      },
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

  it("excludes a disabled package from the compact bag projection", async () => {
    await setPackageQuantity(1);
    const disabled = await database.query<Array<{ consume_item_id: string; display_name: string }>>(
      "SELECT consume_item_id,display_name FROM package_catalog WHERE package_id='PKG-210'",
    );
    assert.ok(disabled[0]);
    await database.execute("UPDATE package_catalog SET definition_status='READY',enabled=0 WHERE package_id='PKG-210'");
    await database.execute("UPDATE item_definitions SET active=1 WHERE code=?", [disabled[0].consume_item_id]);
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,1,1 FROM item_definitions WHERE code=?
       ON DUPLICATE KEY UPDATE inventory_stacks.quantity=1,inventory_stacks.version=inventory_stacks.version+1`,
      [playerId, disabled[0].consume_item_id],
    );
    const replyStart = replies.length;
    const response = await send("/패키지가방", `package-disabled-${Date.now()}`);
    assert.equal(response.statusCode, 202);
    assert.equal(replies.length, replyStart + 1);
    assert.equal((replies.at(-1)?.data ?? "").includes(disabled[0].display_name), false);
  });

  it("commits one reward when two requests race for one package", async () => {
    await setPackageQuantity(1);
    const prefix = `package-race-${Date.now()}`;
    const responses = await Promise.all([
      send("/패키지사용 1 1", `${prefix}-a`),
      send("/패키지사용 1 1", `${prefix}-b`),
    ]);
    assert.equal(responses.filter((response) => response.statusCode === 202).length, 1);
    assert.equal(responses.filter((response) => response.statusCode >= 400).length, 1);
    const balance = await database.query<Array<{ quantity: bigint }>>(
      `SELECT inventory_stacks.quantity FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE inventory_stacks.player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`,
      [playerId],
    );
    const committed = await database.query<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM package_domain_uses
       WHERE request_key IN (?, ?) AND status='COMMITTED'`,
      [`iris:iris:${prefix}-a:package`, `iris:iris:${prefix}-b:package`],
    );
    assert.equal(balance[0]?.quantity, 0n);
    assert.equal(committed[0]?.count, 1n);
  });

  it("keeps a committed use and marks outbox failure when Iris delivery fails", async () => {
    await setPackageQuantity(1);
    failDelivery = true;
    const eventId = `package-delivery-failure-${Date.now()}`;
    const response = await send("/패키지사용 1 1", eventId);
    failDelivery = false;
    assert.equal(response.statusCode, 202);
    const requestKey = `iris:iris:${eventId}:package`;
    const uses = await database.query<Array<{ status: string }>>(
      "SELECT status FROM package_domain_uses WHERE request_key=?",
      [requestKey],
    );
    const outbox = await database.query<Array<{ status: string; attempt_count: number; last_error_code: string | null }>>(
      `SELECT status,attempt_count,last_error_code FROM outbox_messages
       WHERE destination_id=? ORDER BY id DESC LIMIT 1`,
      [roomId],
    );
    assert.equal(uses[0]?.status, "COMMITTED");
    assert.equal(outbox[0]?.status, "failed");
    assert.equal(outbox[0]?.attempt_count, 1);
    assert.ok(outbox[0]?.last_error_code);
  });
});
