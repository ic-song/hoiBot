import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_FEED_MIGRATION";
const MIGRATION_KEY = "feedMigration20260728";
const MAX_FEEDS = 10;

export interface HomeFeedMigrationResult {
  status: "migrated" | "already_applied";
  message: string;
  outboxId: string;
  replayed: boolean;
  userCount: string;
  legacyFeedCount: string;
  backedUpSourceCount: string;
  backedUpFeedCount: string;
}

type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomeFeedMigrationResult | null };
type HomeSourceRow = {
  player_id: bigint;
  source_present: bigint;
  legacy_content: string | null;
  legacy_created_at_ms: bigint | null;
  source_import_run_id: bigint | null;
  source_file: string | null;
  source_path: string | null;
};
type FeedRow = {
  id: bigint;
  home_player_id: bigint;
  feed_key: string;
  content: string;
  display_order: bigint;
  created_at_ms: bigint;
  source_code: string;
  source_operation_id: bigint | null;
  deleted_at: Date | null;
  version: bigint;
};

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomeFeedMigrationResult): HomeFeedMigrationResult {
  return typeof value === "string" ? JSON.parse(value) as HomeFeedMigrationResult : value;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function buildHomeFeedMigrationMessage(input: { status: "migrated" | "already_applied"; userCount: bigint; legacyFeedCount: bigint }): string {
  if (input.status === "already_applied") return "ℹ️ 펫홈 피드 마이그레이션은 이미 완료되었습니다.";
  return `✅ 펫홈 피드 마이그레이션 완료\n처리 유저: ${commas(input.userCount)}명\n이전 한줄평: ${commas(input.legacyFeedCount)}개\n홈 데이터 백업: 새 백업 생성`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  operatorId: bigint;
  destinationId: string;
  status: "migrated" | "already_applied";
  userCount: bigint;
  legacyFeedCount: bigint;
  backedUpSourceCount: bigint;
  backedUpFeedCount: bigint;
}): Promise<HomeFeedMigrationResult> {
  const message = buildHomeFeedMigrationMessage(input);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  const result: HomeFeedMigrationResult = {
    status: input.status,
    message,
    outboxId: outbox.insertId.toString(),
    replayed: false,
    userCount: input.userCount.toString(),
    legacyFeedCount: input.legacyFeedCount.toString(),
    backedUpSourceCount: input.backedUpSourceCount.toString(),
    backedUpFeedCount: input.backedUpFeedCount.toString(),
  };
  await transaction.execute(
    `INSERT INTO home_feed_migration_runs
      (operation_id,actor_operator_id,migration_status,user_count,legacy_feed_count,backed_up_source_count,backed_up_feed_count,created_at)
     VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [input.operationId, input.operatorId, input.status, input.userCount, input.legacyFeedCount, input.backedUpSourceCount, input.backedUpFeedCount],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_home_feed',NULL,'home.feed.migrate',?,'Iris /펫홈피드마이그레이션',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, JSON.stringify({ userCount: result.userCount, legacyFeedCount: result.legacyFeedCount, backedUpSourceCount: result.backedUpSourceCount, backedUpFeedCount: result.backedUpFeedCount })],
  );
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 레거시 한줄평 원본과 기존 피드를 백업한 뒤 모든 홈을 한 transaction에서 일괄 이관합니다.
export class HomeFeedMigrationService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomeFeedMigrationResult> {
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(
        `SELECT mapping.operator_id
           FROM external_identities identity
           JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
           JOIN admin_operators operator ON operator.id=mapping.operator_id
           JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
           JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=?
            AND identity.status='linked' AND operator.status='active'
            AND permission.permission_code='game.home.moderate'
          ORDER BY mapping.operator_id LIMIT 1 FOR UPDATE`,
        [input.externalUserId],
      ))[0];
      if (operator === undefined) throw new ApplicationError("HOME_FEED_MIGRATION_FORBIDDEN", "펫홈 피드 마이그레이션 권한이 없습니다.", 403);

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.feed.migrate' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_FEED_MIGRATION_IN_PROGRESS", "펫홈 피드 마이그레이션이 처리 중입니다.", 409);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.feed.migrate',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id],
      );
      const operationId = operation.insertId;
      const state = (await transaction.query<Array<{ completed_operation_id: bigint | null }>>(
        "SELECT completed_operation_id FROM home_feed_migration_state WHERE migration_key=? FOR UPDATE",
        [MIGRATION_KEY],
      ))[0];
      if (state?.completed_operation_id != null) {
        return complete(transaction, { operationId, eventId: input.eventId, operatorId: operator.operator_id, destinationId: input.destinationId, status: "already_applied", userCount: 0n, legacyFeedCount: 0n, backedUpSourceCount: 0n, backedUpFeedCount: 0n });
      }

      const homes = await transaction.query<HomeSourceRow[]>(
        `SELECT home.player_id,IF(source.player_id IS NULL,0,1) source_present,source.legacy_content,source.legacy_created_at_ms,
                source.source_import_run_id,source.source_file,source.source_path
           FROM player_homes home
      LEFT JOIN home_feed_legacy_sources source ON source.player_id=home.player_id
          ORDER BY home.player_id FOR UPDATE`,
      );
      const feeds = await transaction.query<FeedRow[]>(
        "SELECT id,home_player_id,feed_key,content,display_order,created_at_ms,source_code,source_operation_id,deleted_at,version FROM home_feeds ORDER BY home_player_id,display_order,id FOR UPDATE",
      );
      const counts = new Map<string, number>();
      for (const feed of feeds) {
        const playerKey = feed.home_player_id.toString();
        const nextCount = (counts.get(playerKey) ?? 0) + (feed.deleted_at === null ? 1 : 0);
        counts.set(playerKey, nextCount);
        if (nextCount > MAX_FEEDS) throw new ApplicationError("HOME_FEED_MIGRATION_INVALID_FEED_LIST", `펫홈 피드 저장 개수가 ${MAX_FEEDS}개를 초과했습니다.`, 409);
        await transaction.execute(
          `INSERT INTO home_feed_migration_feed_backups
            (operation_id,feed_id,home_player_id,feed_key,content,display_order,created_at_ms,source_code,source_operation_id,deleted_at,feed_version)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [operationId, feed.id, feed.home_player_id, feed.feed_key, feed.content, feed.display_order, feed.created_at_ms, feed.source_code, feed.source_operation_id, feed.deleted_at, feed.version],
        );
      }

      let legacyFeedCount = 0n;
      for (const home of homes) {
        await transaction.execute(
          `INSERT INTO home_feed_migration_source_backups
            (operation_id,player_id,source_present,legacy_content,legacy_created_at_ms,source_import_run_id,source_file,source_path)
           VALUES (?,?,?,?,?,?,?,?)`,
          [operationId, home.player_id, home.source_present, home.legacy_content, home.legacy_created_at_ms, home.source_import_run_id, home.source_file, home.source_path],
        );
        const content = home.legacy_content?.trim() ?? "";
        if (content !== "") {
          legacyFeedCount += 1n;
          const createdAtMs = home.legacy_created_at_ms ?? operationId;
          const baseKey = `legacy-${createdAtMs.toString()}`;
          let feedKey = baseKey;
          let sequence = 0;
          while ((await transaction.query<Array<{ id: bigint }>>("SELECT id FROM home_feeds WHERE home_player_id=? AND feed_key=? LIMIT 1", [home.player_id, feedKey]))[0] !== undefined) {
            sequence += 1;
            feedKey = `${baseKey}-${sequence}`;
          }
          await transaction.execute("UPDATE home_feeds SET display_order=display_order+1,version=version+1 WHERE home_player_id=? AND deleted_at IS NULL ORDER BY display_order DESC,id DESC", [home.player_id]);
          await transaction.execute(
            "INSERT INTO home_feeds(home_player_id,feed_key,content,display_order,created_at_ms,source_code,source_operation_id,version) VALUES (?,?,?,1,?,'legacy_one_line_review',?,1)",
            [home.player_id, feedKey, content, createdAtMs, operationId],
          );
          await transaction.execute("DELETE FROM home_feeds WHERE home_player_id=? AND deleted_at IS NULL AND display_order>?", [home.player_id, MAX_FEEDS]);
        }
        await transaction.execute(
          "INSERT INTO home_feed_migration_markers(player_id,operation_id,had_legacy_feed,migrated_at) VALUES (?,?,?,UTC_TIMESTAMP(3))",
          [home.player_id, operationId, content !== ""],
        );
        if (Number(home.source_present) !== 0) await transaction.execute("UPDATE home_feed_legacy_sources SET migrated_operation_id=?,migrated_at=UTC_TIMESTAMP(3),version=version+1 WHERE player_id=?", [operationId, home.player_id]);
      }
      await transaction.execute(
        "UPDATE home_feed_migration_state SET completed_operation_id=?,completed_by_operator_id=?,completed_at=UTC_TIMESTAMP(3),version=version+1 WHERE migration_key=?",
        [operationId, operator.operator_id, MIGRATION_KEY],
      );
      return complete(transaction, {
        operationId,
        eventId: input.eventId,
        operatorId: operator.operator_id,
        destinationId: input.destinationId,
        status: "migrated",
        userCount: BigInt(homes.length),
        legacyFeedCount,
        backedUpSourceCount: BigInt(homes.length),
        backedUpFeedCount: BigInt(feeds.length),
      });
    });
  }
}
