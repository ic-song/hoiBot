import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";
import { createDatabaseClient, type DatabaseClient, type DatabaseTransaction } from "../src/database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../src/dispatch/command-dispatcher.js";
import { SocialBoardReadService } from "../src/social/social-board-read-service.js";

const database = createDatabaseClient(loadConfig().database);
const restart = process.argv.includes("--verify-restart");
const externalUserId = "synthetic-social-board-viewer";
const destinationId = "synthetic-social-board-room";
const eventPrefix = "synthetic-social-board";

async function count(sql: string, values: readonly unknown[] = []): Promise<bigint> {
  return BigInt((await database.query<Array<{ value: bigint | string }>>(sql, values))[0]?.value ?? 0);
}

async function event(eventId: string): Promise<void> {
  await database.execute(
    "INSERT INTO event_inbox(event_id,provider_event_id,external_channel_id,external_user_id,event_kind,direction,payload_hash,processing_status,received_at) VALUES (?,?,?,?,'message','incoming',REPEAT('6',64),'processed',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE processing_status=VALUES(processing_status)",
    [eventId, eventId, destinationId, externalUserId]
  );
}

function failAudit(inner: DatabaseClient): DatabaseClient {
  return {
    ping: () => inner.ping(), query: (sql, values) => inner.query(sql, values), execute: (sql, values) => inner.execute(sql, values),
    verifyRollback: () => inner.verifyRollback(), close: async () => undefined,
    withTransaction: <T>(work: (transaction: DatabaseTransaction) => Promise<T>) => inner.withTransaction((transaction) => work({
      query: (sql, values) => transaction.query(sql, values),
      execute: async (sql, values) => {
        if (sql.includes("INSERT INTO command_audit")) throw new Error("synthetic social board audit failure");
        return transaction.execute(sql, values);
      }
    }))
  };
}

try {
  const service = new SocialBoardReadService(database);
  if (!restart) {
    await database.execute("INSERT INTO players(id,status,version) VALUES (988710001,'active',1),(988710002,'active',1),(988710003,'inactive',1)");
    await database.execute("INSERT INTO player_profiles(player_id,current_display_name,version) VALUES (988710001,'게시판조회자',1),(988710002,'게시판작성자',1),(988710003,'탈퇴원본',1)");
    await database.execute("INSERT INTO external_identities(player_id,provider_code,external_user_id,display_name,status) VALUES (988710001,'kakao',?,'게시판조회자','linked')", [externalUserId]);
    await database.execute("INSERT INTO player_legacy_rank_profiles(player_id,rank_emoji,source_order) VALUES (988710002,'🌱',988710002),(988710003,'👑',988710003)");
    const boardId = (await database.query<Array<{ id: bigint }>>("SELECT id FROM community_boards WHERE code='legacy_public_board'"))[0]!.id;
    await database.execute(
      `INSERT INTO community_posts(board_id,author_player_id,post_type_code,body,status,created_at)
       VALUES (? ,988710002,'message','첫 글','published','2026-08-27 10:00:00'),
              (? ,988710003,'message','보존 글','published','2026-08-27 11:00:00'),
              (? ,988710002,'message','둘째\\n글','published','2026-08-27 12:00:00')`,
      [boardId, boardId, boardId]
    );

    const shadowEvent = `${eventPrefix}-shadow`;
    await event(shadowEvent);
    const shadow = await new CommandDispatcher(
      new MariaCommandDispatchRepository(database),
      { enabled: true, allowAllCanaries: true, canaryUserIds: new Set() }
    ).resolve({ eventId: shadowEvent, message: "/게시판", userId: externalUserId, hasTrustedDisplayName: true });
    assert.deepEqual([shadow.route, shadow.handlerKey], ["SHADOW", "social_board_read"]);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [shadowEvent]), 0n);

    const readEvent = `${eventPrefix}-read`;
    await event(readEvent);
    const result = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.ok(result !== null);
    assert.equal(result.postCount, 3);
    assert.ok(result.data.indexOf("[🌱게시판작성자] 첫 글") < result.data.indexOf("[탈퇴회원] 보존 글"));
    assert.ok(result.data.indexOf("[탈퇴회원] 보존 글") < result.data.indexOf("[🌱게시판작성자] 둘째\n글"));
    const replay = await service.read({ eventId: readEvent, externalUserId, destinationId });
    assert.deepEqual(replay, result);

    const concurrentA = `${eventPrefix}-concurrent-a`;
    const concurrentB = `${eventPrefix}-concurrent-b`;
    await event(concurrentA); await event(concurrentB);
    const concurrent = await Promise.all([
      service.read({ eventId: concurrentA, externalUserId, destinationId }),
      service.read({ eventId: concurrentB, externalUserId, destinationId })
    ]);
    assert.deepEqual(concurrent.map((entry) => entry?.data), [result.data, result.data]);

    const rollbackEvent = `${eventPrefix}-rollback`;
    await event(rollbackEvent);
    await assert.rejects(
      () => new SocialBoardReadService(failAudit(database)).read({ eventId: rollbackEvent, externalUserId, destinationId }),
      /synthetic social board audit failure/
    );
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_key=?", [rollbackEvent]), 0n);
    assert.equal(await count("SELECT COUNT(*) value FROM community_posts"), 3n);
    assert.equal(await count("SELECT COUNT(*) value FROM command_audit WHERE CAST(change_summary_json AS CHAR) LIKE '%첫 글%' OR CAST(change_summary_json AS CHAR) LIKE '%보존 글%'"), 0n);
    const effects = {
      operations: await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='social.board.read'"),
      executions: await count("SELECT COUNT(*) value FROM command_executions WHERE command_code='SOCIAL_BOARD_READ'"),
      outboxes: await count("SELECT COUNT(*) value FROM outbox_messages outbox JOIN operations operation_row ON operation_row.id=outbox.operation_id WHERE operation_row.idempotency_scope='social.board.read'"),
      audits: await count("SELECT COUNT(*) value FROM command_audit audit JOIN operations operation_row ON operation_row.id=audit.operation_id WHERE operation_row.idempotency_scope='social.board.read'")
    };
    assert.deepEqual(effects, { operations: 3n, executions: 3n, outboxes: 3n, audits: 3n });
    console.log(JSON.stringify({
      mode: "probe", migrationCount: 245,
      scenarios: ["shadow", "exact", "source-order", "rank", "missing-author", "multiline", "replay", "concurrent-read", "redacted-audit", "rollback"],
      effects, posts: 3, operationalDataTouched: false
    }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  } else {
    const beforePosts = await count("SELECT COUNT(*) value FROM community_posts");
    const beforeOperations = await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='social.board.read'");
    const replay = await service.read({ eventId: `${eventPrefix}-read`, externalUserId, destinationId });
    assert.ok(replay !== null);
    assert.equal(replay.postCount, 3);
    assert.equal(await count("SELECT COUNT(*) value FROM community_posts"), beforePosts);
    assert.equal(await count("SELECT COUNT(*) value FROM operations WHERE idempotency_scope='social.board.read'"), beforeOperations);
    console.log(JSON.stringify({ mode: "verify-restart", posts: beforePosts, operations: beforeOperations, additionalMutation: false, operationalDataTouched: false }, (_key, value) => typeof value === "bigint" ? Number(value) : value));
  }
} finally {
  await database.close();
}
