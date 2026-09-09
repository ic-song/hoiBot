import type { DatabaseClient } from "../database.js";
import type { NormalizedIrisEvent } from "../integration/iris-normalizer.js";
import { ApplicationError } from "../shared/application-error.js";
import { GuildBoardService, isGuildBoardCommandCandidate } from "./guild-board-service.js";

// 길드 게시판 명령을 원자 guild board transaction에 연결합니다.
export class GuildBoardIrisHandler {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(event: NormalizedIrisEvent): Promise<{ message: string; room: string; replayed: boolean; outboxId: string } | null> {
    if (!isGuildBoardCommandCandidate(event.message)) throw new ApplicationError("GUILD_BOARD_COMMAND_INVALID", "길드 게시판 명령 형식을 확인해 주세요.", 422);
    if (!event.userId || !event.channelId) return null;
    const result = await new GuildBoardService(this.database).execute({ eventId: event.eventId, externalUserId: event.userId, destinationId: event.channelId, message: event.message! });
    return { message: result.data, room: event.channelId, replayed: result.replayed, outboxId: result.outboxId };
  }
}
