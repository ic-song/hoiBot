import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("comment delete MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  let playerId: bigint;
  const token = "comment-delete-token";
  const roomId = "990000000000431";
  const externalUserId = `comment-delete-player-${Date.now()}`;

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_COMMENT_DELETE'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    playerId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 홈주인',1)", [playerId]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,'합성 홈',1)", [playerId]);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,starts_at) VALUES (?,'beginner',1,1,UTC_TIMESTAMP(3))", [playerId]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 홈주인','linked')", [playerId,externalUserId]);
    for (let index = 1; index <= 3; index += 1) {
      await database.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status,created_at) VALUES (?,?,?,'visible',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? SECOND))", [playerId,playerId,`합성 댓글 ${index}`,index]);
    }
    process.env.COMMENT_DELETE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.COMMENT_DELETE_COMMAND_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  const createApp = (sendIrisTextReply: (reply: { room: string; data: string }) => Promise<void>) => {
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "comment-delete-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    return buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply });
  };

  it("returns the guide without mutation", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = createApp(async (reply) => { replies.push(reply); });
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/댓글삭제", room: "고도화댓글테스트방", sender: "합성 홈주인",
      json: { _id: `comment-guide-${Date.now()}`, chat_id: roomId, user_id: externalUserId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    assert.match(replies.at(-1)?.data ?? "", /\/댓글삭제 \[번호\]/);
  });

  it("deletes newest number two once and preserves an idempotent result", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const app = createApp(async (reply) => { replies.push(reply); });
    const eventId = `comment-remove-${Date.now()}`;
    const payload = { msg: "/댓글삭제 2", room: "고도화댓글테스트방", sender: "합성 홈주인",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId } };
    const first = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    const second = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload });
    assert.equal(first.statusCode, 202, first.body);
    assert.equal(second.statusCode, 202, second.body);
    assert.match(replies[0]?.data ?? "", /합성 댓글 2/);
    const comments = await database.query<Array<{ body: string; status: string; deleted: number }>>(
      "SELECT body,status,deleted_at IS NOT NULL AS deleted FROM home_comments WHERE home_player_id=? ORDER BY id", [playerId],
    );
    assert.deepEqual(comments, [
      { body: "합성 댓글 1", status: "visible", deleted: 0 },
      { body: "합성 댓글 2", status: "deleted", deleted: 1 },
      { body: "합성 댓글 3", status: "visible", deleted: 0 },
    ]);
    const evidence = await database.query<Array<{ mutations: bigint; audits: bigint; outbox: bigint }>>(
      `SELECT
        (SELECT COUNT(*) FROM home_comment_delete_mutations WHERE request_key=?) AS mutations,
        (SELECT COUNT(*) FROM command_audit audit
         JOIN home_comment_delete_mutations mutation ON mutation.operation_id=audit.operation_id
         WHERE mutation.request_key=? AND audit.action_code='HOME_COMMENT_DELETE') AS audits,
        (SELECT COUNT(*) FROM outbox_messages outbox
         JOIN home_comment_delete_mutations mutation ON mutation.operation_id=outbox.operation_id
         WHERE mutation.request_key=?) AS outbox`,
      [`iris:${eventId}`, `iris:${eventId}`, `iris:${eventId}`],
    );
    assert.equal(Number(evidence[0]!.mutations), 1);
    assert.equal(Number(evidence[0]!.audits), 1);
    assert.equal(Number(evidence[0]!.outbox), 1);
  });

  it("rolls comment, operation, audit and mutation back when outbox insert fails", async () => {
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE' WHERE command_code='HOME_COMMENT_DELETE'");
    await database.execute(
      "INSERT INTO home_comments(home_player_id,author_player_id,body,status,created_at) VALUES (?,?,'합성 롤백 댓글','visible',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND))",
      [playerId, playerId],
    );
    const target = (await database.query<Array<{ id: bigint }>>(
      "SELECT id FROM home_comments WHERE home_player_id=? AND body='합성 롤백 댓글' ORDER BY id DESC LIMIT 1", [playerId],
    ))[0]!;
    await database.execute(
      "CREATE TRIGGER trg_comment_delete_outbox_fail BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic outbox failure'",
    );
    const app = createApp(async () => undefined);
    const eventId = `comment-rollback-${Date.now()}`;
    try {
      const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
        msg: "/댓글삭제 1", room: "고도화댓글테스트방", sender: "합성 홈주인",
        json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
      } });
      assert.equal(response.statusCode, 500, response.body);
      const rollback = (await database.query<Array<{ status: string; deleted: number; mutations: bigint; audits: bigint }>>(
        `SELECT comment.status,comment.deleted_at IS NOT NULL AS deleted,
          (SELECT COUNT(*) FROM home_comment_delete_mutations WHERE request_key=?) AS mutations,
          (SELECT COUNT(*) FROM command_audit WHERE action_code='HOME_COMMENT_DELETE' AND target_id=?) AS audits
         FROM home_comments comment WHERE comment.id=?`,
        [`iris:${eventId}`, target.id.toString(), target.id],
      ))[0]!;
      assert.deepEqual(rollback, { status: "visible", deleted: 0, mutations: 0n, audits: 0n });
    } finally {
      await database.execute("DROP TRIGGER IF EXISTS trg_comment_delete_outbox_fail");
    }
  });

  it("keeps Shadow deletion mutation-free", async () => {
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_COMMENT_DELETE'");
    const beforeVisible = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM home_comments WHERE home_player_id=? AND status='visible'", [playerId]);
    const app = createApp(async () => undefined);
    const eventId = `comment-shadow-${Date.now()}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/댓글삭제 1", room: "고도화댓글테스트방", sender: "합성 홈주인",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    const visible = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM home_comments WHERE home_player_id=? AND status='visible'", [playerId]);
    assert.equal(visible[0]!.count, beforeVisible[0]!.count);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
