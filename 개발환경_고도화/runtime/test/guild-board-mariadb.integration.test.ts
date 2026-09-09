import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { GuildBoardService } from "../src/guild/guild-board-service.js";

const enabled = process.env.RUN_MARIADB_INTEGRATION === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("guild board MariaDB integration", { skip: !enabled }, () => {
  let db: DatabaseClient;
  const prefix = `guild-board-${Date.now()}`;
  const room = "990000000000378";
  let guildId = "";
  let master = "";
  let subMaster = "";
  let member = "";

  async function createPlayer(suffix: string, role: string): Promise<string> {
    const externalId = `${prefix}-${suffix}`;
    await db.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const playerId = (await db.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!.id;
    await db.execute("INSERT INTO player_profiles(player_id,current_display_name,experience,version) VALUES (?,?,0,1)", [playerId, `${suffix}-이름`]);
    await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,?,'linked')", [playerId, externalId, `${suffix}-이름`]);
    await db.execute("INSERT INTO guild_members(guild_id,player_id,role_code,joined_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [guildId, playerId, role]);
    return externalId;
  }
  async function event(eventId: string, user: string): Promise<void> {
    await db.execute("INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('7',64),'processed',UTC_TIMESTAMP(3))", [eventId, eventId, room, user]);
  }

  before(async () => {
    db = createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 8, connectTimeoutMs: 5_000 });
    await db.execute("INSERT INTO guilds(code,display_name,status,version) VALUES (?,?,'active',1)", [`${prefix}-code`, "합성 게시판 길드"]);
    guildId = (await db.query<Array<{ id: bigint }>>("SELECT id FROM guilds ORDER BY id DESC LIMIT 1"))[0]!.id.toString();
    master = await createPlayer("master", "master");
    subMaster = await createPlayer("sub", "sub_master");
    member = await createPlayer("member", "member");
  });
  after(async () => { if (db) await db.close(); });

  it("preserves max20, newest-first, leader notice, clear-notice, replay, concurrency and rollback", async () => {
    const service = new GuildBoardService(db);
    for (let index = 1; index <= 21; index += 1) {
      const id = `${prefix}-post-${index}`; await event(id, member);
      await service.execute({ eventId: id, externalUserId: member, destinationId: room, message: `/길메 글${index}` });
    }
    const published = await db.query<Array<{ body: string }>>("SELECT body FROM guild_board_posts WHERE guild_id=? AND status='published' ORDER BY created_at DESC,id DESC", [guildId]);
    assert.equal(published.length, 20); assert.equal(published[0]!.body, "글21"); assert.equal(published.at(-1)!.body, "글2");

    const noticeEvent = `${prefix}-notice`; await event(noticeEvent, subMaster);
    await service.execute({ eventId: noticeEvent, externalUserId: subMaster, destinationId: room, message: "/길드게시판공지 합성공지" });
    const readEvent = `${prefix}-read`; await event(readEvent, member);
    const read = await service.execute({ eventId: readEvent, externalUserId: member, destinationId: room, message: "/길드게시판" });
    assert.ok(read.data.indexOf("합성공지") < read.data.indexOf("글21"));

    const clearEvent = `${prefix}-clear`; await event(clearEvent, master);
    const cleared = await service.execute({ eventId: clearEvent, externalUserId: master, destinationId: room, message: "/길드게시판초기화" });
    assert.equal(cleared.clearedCount, 20);
    assert.equal((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_board_notices WHERE guild_id=?", [guildId]))[0]!.count_value, 1n);

    const same = `${prefix}-same`; await event(same, member);
    const concurrent = await Promise.all([
      service.execute({ eventId: same, externalUserId: member, destinationId: room, message: "/길메 한번" }),
      service.execute({ eventId: same, externalUserId: member, destinationId: room, message: "/길메 한번" }),
    ]);
    assert.equal(concurrent[0].auditId, concurrent[1].auditId);
    assert.equal((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_board_posts WHERE guild_id=? AND body='한번' AND status='published'", [guildId]))[0]!.count_value, 1n);

    const rollback = `${prefix}-rollback`; await event(rollback, member);
    await db.execute("CREATE TRIGGER fail_guild_board_audit BEFORE INSERT ON command_audit FOR EACH ROW BEGIN IF NEW.action_code='guild.board.post' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='forced guild board audit failure'; END IF; END");
    try {
      await assert.rejects(() => service.execute({ eventId: rollback, externalUserId: member, destinationId: room, message: "/길메 롤백" }), /forced guild board audit failure/);
    } finally { await db.execute("DROP TRIGGER IF EXISTS fail_guild_board_audit"); }
    assert.equal((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM guild_board_posts WHERE guild_id=? AND body='롤백'", [guildId]))[0]!.count_value, 0n);
    assert.equal((await db.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [`guild.board:${guildId}`, rollback]))[0]!.count_value, 0n);
  });
});
