import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { CommentDeleteError, parseCommentDeleteCommand } from "./comment-delete-command.js";
import { CommentDeleteService } from "./comment-delete-service.js";
import { MariaCommentDeleteRepository } from "./maria-comment-delete-repository.js";

// 연결된 Kakao identity의 player가 자신의 펫홈 댓글 삭제를 실행하도록 연결합니다.
export class CommentDeleteIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; replayed: boolean; outboxId?: string }> {
    if (!event.userId || !event.channelId || !event.message) {
      throw new CommentDeleteError("COMMENT_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.");
    }
    const command = parseCommentDeleteCommand(event.message);
    if (!command) throw new CommentDeleteError("COMMENT_COMMAND_INVALID", "댓글 삭제 명령 형식을 확인해 주세요.");
    const players = await this.database.query<Array<{ player_id: bigint }>>(
      `SELECT identity.player_id FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY identity.player_id LIMIT 2`,
      [event.userId],
    );
    if (players.length !== 1) throw new CommentDeleteError("PLAYER_IDENTITY_REQUIRED", "가입된 사용자 정보를 확인할 수 없습니다.");
    return new CommentDeleteService(new MariaCommentDeleteRepository(this.database)).execute({
      command,
      requestKey: event.eventId,
      playerId: players[0]!.player_id.toString(),
      replyDestinationId: command.kind === "REMOVE" ? event.channelId : undefined,
    });
  }
}
