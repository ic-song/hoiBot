import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";
import { HomeFurnitureRankReadService } from "../src/home/home-furniture-rank-read-service.js";
import { HomeRankingReadService } from "../src/home/home-ranking-read-service.js";
import { PlayerCumulativeLevelRankReadService } from "../src/player/player-cumulative-level-rank-read-service.js";
import { PlayerCumulativeLikeRankReadService } from "../src/player/player-cumulative-like-rank-read-service.js";
import { PlayerOverallRankReadService } from "../src/player/player-overall-rank-read-service.js";

const enabled = process.env.WAVE9_ISOLATED_MARIADB_TEST === "true";
const required = (name: string): string => process.env[name] ?? "wave9-isolated-not-configured";
const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type RankResult = { data: string; outboxId: string; rowCount: number } | null;
type RankReader = { read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<RankResult> };
type Consumer = { name: string; scope: string; action: string; lockFragment: string; create(database: DatabaseClient): RankReader };

const consumers: readonly Consumer[] = [
  { name: "누렙순위", scope: "player.cumulative_level_rank_read", action: "player.cumulative_level_rank_read", lockFragment: "SELECT result_json FROM operations", create: (db) => new PlayerCumulativeLevelRankReadService(db) },
  { name: "누좋순위", scope: "player.cumulative_like_rank_read", action: "player.cumulative_like_rank_read", lockFragment: "SELECT result_json FROM operations", create: (db) => new PlayerCumulativeLikeRankReadService(db) },
  { name: "종합순위", scope: "player.overall_rank_read", action: "player.overall_rank_read", lockFragment: "SELECT id identity_id,player_id FROM external_identities", create: (db) => new PlayerOverallRankReadService(db) },
  { name: "펫홈순위", scope: "home.ranking_read", action: "home.ranking_read", lockFragment: "SELECT result_json FROM operations", create: (db) => new HomeRankingReadService(db) },
  { name: "가구순위", scope: "home.furniture_rank_read", action: "home.furniture_rank_read", lockFragment: "SELECT result_json FROM operations", create: (db) => new HomeFurnitureRankReadService(db) }
];

describe("Wave9 isolated MariaDB repository risks", { skip: !enabled }, () => {
  let database: DatabaseClient;
  const externalUserId = "wave9-rank-reader";
  const destinationId = "wave9-isolated-room";
  const runId = Date.now().toString();

  before(async () => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 12,
      connectTimeoutMs: 5_000
    });
    await database.execute("INSERT INTO players(status,version) VALUES ('active',1)");
    const player = (await database.query<Array<{ id: bigint }>>("SELECT id FROM players ORDER BY id DESC LIMIT 1"))[0]!;
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (?,'Wave9 검증자',1)", [player.id]);
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (?,'kakao',?,'Wave9 검증자','linked')", [player.id, externalUserId]);
  });

  after(async () => {
    if (!database) return;
    await database.execute("DROP TRIGGER IF EXISTS wave9_hold_audit");
    await database.execute("DROP TRIGGER IF EXISTS wave9_fail_audit");
    await database.close();
  });

  for (const consumer of consumers) {
    it(`${consumer.name}: observes an InnoDB FOR UPDATE wait and one writer plus one replay`, async () => {
      const eventId = `wave9-concurrent-${consumer.name}-${runId}`;
      const input = { eventId, externalUserId, destinationId };
      await createEvent(eventId);
      await database.execute("DROP TRIGGER IF EXISTS wave9_hold_audit");
      await database.execute("CREATE TRIGGER wave9_hold_audit BEFORE INSERT ON command_audit FOR EACH ROW DO SLEEP(1.2)");
      const reader = consumer.create(database);
      const first = reader.read(input);
      await waitForProcess("INSERT INTO command_audit");
      let secondSettled = false;
      const second = reader.read(input).finally(() => { secondSettled = true; });
      await waitForPendingForUpdate(consumer.lockFragment);
      assert.equal(secondSettled, false, `${consumer.name} FOR UPDATE did not wait for the writer transaction`);
      const [firstResult, secondResult] = await Promise.all([first, second]);
      await database.execute("DROP TRIGGER wave9_hold_audit");

      assert.deepEqual(secondResult, firstResult);
      assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [consumer.scope, eventId]), 1n);
      assert.equal(await count("SELECT COUNT(*) value FROM command_executions WHERE event_id=?", [eventId]), 1n);
      assert.equal(await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope=? AND operation_row.idempotency_key=?", [consumer.scope, eventId]), 1n);
      assert.equal(await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope=? AND operation_row.idempotency_key=?", [consumer.scope, eventId]), 1n);
    });

    it(`${consumer.name}: rolls every persisted table back after middle DML failure`, async () => {
      const eventId = `wave9-rollback-${consumer.name}-${runId}`;
      await createEvent(eventId);
      const before = await snapshot(consumer, eventId);
      await database.execute("DROP TRIGGER IF EXISTS wave9_fail_audit");
      await database.execute("CREATE TRIGGER wave9_fail_audit BEFORE INSERT ON command_audit FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='wave9 middle DML failure'");
      await assert.rejects(() => consumer.create(database).read({ eventId, externalUserId, destinationId }), /wave9 middle DML failure/);
      await database.execute("DROP TRIGGER wave9_fail_audit");
      assert.deepEqual(await snapshot(consumer, eventId), before);
      assert.deepEqual(before, { operations: 0n, outbox: 0n, executions: 0n, audit: 0n });
      assert.equal(await database.verifyRollback(), true);
    });
  }

  async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
    return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
  }

  async function createEvent(eventId: string): Promise<void> {
    await database.execute(
      "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('9',64),'processed',UTC_TIMESTAMP(3))",
      [eventId, eventId, destinationId, externalUserId]
    );
  }

  async function snapshot(consumer: Consumer, eventId: string) {
    return {
      operations: await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [consumer.scope, eventId]),
      outbox: await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope=? AND operation_row.idempotency_key=?", [consumer.scope, eventId]),
      executions: await count("SELECT COUNT(*) value FROM command_executions WHERE event_id=?", [eventId]),
      audit: await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope=? AND operation_row.idempotency_key=?", [consumer.scope, eventId])
    };
  }

  async function waitForProcess(fragment: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = await count("SELECT COUNT(*) value FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE ?", [required("DATABASE_NAME"), `%${fragment}%`]);
      if (found > 0n) return;
      await delay(10);
    }
    throw new Error(`Wave9 MariaDB process was not observed: ${fragment}`);
  }

  async function waitForPendingForUpdate(fragment: string): Promise<void> {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = await count(
        "SELECT COUNT(*) value FROM information_schema.PROCESSLIST WHERE DB=? AND INFO LIKE ? AND INFO LIKE '%FOR UPDATE%' AND TIME_MS>=50",
        [required("DATABASE_NAME"), `%${fragment}%`]
      );
      if (found > 0n) return;
      await delay(10);
    }
    throw new Error(`Wave9 pending FOR UPDATE was not observed: ${fragment}`);
  }
});
