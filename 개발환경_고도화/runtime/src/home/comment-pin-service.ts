import { CommentPinError, type CommentPinCommand } from "./comment-pin-command.js";

export interface CommentPinTarget {
  commentId: string;
  authorName: string;
  body: string;
  createdAt: Date;
  pinned: boolean;
}

export interface CommentPinSnapshot {
  homeVersion: bigint;
  homeOwnerName: string;
  hasPet: boolean;
  hasActivePass: boolean;
  activePinCount: number;
  comments: readonly CommentPinTarget[];
}

export interface CommentPinResult {
  replayed: boolean;
  pinId: string;
  commentId: string;
  displayOrder: number;
  message: string;
  outboxId?: string;
}

export interface CommentPinRepository {
  findReplay(requestKey: string): Promise<CommentPinResult | undefined>;
  readSnapshot(playerId: string): Promise<CommentPinSnapshot | undefined>;
  add(request: {
    requestKey: string;
    playerId: string;
    target: CommentPinTarget;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentPinResult>;
}

export class CommentPinService {
  public constructor(private readonly repository: CommentPinRepository) {}

  // 최신순 번호를 stable comment ID로 확정하고 최대 세 개의 핀에 등록합니다.
  public async execute(input: {
    command: CommentPinCommand;
    requestKey: string;
    playerId: string;
    replyDestinationId?: string;
  }): Promise<CommentPinResult> {
    if (input.command.kind === "GUIDE") {
      return { replayed: false, pinId: "", commentId: "", displayOrder: 0, message: "사용법: /댓글핀 [댓글번호]\n예시: /댓글핀 3" };
    }
    const replay = await this.repository.findReplay(input.requestKey);
    if (replay) return replay;
    const snapshot = await this.repository.readSnapshot(input.playerId);
    if (!snapshot) throw new CommentPinError("HOME_NOT_FOUND", "펫홈을 찾을 수 없습니다.");
    if (!snapshot.hasActivePass) throw new CommentPinError("HOME_PASS_REQUIRED", "펫홈 댓글 기능은 호이패스 또는 초보패스 활성 가입자만 이용할 수 있습니다.");
    if (!snapshot.hasPet) throw new CommentPinError("PET_REQUIRED", "펫을 먼저 생성해 주세요.");
    const target = snapshot.comments[input.command.listNumber - 1];
    if (!target) throw new CommentPinError("COMMENT_NUMBER_INVALID", "해당 댓글 번호를 찾을 수 없습니다.\n방명록 댓글 번호를 다시 확인해주세요.");
    if (target.pinned) throw new CommentPinError("COMMENT_ALREADY_PINNED", "이미 고정된 댓글입니다📌");
    if (snapshot.activePinCount >= 3) throw new CommentPinError("COMMENT_PIN_FULL", "댓글핀이 가득 차있습니다.\n/댓글핀삭제 [번호]로 댓글핀을 삭제해주세요.");
    return this.repository.add({
      requestKey: input.requestKey,
      playerId: input.playerId,
      target,
      expectedHomeVersion: snapshot.homeVersion,
      replyDestinationId: input.replyDestinationId,
    });
  }
}
