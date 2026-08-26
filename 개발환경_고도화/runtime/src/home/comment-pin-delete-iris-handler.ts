import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { CommentPinDeleteError, parseCommentPinDeleteCommand } from "./comment-pin-delete-command.js";
import { CommentPinDeleteService } from "./comment-pin-delete-service.js";
import { MariaCommentPinDeleteRepository } from "./maria-comment-pin-delete-repository.js";

// 연결된 Kakao identity의 player가 자신의 댓글 핀 삭제를 실행하도록 연결합니다.
export class CommentPinDeleteIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId?: string }> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new CommentPinDeleteError("COMMENT_PIN_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.");
    }
    const command = parseCommentPinDeleteCommand(event.message);
    if (!command) throw new CommentPinDeleteError("COMMENT_PIN_COMMAND_INVALID", "댓글 핀 삭제 명령 형식을 확인해 주세요.");
    const players = await this.database.query<Array<{ player_id: bigint }>>(
      `SELECT identity.player_id FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY identity.player_id LIMIT 2`,
      [event.userId],
    );
    if (players.length !== 1) throw new CommentPinDeleteError("PLAYER_IDENTITY_REQUIRED", "가입된 사용자 정보를 확인할 수 없습니다.");
    return new CommentPinDeleteService(new MariaCommentPinDeleteRepository(this.database)).execute({
      command,
      requestKey: event.eventId,
      playerId: players[0]!.player_id.toString(),
      replyDestinationId: command.kind === "REMOVE" ? event.channelId : undefined,
    });
  }
}
