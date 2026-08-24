import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
const playerId = "900000002";
const externalUserId = "990000000000002";
const roomId = "990000000000099";
const token = "package-iris-integration-token";
let database: DatabaseClient;
let previousPackageFlag: string | undefined;
let previousPartialFlag: string | undefined;

(configured ? describe : describe.skip)("package Iris MariaDB integration", () => {
  before(async () => {
    previousPackageFlag = process.env.PACKAGE_COMMAND_ENABLED;
    previousPartialFlag = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
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
       VALUES (?, 'active', 1, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
       ON DUPLICATE KEY UPDATE status='active',updated_at=UTC_TIMESTAMP(3)`,
      [playerId],
    );
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status,created_at,updated_at)
       VALUES (?, 'kakao', ?, '패키지테스터', 'linked', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
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
    await database.execute(
      `INSERT INTO inventory_stacks(player_id,item_id,quantity,version)
       SELECT ?,id,2,1 FROM item_definitions WHERE code='ITEM-PACKAGE-209'
       ON DUPLICATE KEY UPDATE
         inventory_stacks.quantity=2,
         inventory_stacks.version=inventory_stacks.version+1`,
      [playerId],
    );
  });

  after(async () => {
    process.env.PACKAGE_COMMAND_ENABLED = previousPackageFlag;
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousPartialFlag;
    try {
      await database.close();
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error
        ? (error as { code?: unknown }).code
        : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("routes package bag and use commands through Iris, dispatch and outbox", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({
      NODE_ENV: "test",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "package-iris-verification-pepper",
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
    const eventPrefix = `package-iris-${Date.now()}`;
    const bag = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: {
        msg: "/패키지가방",
        room: "고도화패키지테스트방",
        sender: "패키지테스터",
        json: { _id: `${eventPrefix}-bag`, chat_id: roomId, user_id: externalUserId },
      },
    });
    const used = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: {
        msg: "/패키지사용 1 1",
        room: "고도화패키지테스트방",
        sender: "패키지테스터",
        json: { _id: `${eventPrefix}-use`, chat_id: roomId, user_id: externalUserId },
      },
    });
    assert.equal(bag.statusCode, 202);
    assert.equal(used.statusCode, 202);
    assert.equal(replies.length, 2);
    assert.equal(replies[0]?.room, roomId);
    assert.match(replies[0]?.data ?? "", /📦 패키지가방/);
    assert.match(replies[0]?.data ?? "", /💠루비 상자/);
    assert.match(replies[1]?.data ?? "", /💠루비 상자.*1개를 사용/);
    assert.match(replies[1]?.data ?? "", /캐슬코인🥇 120개/);
    const balance = await database.query<Array<{ quantity: bigint }>>(
      `SELECT inventory_stacks.quantity FROM inventory_stacks
       JOIN item_definitions ON item_definitions.id=inventory_stacks.item_id
       WHERE inventory_stacks.player_id=? AND item_definitions.code='ITEM-PACKAGE-209'`,
      [playerId],
    );
    assert.equal(balance[0]?.quantity, 1n);
    await app.close();
  });
});
