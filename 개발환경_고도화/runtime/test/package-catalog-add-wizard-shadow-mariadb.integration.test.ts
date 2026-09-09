import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]))
  && process.env.PACKAGE_CATALOG_WIZARD_SHADOW_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "shadow-test-not-configured";
let database: DatabaseClient;
let app: ReturnType<typeof buildApp>;
const replies: Array<{ room: string; data: string }> = [];
const externalUserId = "package-wizard-shadow-user";
const roomId = "990000000000213";
const token = "package-wizard-shadow-token";

(configured ? describe : describe.skip)("package catalog add wizard MariaDB Shadow routing", () => {
  before(async () => {
    process.env.PACKAGE_CATALOG_WIZARD_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 3, connectTimeoutMs: 5_000 });
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const players = await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1");
    await database.execute(
      `INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status)
       VALUES (?,'kakao',?,'패키지마법사Shadow테스터','linked')
       ON DUPLICATE KEY UPDATE player_id=VALUES(player_id),status='linked'`,
      [players[0]!.id, externalUserId],
    );
    await database.execute(
      `UPDATE command_registry SET rollout_state='SHADOW'
       WHERE command_code IN ('PACKAGE_CATALOG_WIZARD_GUIDE','PACKAGE_CATALOG_WIZARD_START','PACKAGE_CATALOG_WIZARD_CANCEL','PACKAGE_CATALOG_WIZARD_STATUS')`,
    );
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "package-wizard-shadow-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"), DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    app = buildApp(config, {
      database,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async (reply) => { replies.push(reply); },
    });
  });

  after(async () => {
    try {
      await database.execute(
        `UPDATE command_registry SET rollout_state='CANARY'
         WHERE command_code IN ('PACKAGE_CATALOG_WIZARD_GUIDE','PACKAGE_CATALOG_WIZARD_START','PACKAGE_CATALOG_WIZARD_CANCEL','PACKAGE_CATALOG_WIZARD_STATUS')`,
      );
      await app.close();
    } finally {
      try { await database.close(); } catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
        if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
      }
    }
  });

  it("records Shadow without creating a session, result, outbox or reply", async () => {
    const before = await database.query<Array<{ sessions: bigint; results: bigint; outbox: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM package_catalog_wizard_sessions) AS sessions,
       (SELECT COUNT(*) FROM package_catalog_wizard_results) AS results,
       (SELECT COUNT(*) FROM outbox_messages) AS outbox`,
    );
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg: "/패키지추가시작", room: "고도화패키지Shadow방", sender: "패키지마법사Shadow테스터", json: { _id: `package-wizard-shadow-${Date.now()}`, chat_id: roomId, user_id: externalUserId } },
    });
    const afterCounts = await database.query<Array<{ sessions: bigint; results: bigint; outbox: bigint }>>(
      `SELECT (SELECT COUNT(*) FROM package_catalog_wizard_sessions) AS sessions,
       (SELECT COUNT(*) FROM package_catalog_wizard_results) AS results,
       (SELECT COUNT(*) FROM outbox_messages) AS outbox`,
    );
    const routes = await database.query<Array<{ route: string }>>(
      "SELECT route FROM command_routing_decisions WHERE command_code='PACKAGE_CATALOG_WIZARD_START' ORDER BY routing_decision_id DESC LIMIT 1",
    );
    assert.equal(response.statusCode, 202);
    assert.equal(routes[0]?.route, "SHADOW");
    assert.deepEqual(afterCounts[0], before[0]);
    assert.equal(replies.length, 0);
  });
});
