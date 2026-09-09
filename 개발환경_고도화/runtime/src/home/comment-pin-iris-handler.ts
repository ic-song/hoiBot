import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { CommentPinError, parseCommentPinCommand } from "./comment-pin-command.js";
import { CommentPinService } from "./comment-pin-service.js";
import { MariaCommentPinRepository } from "./maria-comment-pin-repository.js";

// 연결된 Kakao identity의 player가 자신의 펫홈 댓글 핀을 등록하도록 연결합니다.
export class CommentPinIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{message:string;replayed:boolean;outboxId?:string}> {
    if(!event.userId||!event.channelId||!event.message) throw new CommentPinError("COMMENT_PIN_IDENTITY_REQUIRED","사용자 식별 정보를 확인할 수 없습니다.");
    const command=parseCommentPinCommand(event.message);
    if(!command) throw new CommentPinError("COMMENT_PIN_COMMAND_INVALID","댓글 핀 명령 형식을 확인해 주세요.");
    const players=await this.database.query<Array<{player_id:bigint}>>(
      `SELECT identity.player_id FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
       ORDER BY identity.player_id LIMIT 2`,[event.userId],
    );
    if(players.length!==1) throw new CommentPinError("PLAYER_IDENTITY_REQUIRED","가입된 사용자 정보를 확인할 수 없습니다.");
    return new CommentPinService(new MariaCommentPinRepository(this.database)).execute({
      command,requestKey:event.eventId,playerId:players[0]!.player_id.toString(),replyDestinationId:command.kind==="PIN"?event.channelId:undefined,
    });
  }
}
