import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommentPinError } from "./comment-pin-command.js";
import type { CommentPinRepository, CommentPinResult, CommentPinTarget } from "./comment-pin-service.js";

interface ReplayRow { result_json: string }

export class MariaCommentPinRepository implements CommentPinRepository {
  public constructor(private readonly database: DatabaseClient) {}

  // 완료된 event의 핀 결과를 댓글 목록보다 먼저 재생합니다.
  public async findReplay(requestKey: string): Promise<CommentPinResult | undefined> {
    const rows = await this.database.query<ReplayRow[]>("SELECT result_json FROM home_comment_pin_mutations WHERE request_key=?", [requestKey]);
    if (!rows[0]) return undefined;
    return { ...(JSON.parse(rows[0].result_json) as CommentPinResult), replayed: true };
  }

  // 홈·펫·패스·활성 핀 수와 최신순 댓글을 한 projection으로 읽습니다.
  public async readSnapshot(playerId: string) {
    const [homes, pets, passes, pinCounts, comments] = await Promise.all([
      this.database.query<Array<{ version: bigint; owner_name: string }>>(
        `SELECT home.version,profile.current_display_name AS owner_name FROM player_homes home
         JOIN player_profiles profile ON profile.player_id=home.player_id WHERE home.player_id=?`, [playerId],
      ),
      this.database.query<Array<{ present: number }>>("SELECT 1 AS present FROM player_pets WHERE player_id=? AND display_name IS NOT NULL LIMIT 1", [playerId]),
      this.database.query<Array<{ present: number }>>(
        `SELECT 1 AS present FROM player_passes WHERE player_id=? AND pass_code IN ('support','beginner') AND enabled=TRUE
         AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) LIMIT 1`, [playerId],
      ),
      this.database.query<Array<{ count: bigint }>>("SELECT COUNT(*) AS count FROM home_comment_pins WHERE home_player_id=? AND deleted_at IS NULL", [playerId]),
      this.database.query<Array<{ id: bigint; author_name: string; body: string; created_at: Date; pinned: number }>>(
        `SELECT comment.id,profile.current_display_name AS author_name,comment.body,comment.created_at,
          EXISTS(SELECT 1 FROM home_comment_pins pin WHERE pin.home_player_id=comment.home_player_id AND pin.comment_id=comment.id AND pin.deleted_at IS NULL) AS pinned
         FROM home_comments comment JOIN player_profiles profile ON profile.player_id=comment.author_player_id
         WHERE comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL
         ORDER BY comment.created_at DESC,comment.id DESC`, [playerId],
      ),
    ]);
    if (!homes[0]) return undefined;
    const projection: CommentPinTarget[] = comments.map((comment) => ({
      commentId: comment.id.toString(), authorName: comment.author_name, body: comment.body,
      createdAt: comment.created_at, pinned: Boolean(comment.pinned),
    }));
    return { homeVersion: homes[0].version, homeOwnerName: homes[0].owner_name, hasPet: Boolean(pets[0]),
      hasActivePass: Boolean(passes[0]), activePinCount: Number(pinCounts[0]?.count ?? 0n), comments: projection };
  }

