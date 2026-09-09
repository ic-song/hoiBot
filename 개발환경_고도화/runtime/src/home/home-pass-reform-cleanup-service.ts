import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "HOME_PASS_REFORM_CLEANUP";
const CLEANUP_KEY = "passBenefits20260726";

export interface HomePassReformCleanupResult {
  status: "cleaned" | "already_applied";
  message: string;
  outboxId: string;
  replayed: boolean;
  removedCommentCount: string;
  preservedPinnedCount: string;
  resetLikeUserCount: string;
  resetLikeCount: string;
  backedUpCommentCount: string;
  backedUpHomeCount: string;
}

type OperatorRow = { operator_id: bigint };
type StoredOperation = { result_json: string | HomePassReformCleanupResult | null };
type CommentRow = {
  id: bigint;
  home_player_id: bigint;
  author_player_id: bigint;
  body: string;
  status: string;
  created_at: Date;
  deleted_at: Date | null;
  pin_id: string | null;
  display_order: bigint | null;
};
type HomeRow = { player_id: bigint; like_count: bigint; version: bigint };

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function parseStored(value: string | HomePassReformCleanupResult): HomePassReformCleanupResult {
  return typeof value === "string" ? JSON.parse(value) as HomePassReformCleanupResult : value;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function buildHomePassReformCleanupMessage(input: {
  status: "cleaned" | "already_applied";
  removedCommentCount: bigint;
  preservedPinnedCount: bigint;
  resetLikeUserCount: bigint;
  resetLikeCount: bigint;
}): string {
  if (input.status === "already_applied") return "✅ 펫홈 패스 혜택 개편 정리가 이미 완료되었습니다.";
  return `✅ 펫홈 패스 혜택 개편 정리 완료\n\n일반 댓글 삭제: ${commas(input.removedCommentCount)}개\n댓글핀 유지: ${commas(input.preservedPinnedCount)}개\n좋아홈 초기화: ${commas(input.resetLikeUserCount)}명 / ${commas(input.resetLikeCount)}개\n\n펫홈 백업: 생성 완료\n댓글 백업: 생성 완료`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  operatorId: bigint;
  destinationId: string;
  status: "cleaned" | "already_applied";
  removedCommentCount: bigint;
  preservedPinnedCount: bigint;
  resetLikeUserCount: bigint;
  resetLikeCount: bigint;
  backedUpCommentCount: bigint;
  backedUpHomeCount: bigint;
}): Promise<HomePassReformCleanupResult> {
  const message = buildHomePassReformCleanupMessage(input);
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: message })],
  );
  const result: HomePassReformCleanupResult = {
    status: input.status,
    message,
    outboxId: outbox.insertId.toString(),
    replayed: false,
    removedCommentCount: input.removedCommentCount.toString(),
    preservedPinnedCount: input.preservedPinnedCount.toString(),
    resetLikeUserCount: input.resetLikeUserCount.toString(),
    resetLikeCount: input.resetLikeCount.toString(),
    backedUpCommentCount: input.backedUpCommentCount.toString(),
    backedUpHomeCount: input.backedUpHomeCount.toString(),
  };
  await transaction.execute(
    `INSERT INTO home_pass_reform_cleanup_runs
      (operation_id,actor_operator_id,cleanup_status,removed_comment_count,preserved_pinned_count,reset_like_user_count,reset_like_count,backed_up_comment_count,backed_up_home_count,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))`,
    [input.operationId, input.operatorId, input.status, input.removedCommentCount, input.preservedPinnedCount, input.resetLikeUserCount, input.resetLikeCount, input.backedUpCommentCount, input.backedUpHomeCount],
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, input.operationId, input.status],
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_home_pass_reform',NULL,'home.pass_reform.cleanup',?,'Iris /펫홈패스개편정리',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.operatorId, input.status, JSON.stringify({ removedCommentCount: result.removedCommentCount, preservedPinnedCount: result.preservedPinnedCount, resetLikeUserCount: result.resetLikeUserCount, resetLikeCount: result.resetLikeCount, backedUpCommentCount: result.backedUpCommentCount, backedUpHomeCount: result.backedUpHomeCount })],
  );
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 일반 댓글·좋아홈만 정리하고 핀과 관계형 사전 백업을 한 transaction에서 보존합니다.
export class HomePassReformCleanupService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<HomePassReformCleanupResult> {
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
      if (operator === undefined) throw new ApplicationError("HOME_PASS_REFORM_CLEANUP_FORBIDDEN", "펫홈 패스 개편 정리 권한이 없습니다.", 403);

