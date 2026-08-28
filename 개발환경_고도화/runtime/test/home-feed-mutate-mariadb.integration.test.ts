import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { parseHomeFeedMutationCommand } from "../src/home/home-feed-mutate-command.js";
import { HomeFeedMutationService } from "../src/home/home-feed-mutate-service.js";

const enabled = process.env.DATABASE_INTEGRATION_ENABLED === "true";
const required = (name: string): string => process.env[name] ?? "integration-not-configured";

describe("home feed mutate MariaDB integration", { skip: !enabled }, () => {
  let db: DatabaseClient;
  let owner: bigint;
  const suffix = Date.now().toString();
  const external = `feed-owner-${suffix}`;
  const room = "990000000000623";
  const open = () => createDatabaseClient({ enabled: true, host: required("DATABASE_HOST"), port: Number(required("DATABASE_PORT")), user: required("DATABASE_USER"), password: required("DATABASE_PASSWORD"), name: required("DATABASE_NAME"), connectionLimit: 4, connectTimeoutMs: 5000 });
  const addEvent = async (id: string) => db.execute("INSERT INTO event_inbox(event_id,provider_code,provider_event_id,event_kind,event_origin,direction,payload_hash,parse_status,processing_status,received_at) VALUES(?,'iris',?,'message','test','incoming',REPEAT('5',64),'parsed','processing',UTC_TIMESTAMP(3))", [id, id]);
  const run = async (eventId: string, message: string) => {
    const command = parseHomeFeedMutationCommand(message)!;
    return new HomeFeedMutationService(db).execute({ eventId, externalUserId: external, destinationId: room, command });
  };

  before(async () => {
    db = open();
    for (const [name, ext] of [[`피드 사용자 ${suffix}`, external], [`피드 팔로워 ${suffix}`, `feed-follower-${suffix}`]]) {
      const player = await db.execute("INSERT INTO players(status,version) VALUES('active',1)");
      await db.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES(?,?,1)", [player.insertId, name]);
      await db.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES(?,'kakao',?,?,'linked')", [player.insertId, ext, name]);
      if (ext === external) owner = player.insertId;
      else await db.execute("INSERT INTO pet_home_follows(follower_player_id,followed_player_id,active,version) VALUES(?,?,TRUE,1)", [player.insertId, owner]);
    }
    await db.execute("INSERT INTO player_passes(player_id,pass_code,enabled,permanent) VALUES(?,'premium',TRUE,TRUE)", [owner]);
    await db.execute("INSERT INTO player_pets(player_id,display_name,version) VALUES(?,'피드펫',1)", [owner]);
  });

  after(async () => {
    if (db) try { await db.execute("DROP TRIGGER IF EXISTS fail_feed_outbox"); await db.close(); } catch {}
  });

  it("creates trims alerts deletes clears rolls back and reconnects", async () => {
    const firstId = `feed-create-${suffix}`;
    await addEvent(firstId);
    const first = await run(firstId, "/피드 첫 글");
    assert.equal(first.activeCount, 1);
    assert.equal(first.deliveredCount, 1);
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM pet_home_activity_alerts WHERE actor_player_id=? AND feed_content='첫 글'", [owner]))[0]!.count, 2n);
    assert.equal((await db.query<Array<{ value: bigint }>>("SELECT value FROM player_counters WHERE player_id=? AND counter_code='feed_post'", [owner]))[0]!.value, 1n);
    assert.equal((await run(firstId, "/피드 첫 글")).replayed, true);
    const concurrentId = `feed-concurrent-${suffix}`;
    await addEvent(concurrentId);
    const concurrent = await Promise.all([run(concurrentId, "/피드 동시 글"), run(concurrentId, "/피드 동시 글")]);
    assert.equal(concurrent.filter((result) => result.replayed).length, 1);
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM home_feeds WHERE home_player_id=? AND content='동시 글'", [owner]))[0]!.count, 1n);
    for (let index = 2; index <= 11; index += 1) {
      const id = `feed-create-${suffix}-${index}`;
      await addEvent(id);
      await run(id, `/피드 글 ${index}`);
    }
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL", [owner]))[0]!.count, 10n);
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM pet_home_feed_activity_days WHERE player_id=?", [owner]))[0]!.count, 1n);
    const deleteId = `feed-delete-${suffix}`;
    await addEvent(deleteId);
    assert.match((await run(deleteId, "/피드삭제 01")).message, /1번/);
    const rollbackId = `feed-rollback-${suffix}`;
    await addEvent(rollbackId);
    await db.execute("CREATE TRIGGER fail_feed_outbox BEFORE INSERT ON outbox_messages FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic feed rollback'");
    await assert.rejects(() => run(rollbackId, "/피드 롤백"), /synthetic feed rollback/);
    await db.execute("DROP TRIGGER fail_feed_outbox");
    assert.equal((await db.query<Array<{ count: bigint }>>("SELECT COUNT(*) count FROM home_feeds WHERE home_player_id=? AND content='롤백' AND deleted_at IS NULL", [owner]))[0]!.count, 0n);
    assert.equal(await db.verifyRollback(), true);
    const clearId = `feed-clear-${suffix}`;
    await addEvent(clearId);
    assert.equal((await run(clearId, "/피드전체삭제")).activeCount, 0);
    await db.close();
    db = open();
    assert.equal((await run(firstId, "/피드 첫 글")).replayed, true);
  });
});