  // 홈·댓글·기존 핀을 잠그고 핀·감사·outbox·멱등 결과를 원자 커밋합니다.
  public async add(request: {
    requestKey: string;
    playerId: string;
    target: CommentPinTarget;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentPinResult> {
    try {
      return await this.database.withTransaction(async (transaction) => {
        const replay = await transaction.query<ReplayRow[]>("SELECT result_json FROM home_comment_pin_mutations WHERE request_key=? FOR UPDATE", [request.requestKey]);
        if (replay[0]) return { ...(JSON.parse(replay[0].result_json) as CommentPinResult), replayed: true };
        const homes = await transaction.query<Array<{ version: bigint; owner_name: string }>>(
          `SELECT home.version,profile.current_display_name AS owner_name FROM player_homes home
           JOIN player_profiles profile ON profile.player_id=home.player_id WHERE home.player_id=? FOR UPDATE`, [request.playerId],
        );
        const home = homes[0];
        if (!home || home.version !== request.expectedHomeVersion) throw new CommentPinError("COMMENT_PIN_VERSION_CONFLICT", "댓글 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
        const comments = await transaction.query<Array<{ author_name: string; body: string }>>(
          `SELECT profile.current_display_name AS author_name,comment.body FROM home_comments comment
           JOIN player_profiles profile ON profile.player_id=comment.author_player_id
           WHERE comment.id=? AND comment.home_player_id=? AND comment.status='visible' AND comment.deleted_at IS NULL FOR UPDATE`,
          [request.target.commentId, request.playerId],
        );
        const comment = comments[0];
        if (!comment) throw new CommentPinError("COMMENT_NOT_FOUND", "해당 댓글을 찾을 수 없습니다.");
        const pins = await transaction.query<Array<{ pin_id: string; comment_id: bigint; display_order: number }>>(
          `SELECT pin_id,comment_id,display_order FROM home_comment_pins
           WHERE home_player_id=? AND deleted_at IS NULL ORDER BY display_order,pin_id FOR UPDATE`, [request.playerId],
        );
        if (pins.some((pin) => pin.comment_id.toString() === request.target.commentId)) throw new CommentPinError("COMMENT_ALREADY_PINNED", "이미 고정된 댓글입니다📌");
        if (pins.length >= 3) throw new CommentPinError("COMMENT_PIN_FULL", "댓글핀이 가득 차있습니다.\n/댓글핀삭제 [번호]로 댓글핀을 삭제해주세요.");
        const operation = await transaction.execute(
          `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
           VALUES (?, 'home.comment.pin', ?, 'player', ?, 'iris', 'processing')`, [randomUUID(),request.requestKey,request.playerId],
        );
        const pinId = `PIN-${randomUUID()}`;
        const displayOrder = pins.length + 1;
        await transaction.execute(
          "INSERT INTO home_comment_pins(pin_id,home_player_id,comment_id,display_order) VALUES (?,?,?,?)",
          [pinId,request.playerId,request.target.commentId,displayOrder],
        );
        await transaction.execute("UPDATE player_homes SET version=version+1 WHERE player_id=? AND version=?", [request.playerId,request.expectedHomeVersion]);
        const message = `[${home.owner_name}]님\n해당 댓글을 방명록 상단에 고정했습니다📌\n관련명령어: /댓글핀 [댓글번호]\n\n${displayOrder}번에📌 고정 \"[${comment.author_name}]: ${comment.body}\"\n\n❤️집주인이 좋아하는 댓글❤️ 영역에 표시됩니다.`;
        let result: CommentPinResult = { replayed:false,pinId,commentId:request.target.commentId,displayOrder,message };
        await transaction.execute(
          `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
           VALUES (?,'HOME_COMMENT_PIN',?,'completed','success',UTC_TIMESTAMP(3))`, [request.requestKey,operation.insertId],
        );
        await transaction.execute(
          `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
           VALUES (?,'player',?,'home_comment',?,'HOME_COMMENT_PIN','success',?)`,
          [operation.insertId,request.playerId,request.target.commentId,JSON.stringify({pinId,commentId:request.target.commentId,displayOrder,body:comment.body})],
        );
        if(request.replyDestinationId){
          const outbox=await transaction.execute(
            `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status)
             VALUES (?,'iris',?,'text',?,'pending')`,
            [operation.insertId,request.replyDestinationId,JSON.stringify({room:request.replyDestinationId,data:message})],
          );
          result={...result,outboxId:outbox.insertId.toString()};
        }
        await transaction.execute(
          `INSERT INTO home_comment_pin_mutations(request_key,operation_id,player_id,pin_id,comment_id,result_json)
           VALUES (?,?,?,?,?,?)`, [request.requestKey,operation.insertId,request.playerId,pinId,request.target.commentId,JSON.stringify(result)],
        );
        await transaction.execute("UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operation.insertId]);
        return result;
      });
    } catch(error){
      const code=typeof error==="object"&&error!==null&&"code" in error?(error as {code?:unknown}).code:undefined;
      if(code==="ER_LOCK_DEADLOCK"||code==="ER_LOCK_WAIT_TIMEOUT"||code==="ER_DUP_ENTRY") throw new CommentPinError("COMMENT_PIN_VERSION_CONFLICT","댓글 목록이 먼저 변경되었습니다. 다시 확인해 주세요.");
      throw error;
    }
  }
}
