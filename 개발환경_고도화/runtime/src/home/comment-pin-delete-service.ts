import { CommentPinDeleteError, type CommentPinDeleteCommand } from "./comment-pin-delete-command.js";

export interface CommentPinProjection {
  pinId: string;
  displayOrder: number;
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface CommentPinSnapshot {
  homeVersion: bigint;
  hasPet: boolean;
  hasActivePass: boolean;
  pins: readonly CommentPinProjection[];
}

export interface CommentPinDeleteResult {
  replayed: boolean;
  pinId: string;
  message: string;
  outboxId?: string;
}

export interface CommentPinDeleteRepository {
  findReplay(requestKey: string): Promise<CommentPinDeleteResult | undefined>;
  readSnapshot(playerId: string): Promise<CommentPinSnapshot | undefined>;
  remove(request: {
    requestKey: string;
    playerId: string;
    pinId: string;
    expectedHomeVersion: bigint;
    replyDestinationId?: string;
  }): Promise<CommentPinDeleteResult>;
}

export class CommentPinDeleteService {
  public constructor(private readonly repository: CommentPinDeleteRepository) {}

  // 안내는 mutation 없이 반환하고 숫자형 삭제만 stable pin ID로 실행합니다.
  public async execute(input: {
    command: CommentPinDeleteCommand;
    requestKey: string;
    playerId: string;
    replyDestinationId?: string;
  }): Promise<CommentPinDeleteResult> {
    if (input.command.kind === "GUIDE") {
      return { replayed: false, pinId: "", message: "📌 사용법 : /댓글핀삭제 [번호]" };
    }
    const replay = await this.repository.findReplay(input.requestKey);
    if (replay) return replay;
    const snapshot = await this.repository.readSnapshot(input.playerId);
    if (!snapshot) throw new CommentPinDeleteError("HOME_NOT_FOUND", "펫홈을 찾을 수 없습니다.");
    if (!snapshot.hasActivePass) throw new CommentPinDeleteError("HOME_PASS_REQUIRED", "사용 가능한 호이패스 또는 초보패스가 필요합니다.");
    if (!snapshot.hasPet) throw new CommentPinDeleteError("PET_REQUIRED", "펫을 먼저 생성해 주세요.");
    const target = snapshot.pins[input.command.listNumber - 1];
    if (!target) throw new CommentPinDeleteError("COMMENT_PIN_NUMBER_INVALID", "댓글 핀 번호를 확인해 주세요.");
    return this.repository.remove({
      requestKey: input.requestKey,
      playerId: input.playerId,
      pinId: target.pinId,
      expectedHomeVersion: snapshot.homeVersion,
      replyDestinationId: input.replyDestinationId,
    });
  }
}
