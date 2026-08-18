import { ApplicationError } from "../shared/application-error.js";
import {
  GUILD_JOIN_TICKET_NAME,
  buildGuildExperienceRequiredMessage,
  buildGuildJoinCompletedMessage,
  buildGuildJoinConfirmationMessage,
  evaluateGuildJoin,
  isGuildJoinCancellation,
  isGuildJoinConfirmation,
  parseGuildJoinCommand,
  sortJoinableGuilds,
  type GuildJoinCandidate
} from "./guild-join-policy.js";
import type {
  GuildJoinCommandRecord,
  GuildJoinPlayer,
  GuildJoinRepository,
  GuildJoinResult,
  GuildJoinTransaction
} from "./guild-join-repository.js";

export interface GuildJoinCommandInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

// 길드가입 전제인 회원·미가입·가입권 보유 상태를 검사합니다.
function requireJoinablePlayer(player: GuildJoinPlayer | null): GuildJoinPlayer {
  if (player === null) throw new ApplicationError("GUILD_JOIN_PLAYER_REQUIRED", "회원 데이터가 존재하지 않습니다.", 404);
  if (player.currentGuildId !== null) throw new ApplicationError("ALREADY_GUILD_MEMBER", "❌ 이미 길드에 가입되어 있습니다.", 409);
  if (player.joinTicketQuantity < 1n) {
    throw new ApplicationError("GUILD_JOIN_TICKET_REQUIRED", "❌ 길드가입권🍭 아이템이 없습니다.\n'/길드상점'에서 구매해주세요.", 409);
  }
  return player;
}

// 길드 상태와 가입 EXP를 레거시 오류 문구로 재검증합니다.
function requireEligibleGuild(candidate: GuildJoinCandidate, playerExperience: bigint): void {
  const eligibility = evaluateGuildJoin(candidate, playerExperience);
  if (eligibility.reason === "closed") throw new ApplicationError("GUILD_JOIN_CLOSED", "❌ 길드가 인원마감 상태입니다.", 409);
  if (eligibility.reason === "full") throw new ApplicationError("GUILD_MEMBER_LIMIT_REACHED", "❌ 길드 정원이 가득 찼습니다.", 409);
  if (eligibility.reason === "experience_required") {
    throw new ApplicationError(
      "GUILD_JOIN_EXPERIENCE_REQUIRED",
      buildGuildExperienceRequiredMessage(candidate.joinRequirementExperience, playerExperience),
      409
    );
  }
}

// command execution·audit·outbox에 공통으로 기록할 길드가입 결과를 완성합니다.
async function complete(
  transaction: GuildJoinTransaction,
  operationId: string,
  record: GuildJoinCommandRecord,
  result: GuildJoinResult
): Promise<GuildJoinResult> {
  return transaction.completeCommand(operationId, record, result);
}

// 확정 시 바뀐 가입 조건을 답장으로 남기고 대기 요청을 무효화합니다.
async function invalidateConfirmation(
  transaction: GuildJoinTransaction,
  operationId: string,
  command: GuildJoinCommandInput,
  player: GuildJoinPlayer,
  guildId: string,
  guildNo: number,
  data: string
): Promise<GuildJoinResult> {
  await transaction.clearPendingJoin(player.playerId, "invalidated");
  return complete(transaction, operationId, {
    eventId: command.eventId,
    commandCode: "guild_join_confirm",
    playerId: player.playerId,
    guildId,
    actionCode: "guild.join.invalidated",
    channelId: command.channelId,
    data,
    changeSummary: { guildId, guildNo, invalidated: true }
  }, { status: "failed", data, guildId });
}

// 길드가입 요청·확정·취소를 재시작 가능한 저장 계약으로 오케스트레이션합니다.
export class GuildJoinService {
  constructor(private readonly repository: GuildJoinRepository) {}

  // 정확한 길드가입 명령만 해당 유스케이스로 전달합니다.
  async handle(command: GuildJoinCommandInput): Promise<GuildJoinResult> {
    const guildNo = parseGuildJoinCommand(command.message);
    if (guildNo !== null) return this.request(command, guildNo);
    if (isGuildJoinConfirmation(command.message)) return this.confirm(command);
    if (isGuildJoinCancellation(command.message)) return this.cancel(command);
    return { status: "ignored" };
  }

