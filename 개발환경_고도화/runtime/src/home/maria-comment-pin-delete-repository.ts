import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommentPinDeleteError } from "./comment-pin-delete-command.js";
import type {
  CommentPinDeleteRepository,
  CommentPinDeleteResult,
  CommentPinProjection,
} from "./comment-pin-delete-service.js";

interface ReplayRow { result_json: string }

export class MariaCommentPinDeleteRepository implements CommentPinDeleteRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 완료된 event 결과를 stable pin 조회 전에 재생합니다.
  public async findReplay(requestKey: string): Promise<CommentPinDeleteResult | undefined> {
    const rows = await this.database.query<ReplayRow[]>(
      "SELECT result_json FROM home_comment_pin_delete_mutations WHERE request_key=?",
      [requestKey],
    );
    if (!rows[0]) return undefined;
    return { ...(JSON.parse(rows[0].result_json) as CommentPinDeleteResult), replayed: true };
  }

  // 홈·펫·패스와 활성 핀의 stable 표시 순서를 한 projection으로 읽습니다.
  public async readSnapshot(playerId: string) {
    const [homes, pets, passes, pins] = await Promise.all([
      this.database.query<Array<{ version: bigint }>>("SELECT version FROM player_homes WHERE player_id=?", [playerId]),
      this.database.query<Array<{ present: number }>>(
        "SELECT 1 AS present FROM player_pets WHERE player_id=? AND display_name IS NOT NULL LIMIT 1",
        [playerId],
      ),
      this.database.query<Array<{ present: number }>>(
        `SELECT 1 AS present FROM player_passes
         WHERE player_id=? AND pass_code IN ('support','beginner') AND enabled=TRUE
           AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) LIMIT 1`,
        [playerId],
      ),
      this.database.query<Array<{ pin_id: string; display_order: number; author_name: string; body: string; created_at: Date }>>(
        `SELECT pin.pin_id,pin.display_order,profile.current_display_name AS author_name,comment.body,comment.created_at
         FROM home_comment_pins pin
         JOIN home_comments comment ON comment.id=pin.comment_id
         JOIN player_profiles profile ON profile.player_id=comment.author_player_id
         WHERE pin.home_player_id=? AND pin.deleted_at IS NULL
         ORDER BY pin.display_order,pin.pin_id`,
        [playerId],
      ),
    ]);
    if (!homes[0]) return undefined;
    const projection: CommentPinProjection[] = pins.map((pin) => ({
      pinId: pin.pin_id,
      displayOrder: pin.display_order,
      authorName: pin.author_name,
      body: pin.body,
      createdAt: pin.created_at,
    }));
    return { homeVersion: homes[0].version, hasPet: Boolean(pets[0]), hasActivePass: Boolean(passes[0]), pins: projection };
  }

  // home version·stable pin lock·삭제·순서 compact·감사·outbox를 원자 커밋합니다.
  public async remove(request: {
    requestKey: string;
    playerId: string;
    pinId: string;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentPinDeleteResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const replay = await transaction.query<ReplayRow[]>(
          "SELECT result_json FROM home_comment_pin_delete_mutations WHERE request_key=? FOR UPDATE",
          [request.requestKey],
        );
        if (replay[0]) return { ...(JSON.parse(replay[0].result_json) as CommentPinDeleteResult), replayed: true };
        const homes = await transaction.query<Array<{ version: bigint }>>(
          "SELECT version FROM player_homes WHERE player_id=? FOR UPDATE",
          [request.playerId],
        );
        if (!homes[0]) throw new CommentPinDeleteError("HOME_NOT_FOUND", "펫홈을 찾을 수 없습니다.");
        if (homes[0].version !== request.expectedHomeVersion) {
          throw new CommentPinDeleteError("COMMENT_PIN_VERSION_CONFLICT", "댓글 핀 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
        }
        const pins = await transaction.query<Array<{ display_order: number; body: string }>>(
          `SELECT pin.display_order,comment.body FROM home_comment_pins pin
           JOIN home_comments comment ON comment.id=pin.comment_id
           WHERE pin.pin_id=? AND pin.home_player_id=? AND pin.deleted_at IS NULL FOR UPDATE`,
          [request.pinId, request.playerId],
        );
        const pin = pins[0];
        if (!pin) throw new CommentPinDeleteError("COMMENT_PIN_NOT_FOUND", "댓글 핀을 찾을 수 없습니다.");
        const operation = await transaction.execute(
          `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
           VALUES (?, 'home.comment.pin.delete', ?, 'player', ?, 'iris', 'processing')`,
          [randomUUID(), request.requestKey, request.playerId],
        );
        await transaction.execute(
          "UPDATE home_comment_pins SET deleted_at=UTC_TIMESTAMP(3),deleted_by_player_id=?,row_version=row_version+1 WHERE pin_id=?",
          [request.playerId, request.pinId],
        );
        await transaction.execute(
          `UPDATE home_comment_pins SET display_order=display_order-1,row_version=row_version+1
           WHERE home_player_id=? AND deleted_at IS NULL AND display_order>?`,
          [request.playerId, pin.display_order],
        );
        await transaction.execute(
          "UPDATE player_homes SET version=version+1 WHERE player_id=? AND version=?",
          [request.playerId, request.expectedHomeVersion],
        );
        const message = `✅ ${pin.display_order}번 댓글 핀을 삭제했습니다.`;
        let result: CommentPinDeleteResult = { replayed: false, pinId: request.pinId, message };
        await transaction.execute(
          `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
           VALUES (?,'HOME_COMMENT_PIN_DELETE',?,'completed','success',UTC_TIMESTAMP(3))`,
          [request.requestKey, operation.insertId],
        );
        await transaction.execute(
          `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
           VALUES (?,'player',?,'player',?,'HOME_COMMENT_PIN_DELETE','success',?)`,
          [operation.insertId, request.playerId, request.playerId, JSON.stringify({ pinId: request.pinId, displayOrder: pin.display_order, body: pin.body })],
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
          `INSERT INTO home_comment_pin_delete_mutations(request_key,operation_id,player_id,pin_id,result_json)
           VALUES (?,?,?,?,?)`,
          [request.requestKey, operation.insertId, request.playerId, request.pinId, JSON.stringify(result)],
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
        throw new CommentPinDeleteError("COMMENT_PIN_VERSION_CONFLICT", "댓글 핀 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      }
      throw error;
    }
  }
}
