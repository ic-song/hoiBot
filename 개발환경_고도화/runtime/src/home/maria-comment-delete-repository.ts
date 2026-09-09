import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommentDeleteError } from "./comment-delete-command.js";
import type {
  CommentDeleteProjection,
  CommentDeleteRepository,
  CommentDeleteResult,
} from "./comment-delete-service.js";

interface ReplayRow { result_json: string }

export class MariaCommentDeleteRepository implements CommentDeleteRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 완료된 event의 삭제 결과를 목록 재조회보다 먼저 재생합니다.
  public async findReplay(requestKey: string): Promise<CommentDeleteResult | undefined> {
    const rows = await this.database.query<ReplayRow[]>(
      "SELECT result_json FROM home_comment_delete_mutations WHERE request_key=?",
      [requestKey],
    );
    if (!rows[0]) return undefined;
    return { ...(JSON.parse(rows[0].result_json) as CommentDeleteResult), replayed: true };
  }

  // 활성 패스와 최신순 댓글·고정 상태를 한 projection으로 읽습니다.
  public async readSnapshot(playerId: string) {
    const [homes, passes, comments] = await Promise.all([
      this.database.query<Array<{ version: bigint }>>("SELECT version FROM player_homes WHERE player_id=?", [playerId]),
      this.database.query<Array<{ present: number }>>(
        `SELECT 1 AS present FROM player_passes
         WHERE player_id=? AND pass_code IN ('support','beginner') AND enabled=TRUE
           AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) LIMIT 1`,
        [playerId],
      ),
      this.database.query<Array<{ id: bigint; author_name: string; body: string; created_at: Date; pinned: number }>>(
        `SELECT comment.id,profile.current_display_name AS author_name,comment.body,comment.created_at,
                EXISTS(SELECT 1 FROM home_comment_pins pin
                       WHERE pin.home_player_id=comment.home_player_id AND pin.comment_id=comment.id AND pin.deleted_at IS NULL) AS pinned
         FROM home_comments comment
         JOIN player_profiles profile ON profile.player_id=comment.author_player_id
         WHERE comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL
         ORDER BY comment.created_at DESC,comment.id DESC`,
        [playerId],
      ),
    ]);
    const projection: CommentDeleteProjection[] = comments.map((comment) => ({
      commentId: comment.id.toString(),
      authorName: comment.author_name,
      body: comment.body,
      createdAt: comment.created_at,
      pinned: Boolean(comment.pinned),
    }));
    return { homeVersion: homes[0]?.version ?? 0n, hasActivePass: Boolean(passes[0]), comments: projection };
  }

  // 홈 version·stable comment·핀 상태·감사·outbox를 하나의 transaction으로 커밋합니다.
  public async remove(request: {
    requestKey: string;
    playerId: string;
    comment: CommentDeleteProjection;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentDeleteResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const replay = await transaction.query<ReplayRow[]>(
          "SELECT result_json FROM home_comment_delete_mutations WHERE request_key=? FOR UPDATE",
          [request.requestKey],
        );
        if (replay[0]) return { ...(JSON.parse(replay[0].result_json) as CommentDeleteResult), replayed: true };
        const homes = await transaction.query<Array<{ version: bigint }>>(
          "SELECT version FROM player_homes WHERE player_id=? FOR UPDATE",
          [request.playerId],
        );
        if (!homes[0] || homes[0].version !== request.expectedHomeVersion) {
          throw new CommentDeleteError("COMMENT_VERSION_CONFLICT", "댓글 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
        }
        const comments = await transaction.query<Array<{ author_name: string; body: string }>>(
          `SELECT profile.current_display_name AS author_name,comment.body
           FROM home_comments comment
           JOIN player_profiles profile ON profile.player_id=comment.author_player_id
           WHERE comment.id=? AND comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL FOR UPDATE`,
          [request.comment.commentId, request.playerId],
        );
        const comment = comments[0];
        if (!comment) throw new CommentDeleteError("COMMENT_NOT_FOUND", "해당 댓글을 찾을 수 없습니다.");
        const pins = await transaction.query<Array<{ pin_id: string }>>(
          `SELECT pin_id FROM home_comment_pins
           WHERE home_player_id=? AND comment_id=? AND deleted_at IS NULL FOR UPDATE`,
          [request.playerId, request.comment.commentId],
        );
        if (pins[0]) {
          throw new CommentDeleteError("COMMENT_PINNED", "고정된 댓글은 삭제할 수 없습니다📌\n/댓글핀삭제 [번호]로 상단 고정만 먼저 해제해주세요.");
        }
        const operation = await transaction.execute(
          `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
           VALUES (?, 'home.comment.delete', ?, 'player', ?, 'iris', 'processing')`,
          [randomUUID(), request.requestKey, request.playerId],
        );
        await transaction.execute(
          "UPDATE home_comments SET status='deleted',deleted_at=UTC_TIMESTAMP(3) WHERE id=?",
          [request.comment.commentId],
        );
        await transaction.execute(
          "UPDATE player_homes SET version=version+1 WHERE player_id=? AND version=?",
          [request.playerId, request.expectedHomeVersion],
        );
        const message = `🗑️ 댓글이 삭제되었습니다.\n[${comment.author_name}]: ${comment.body}`;
        let result: CommentDeleteResult = { replayed: false, commentId: request.comment.commentId, message };
        await transaction.execute(
          `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
           VALUES (?,'HOME_COMMENT_DELETE',?,'completed','success',UTC_TIMESTAMP(3))`,
          [request.requestKey, operation.insertId],
        );
        await transaction.execute(
          `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
           VALUES (?,'player',?,'home_comment',?,'HOME_COMMENT_DELETE','success',?)`,
          [operation.insertId, request.playerId, request.comment.commentId,
            JSON.stringify({ commentId: request.comment.commentId, authorName: comment.author_name, body: comment.body })],
        );
        if (request.replyDestinationId) {
          const outbox = await transaction.execute(
            `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status)
             VALUES (?,'iris',?,'text',?,'pending')`,
            [operation.insertId, request.replyDestinationId, JSON.stringify({ room: request.replyDestinationId, data: message })],
          );
          result = { ...result, outboxId: outbox.insertId.toString() };
        }
        await transaction.execute(
          `INSERT INTO home_comment_delete_mutations(request_key,operation_id,player_id,comment_id,result_json)
           VALUES (?,?,?,?,?)`,
          [request.requestKey, operation.insertId, request.playerId, request.comment.commentId, JSON.stringify(result)],
        );
        await transaction.execute(
          "UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
          [JSON.stringify(result), operation.insertId],
        );
        return result;
      });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined;
      if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") {
        throw new CommentDeleteError("COMMENT_VERSION_CONFLICT", "댓글 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      throw error;
    }
  }
}
