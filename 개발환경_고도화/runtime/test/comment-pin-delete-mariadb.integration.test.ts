import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("comment pin delete MariaDB integration", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const token = "comment-pin-delete-token";
  const roomId = "990000000000430";
  const externalUserId = "comment-pin-delete-player";

  before(async () => {
    database = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 5, connectTimeoutMs: 5_000 });
    await database.execute("UPDATE command_registry SET rollout_state='ACTIVE',enabled=1 WHERE command_code='HOME_COMMENT_PIN_DELETE'");
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'합성 홈주인',1)", [player.id]);
    await database.execute("INSERT INTO player_homes(player_id,display_name,version) VALUES (?,'합성 홈',1)", [player.id]);
    await database.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES (?,'합성 펫',1)", [player.id]);
    await database.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent,starts_at) VALUES (?,'beginner',1,1,UTC_TIMESTAMP(3))", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'합성 홈주인','linked')", [player.id,externalUserId]);
    for (let index = 1; index <= 3; index += 1) {
      await database.execute("INSERT INTO home_comments(home_player_id,author_player_id,body,status) VALUES (?,? ,?,'visible')", [player.id,player.id,`합성 핀 ${index}`]);
      const comment = (await database.query<Array<{ id: bigint }>>("SELECT id FROM home_comments WHERE home_player_id=? ORDER BY id DESC LIMIT 1", [player.id]))[0]!;
      await database.execute("INSERT INTO home_comment_pins(pin_id,home_player_id,comment_id,display_order) VALUES (?,?,?,?)", [`PIN-FIXTURE-${index}`,player.id,comment.id,index]);
    }
    process.env.COMMENT_PIN_DELETE_COMMAND_ENABLED = "true";
    process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  });

  after(async () => {
    delete process.env.COMMENT_PIN_DELETE_COMMAND_ENABLED;
    if (!database) return;
    try { await database.close(); } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code !== "ER_POOL_ALREADY_CLOSED") throw error;
    }
  });

  it("returns the guide and deletes one stable pin once", async () => {
    const replies: Array<{ room: string; data: string }> = [];
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "comment-pin-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async (reply) => { replies.push(reply); } });
    const send = async (eventId: string, msg: string) => app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
      payload: { msg, room: "고도화댓글핀테스트방", sender: "합성 홈주인", json: { _id: eventId, chat_id: roomId, user_id: externalUserId } } });
    const guide = await send(`pin-guide-${Date.now()}`, "/댓글핀삭제");
    assert.equal(guide.statusCode, 202, guide.body);
    assert.match(replies.at(-1)?.data ?? "", /\[번호\]/);
    const eventId = `pin-remove-${Date.now()}`;
    const first = await send(eventId, "/댓글핀삭제 2");
    assert.equal(first.statusCode, 202, first.body);
    await send(eventId, "/댓글핀삭제 2");
    const pins = await database.query<Array<{ pin_id: string; display_order: number; deleted: number }>>(
      "SELECT pin_id,display_order,deleted_at IS NOT NULL AS deleted FROM home_comment_pins ORDER BY pin_id",
    );
    assert.deepEqual(pins, [
      { pin_id: "PIN-FIXTURE-1", display_order: 1, deleted: 0 },
      { pin_id: "PIN-FIXTURE-2", display_order: 2, deleted: 1 },
      { pin_id: "PIN-FIXTURE-3", display_order: 2, deleted: 0 },
    ]);
    const mutations = await database.query<Array<{ count: bigint }>>(
      "SELECT COUNT(*) AS count FROM home_comment_pin_delete_mutations WHERE request_key=?",
      [`iris:${eventId}`],
    );
    assert.equal(Number(mutations[0]!.count), 1);
  });

  it("keeps Shadow deletion mutation-free", async () => {
    await database.execute("UPDATE command_registry SET rollout_state='SHADOW' WHERE command_code='HOME_COMMENT_PIN_DELETE'");
    const config = loadConfig({ NODE_ENV: "test", IRIS_SHARED_TOKEN: token, USER_VERIFICATION_PEPPER: "comment-pin-pepper",
      DATABASE_ENABLED: "true", DATABASE_HOST: required("DATABASE_HOST"), DATABASE_PORT: required("DATABASE_PORT"),
      DATABASE_USER: required("DATABASE_USER"), DATABASE_PASSWORD: required("DATABASE_PASSWORD"), DATABASE_NAME: required("DATABASE_NAME") });
    const app = buildApp(config, { database, inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
      evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }), sendIrisTextReply: async () => undefined });
    const eventId = `pin-shadow-${Date.now()}`;
    const response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`, payload: {
      msg: "/댓글핀삭제 1", room: "고도화댓글핀테스트방", sender: "합성 홈주인",
      json: { _id: eventId, chat_id: roomId, user_id: externalUserId },
    } });
    assert.equal(response.statusCode, 202, response.body);
    const activePins = await database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE deleted_at IS NULL");
    assert.equal(Number(activePins[0]!.count), 2);
    const route = (await database.query<Array<{ route: string }>>("SELECT route FROM command_routing_decisions WHERE event_id=?", [`iris:${eventId}`]))[0]!;
    assert.equal(route.route, "SHADOW");
    await app.close();
  });
});