      const key = eventKey(input.eventId);
      const prior = (await transaction.query<StoredOperation[]>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.pass_reform.cleanup' AND idempotency_key=? FOR UPDATE",
        [key],
      ))[0];
      if (prior?.result_json != null) return { ...parseStored(prior.result_json), replayed: true };
      if (prior !== undefined) throw new ApplicationError("HOME_PASS_REFORM_CLEANUP_IN_PROGRESS", "펫홈 패스 개편 정리가 처리 중입니다.", 409);

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.pass_reform.cleanup',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, operator.operator_id],
      );
      const operationId = operation.insertId;
      const state = (await transaction.query<Array<{ completed_operation_id: bigint | null }>>(
        "SELECT completed_operation_id FROM home_pass_reform_cleanup_state WHERE cleanup_key=? FOR UPDATE",
        [CLEANUP_KEY],
      ))[0];
      if (state?.completed_operation_id != null) {
        return complete(transaction, { operationId, eventId: input.eventId, operatorId: operator.operator_id, destinationId: input.destinationId, status: "already_applied", removedCommentCount: 0n, preservedPinnedCount: 0n, resetLikeUserCount: 0n, resetLikeCount: 0n, backedUpCommentCount: 0n, backedUpHomeCount: 0n });
      }

      const comments = await transaction.query<CommentRow[]>(
        `SELECT comment.id,comment.home_player_id,comment.author_player_id,comment.body,comment.status,comment.created_at,comment.deleted_at,
                pin.pin_id,pin.display_order
           FROM home_comments comment
      LEFT JOIN home_comment_pins pin ON pin.comment_id=comment.id AND pin.deleted_at IS NULL
          WHERE comment.status='visible' AND comment.deleted_at IS NULL
          ORDER BY comment.id FOR UPDATE`,
      );
      const homes = await transaction.query<HomeRow[]>("SELECT player_id,like_count,version FROM player_homes ORDER BY player_id FOR UPDATE");
      for (const comment of comments) {
        await transaction.execute(
          `INSERT INTO home_pass_reform_comment_backups
            (operation_id,comment_id,home_player_id,author_player_id,body,comment_status,comment_created_at,comment_deleted_at,pin_id,pin_display_order)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [operationId, comment.id, comment.home_player_id, comment.author_player_id, comment.body, comment.status, comment.created_at, comment.deleted_at, comment.pin_id, comment.display_order],
        );
      }
      for (const home of homes) {
        await transaction.execute(
          "INSERT INTO home_pass_reform_home_backups(operation_id,player_id,like_count,home_version) VALUES (?,?,?,?)",
          [operationId, home.player_id, home.like_count, home.version],
        );
      }

      const removedCommentCount = BigInt(comments.filter((comment) => comment.pin_id === null).length);
      const preservedPinnedCount = BigInt(comments.filter((comment) => comment.pin_id !== null).length);
      const resetLikeUserCount = BigInt(homes.length);
      const resetLikeCount = homes.reduce((total, home) => total + home.like_count, 0n);
      await transaction.execute(
        `UPDATE home_comments comment
            SET comment.status='pass_reform_removed',comment.deleted_at=UTC_TIMESTAMP(3)
          WHERE comment.status='visible' AND comment.deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM home_comment_pins pin WHERE pin.comment_id=comment.id AND pin.deleted_at IS NULL)`,
      );
      await transaction.execute("UPDATE player_homes SET like_count=0,version=version+1");
      await transaction.execute(
        "UPDATE home_pass_reform_cleanup_state SET completed_operation_id=?,completed_by_operator_id=?,completed_at=UTC_TIMESTAMP(3),version=version+1 WHERE cleanup_key=?",
        [operationId, operator.operator_id, CLEANUP_KEY],
      );
      return complete(transaction, { operationId, eventId: input.eventId, operatorId: operator.operator_id, destinationId: input.destinationId, status: "cleaned", removedCommentCount, preservedPinnedCount, resetLikeUserCount, resetLikeCount, backedUpCommentCount: BigInt(comments.length), backedUpHomeCount: BigInt(homes.length) });
    });
  }
}