  // 가입 가능한 길드 번호를 검증하고 확인 대기 상태를 영속화합니다.
  private async request(command: GuildJoinCommandInput, guildNo: number): Promise<GuildJoinResult> {
    return this.repository.runInTransaction(async (transaction) => {
      const lockedPlayer = await transaction.lockPlayer(command.externalUserId);
      if (lockedPlayer === null) {
        throw new ApplicationError("GUILD_JOIN_PLAYER_REQUIRED", "회원 데이터가 존재하지 않습니다.", 404);
      }
      const prior = await transaction.readPriorResult(command.eventId, "guild_join_request", lockedPlayer.playerId);
      if (prior !== null) return prior;
      const player = requireJoinablePlayer(lockedPlayer);
      const operationId = await transaction.startCommand(command.eventId, "guild_join_request", player.playerId);

      const rows = sortJoinableGuilds(await transaction.listJoinableGuilds());
      const candidate = rows[guildNo - 1];
      if (candidate === undefined) throw new ApplicationError("GUILD_NOT_FOUND_BY_NUMBER", "❌ 해당 번호의 길드가 없습니다.", 404);
      requireEligibleGuild(candidate, player.experience);

      await transaction.savePendingJoin(player.playerId, candidate.guildId, guildNo, command.eventId);
      const data = buildGuildJoinConfirmationMessage(player.rankLabel, candidate);
      return complete(transaction, operationId, {
        eventId: command.eventId,
        commandCode: "guild_join_request",
        playerId: player.playerId,
        guildId: candidate.guildId,
        actionCode: "guild.join.requested",
        channelId: command.channelId,
        data,
        changeSummary: { guildId: candidate.guildId, guildNo, ticketName: GUILD_JOIN_TICKET_NAME }
      }, { status: "pending", data, guildId: candidate.guildId });
    });
  }

  // 확정 직전에 회원·길드·가입권 조건을 다시 잠그고 가입을 원자적으로 완료합니다.
  private async confirm(command: GuildJoinCommandInput): Promise<GuildJoinResult> {
    return this.repository.runInTransaction(async (transaction) => {
      const player = await transaction.lockPlayer(command.externalUserId);
      if (player === null) return { status: "ignored" };
      const prior = await transaction.readPriorResult(command.eventId, "guild_join_confirm", player.playerId);
      if (prior !== null) return prior;
      const pending = await transaction.lockPendingJoin(player.playerId);
      if (pending === null) return { status: "ignored" };
      const operationId = await transaction.startCommand(command.eventId, "guild_join_confirm", player.playerId);
      if (player.currentGuildId !== null) {
        return invalidateConfirmation(transaction, operationId, command, player, pending.guildId, pending.guildNo, "❌ 이미 길드에 가입되어 있습니다.");
      }
      if (player.joinTicketQuantity < 1n) {
        return invalidateConfirmation(transaction, operationId, command, player, pending.guildId, pending.guildNo,
          "❌ 길드가입권🍭 아이템이 없습니다.\n'/길드상점'에서 구매해주세요.");
      }
      const candidate = await transaction.lockGuild(pending.guildId);
      if (candidate === null) {
        return invalidateConfirmation(transaction, operationId, command, player, pending.guildId, pending.guildNo,
          "❌ 길드가 존재하지 않거나 삭제되었습니다.");
      }
      const eligibility = evaluateGuildJoin(candidate, player.experience);
      if (eligibility.reason === "closed") {
        return invalidateConfirmation(transaction, operationId, command, player, candidate.guildId, pending.guildNo, "❌ 길드가 인원마감 상태입니다.");
      }
      if (eligibility.reason === "full") {
        return invalidateConfirmation(transaction, operationId, command, player, candidate.guildId, pending.guildNo, "❌ 길드 정원이 가득 찼습니다.");
      }
      if (eligibility.reason === "experience_required") {
        return invalidateConfirmation(transaction, operationId, command, player, candidate.guildId, pending.guildNo,
          buildGuildExperienceRequiredMessage(candidate.joinRequirementExperience, player.experience));
      }

      await transaction.addMembershipAndSpendTicket(operationId, player.playerId, candidate.guildId);
      await transaction.clearPendingJoin(player.playerId, "completed");
      const data = buildGuildJoinCompletedMessage(candidate);
      return complete(transaction, operationId, {
        eventId: command.eventId,
        commandCode: "guild_join_confirm",
        playerId: player.playerId,
        guildId: candidate.guildId,
        actionCode: "guild.join.completed",
        channelId: command.channelId,
        data,
        changeSummary: { guildId: candidate.guildId, guildNo: pending.guildNo, ticketQuantityDelta: -1 }
      }, { status: "completed", data, guildId: candidate.guildId });
    });
  }

  // 진행 중인 가입 요청을 취소하고 취소 답장을 원장과 함께 저장합니다.
  private async cancel(command: GuildJoinCommandInput): Promise<GuildJoinResult> {
    return this.repository.runInTransaction(async (transaction) => {
      const player = await transaction.lockPlayer(command.externalUserId);
      if (player === null) return { status: "ignored" };
      const prior = await transaction.readPriorResult(command.eventId, "guild_join_cancel", player.playerId);
      if (prior !== null) return prior;
      const pending = await transaction.lockPendingJoin(player.playerId);
      if (pending === null) return { status: "ignored" };

      const operationId = await transaction.startCommand(command.eventId, "guild_join_cancel", player.playerId);
      await transaction.clearPendingJoin(player.playerId, "cancelled");
      const data = "❎ 길드가입이 취소되었습니다.";
      return complete(transaction, operationId, {
        eventId: command.eventId,
        commandCode: "guild_join_cancel",
        playerId: player.playerId,
        guildId: pending.guildId,
        actionCode: "guild.join.cancelled",
        channelId: command.channelId,
        data,
        changeSummary: { guildId: pending.guildId, guildNo: pending.guildNo }
      }, { status: "cancelled", data, guildId: pending.guildId });
    });
  }
}
