import { CommentDeleteError, type CommentDeleteCommand } from "./comment-delete-command.js";

export interface CommentDeleteProjection {
  commentId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  pinned: boolean;
}

export interface CommentDeleteSnapshot {
  homeVersion: bigint;
  hasActivePass: boolean;
  comments: readonly CommentDeleteProjection[];
}

export interface CommentDeleteResult {
  replayed: boolean;
  commentId: string;
  message: string;
  outboxId?: string;
}

export interface CommentDeleteRepository {
  findReplay(requestKey: string): Promise<CommentDeleteResult | undefined>;
  readSnapshot(playerId: string): Promise<CommentDeleteSnapshot>;
  remove(request: {
    requestKey: string;
    playerId: string;
    comment: CommentDeleteProjection;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentDeleteResult>;
}

export class CommentDeleteService {
  public constructor(private readonly repository: CommentDeleteRepository) {}

  // 최신순 번호를 stable comment ID로 확정한 뒤 고정 여부를 확인하고 삭제합니다.
  public async execute(input: {
    command: CommentDeleteCommand;
    requestKey: string;
    playerId: string;
    replyDestinationId?: string;
  }): Promise<CommentDeleteResult> {
    if (input.command.kind === "GUIDE") {
      return { replayed: false, commentId: "", message: "사용법: /댓글삭제 [번호]\n예시: /댓글삭제 1" };
    }
    const replay = await this.repository.findReplay(input.requestKey);
    if (replay) return replay;
    const snapshot = await this.repository.readSnapshot(input.playerId);
    if (!snapshot.hasActivePass) {
      throw new CommentDeleteError("HOME_PASS_REQUIRED", "펫홈 댓글 기능은 호이패스 또는 초보패스 활성 가입자만 이용할 수 있습니다.");
    }
    if (snapshot.comments.length === 0) throw new CommentDeleteError("COMMENT_EMPTY", "삭제할 댓글이 없습니다.");
    const target = snapshot.comments[input.command.listNumber - 1];
    if (!target) throw new CommentDeleteError("COMMENT_NUMBER_INVALID", "해당 번호의 댓글이 존재하지 않습니다.");
    if (target.pinned) {
      throw new CommentDeleteError("COMMENT_PINNED", "고정된 댓글은 삭제할 수 없습니다📌\n/댓글핀삭제 [번호]로 상단 고정만 먼저 해제해주세요.");
    }
    return this.repository.remove({
      requestKey: input.requestKey,
      playerId: input.playerId,
      comment: target,
      expectedHomeVersion: snapshot.homeVersion,
      replyDestinationId: input.replyDestinationId,
    });
  }
}
