export type HomeSocialFollowCommandCode = "home_social_follow" | "home_social_unfollow" | "home_social_followers" | "home_social_following";
export type HomeSocialFollowStatus = "completed" | "rejected" | "ignored";

export interface HomeSocialFollowResult {
  status: HomeSocialFollowStatus;
  data?: string;
  auditId?: string;
  outboxId?: string;
}

export interface HomeSocialFollowPlayer {
  playerId: string;
  displayName: string;
  rankLabel: string;
  activePass: boolean;
  premiumPass: boolean;
}

export interface HomeSocialTargetMatch extends HomeSocialFollowPlayer {
  rest: string;
}

export interface HomeSocialFollowListRow {
  playerId: string;
  rankLabel: string;
  mutual: boolean;
}

export interface HomeSocialFollowCompletion {
  eventId: string;
  commandCode: HomeSocialFollowCommandCode;
  actorPlayerId: string;
  targetPlayerId: string | null;
  actionCode: string;
  channelId: string;
  data: string;
  resultCode: "success" | "rejected";
  changeSummary: Record<string, unknown>;
}

export interface HomeSocialFollowTransaction {
  resolveActor(providerCode: string, externalUserId: string): Promise<HomeSocialFollowPlayer | null>;
  findTargetAtStart(content: string): Promise<HomeSocialTargetMatch | null>;
  lockPlayersOrdered(playerIds: string[]): Promise<HomeSocialFollowPlayer[]>;
  readPriorResult(eventId: string, commandCode: HomeSocialFollowCommandCode, actorPlayerId: string): Promise<HomeSocialFollowResult | null>;
  startCommand(eventId: string, commandCode: HomeSocialFollowCommandCode, actorPlayerId: string): Promise<string>;
  isFollowing(followerPlayerId: string, followedPlayerId: string): Promise<boolean>;
  setFollowing(followerPlayerId: string, followedPlayerId: string, active: boolean): Promise<void>;
  addAlert(operationId: string, targetPlayerId: string, actorPlayerId: string, type: "follow" | "unfollow", mutual: boolean): Promise<void>;
  awardEligibleBadges(operationId: string, playerId: string): Promise<string[]>;
  recordActivity(operationId: string, homePlayerId: string, actorPlayerId: string, activityCode: "follow" | "unfollow", detail: Record<string, unknown>): Promise<void>;
  countFollowing(playerId: string): Promise<number>;
  readList(playerId: string, type: "followers" | "following"): Promise<HomeSocialFollowListRow[]>;
  completeCommand(operationId: string, completion: HomeSocialFollowCompletion, result: HomeSocialFollowResult): Promise<HomeSocialFollowResult>;
}

export interface HomeSocialFollowRepository {
  runInTransaction<T>(work: (transaction: HomeSocialFollowTransaction) => Promise<T>): Promise<T>;
}

export interface HomeSocialFollowInput {
  providerCode: string;
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

type ParsedCommand =
  | { kind: "follow" | "unfollow"; targetText: string; commandCode: HomeSocialFollowCommandCode }
  | { kind: "list"; listType: "followers" | "following"; commandCode: HomeSocialFollowCommandCode };

// 팔로우 변경과 두 목록 조회 명령만 legacy guard와 같은 범위로 분류합니다.
export function parseHomeSocialFollowCommand(message: string | null | undefined): ParsedCommand | null {
  if (message === "/팔로워") return { kind: "list", listType: "followers", commandCode: "home_social_followers" };
  if (message === "/팔로잉") return { kind: "list", listType: "following", commandCode: "home_social_following" };
  const match = message?.match(/^\/(팔로우|언팔로우)\s+(.+)$/);
  if (match === null || match === undefined) return null;
  return match[1] === "팔로우"
    ? { kind: "follow", targetText: match[2]!.trim(), commandCode: "home_social_follow" }
    : { kind: "unfollow", targetText: match[2]!.trim(), commandCode: "home_social_unfollow" };
}

// 공용 dispatch가 유사 접두 명령을 소비하지 않도록 exact parser 결과만 사용합니다.
export function isHomeSocialFollowCommandCandidate(message: string | null | undefined): boolean {
  return parseHomeSocialFollowCommand(message) !== null;
}

// legacy 프리미엄 헤더와 비맞팔 우선 안정 순서로 목록 응답을 만듭니다.
export function formatHomeSocialFollowList(
  actor: HomeSocialFollowPlayer,
  type: "followers" | "following",
  rows: HomeSocialFollowListRow[],
  allsee: string
): string {
  const title = type === "followers"
    ? "🐾 팔로워 유저[명령어: /팔로우]\n※ 나에게 관심 있는 사람"
    : "🎀 팔로잉 유저[명령어: /팔로잉]\n※ 내가 관심 있는 사람";
  const ordered = rows.filter((row) => !row.mutual).concat(rows.filter((row) => row.mutual));
  let output = `${actor.premiumPass ? "[👑호이패스 프리미엄👑]\n" : ""}[${actor.rankLabel}] 님\n${title}\n━━━━━━━━━━━━\n`;
  if (ordered.length === 0) return output + "등록된 유저가 없습니다.";
  ordered.forEach((row, index) => {
    output += `${index + 1}. ${row.rankLabel}${row.mutual ? " 🤝맞팔" : ""}\n`;
    if (index === 9) output += allsee + "\n";
  });
  return output.trim();
}

// 기대된 거절도 command execution과 outbox에 원자적으로 남깁니다.
async function reject(
  transaction: HomeSocialFollowTransaction,
  operationId: string,
  input: HomeSocialFollowInput,
  commandCode: HomeSocialFollowCommandCode,
  actorPlayerId: string,
  targetPlayerId: string | null,
  data: string,
  reason: string
): Promise<HomeSocialFollowResult> {
  return transaction.completeCommand(operationId, {
    eventId: input.eventId, commandCode, actorPlayerId, targetPlayerId,
    actionCode: `home.social.${reason}`, channelId: input.channelId, data, resultCode: "rejected",
    changeSummary: { rejected: true, reason }
  }, { status: "rejected", data });
}

// 관계 변경과 목록 조회를 재시작 가능한 단일 transaction으로 오케스트레이션합니다.
export class HomeSocialFollowService {
  constructor(private readonly repository: HomeSocialFollowRepository, private readonly allsee: string) {}

  async handle(input: HomeSocialFollowInput): Promise<HomeSocialFollowResult> {
    const parsed = parseHomeSocialFollowCommand(input.message);
    if (parsed === null) return { status: "ignored" };
    return this.repository.runInTransaction(async (transaction) => {
      const resolvedActor = await transaction.resolveActor(input.providerCode, input.externalUserId);
      if (resolvedActor === null) return { status: "ignored" };
      if (parsed.kind === "list") return this.list(transaction, input, parsed, resolvedActor);
      return this.mutate(transaction, input, parsed, resolvedActor);
    });
  }

  private async list(
    transaction: HomeSocialFollowTransaction,
    input: HomeSocialFollowInput,
    parsed: Extract<ParsedCommand, { kind: "list" }>,
    resolvedActor: HomeSocialFollowPlayer
  ): Promise<HomeSocialFollowResult> {
    const actor = (await transaction.lockPlayersOrdered([resolvedActor.playerId]))[0];
    if (actor === undefined) return { status: "ignored" };
    const prior = await transaction.readPriorResult(input.eventId, parsed.commandCode, actor.playerId);
    if (prior !== null) return prior;
    const operationId = await transaction.startCommand(input.eventId, parsed.commandCode, actor.playerId);
    if (!actor.activePass) {
      return reject(transaction, operationId, input, parsed.commandCode, actor.playerId, null,
        "❌ 팔로우 목록은 호이패스·초보패스 이용자만 확인할 수 있습니다.", "pass_required");
    }
    const data = formatHomeSocialFollowList(actor, parsed.listType, await transaction.readList(actor.playerId, parsed.listType), this.allsee);
    return transaction.completeCommand(operationId, {
      eventId: input.eventId, commandCode: parsed.commandCode, actorPlayerId: actor.playerId, targetPlayerId: actor.playerId,
      actionCode: `home.social.${parsed.listType}.read`, channelId: input.channelId, data, resultCode: "success",
      changeSummary: { listType: parsed.listType, mutation: false }
    }, { status: "completed", data });
  }

  private async mutate(
    transaction: HomeSocialFollowTransaction,
    input: HomeSocialFollowInput,
    parsed: Extract<ParsedCommand, { kind: "follow" | "unfollow" }>,
    resolvedActor: HomeSocialFollowPlayer
  ): Promise<HomeSocialFollowResult> {
    const actor = (await transaction.lockPlayersOrdered([resolvedActor.playerId]))[0];
    if (actor === undefined) return { status: "ignored" };
    const prior = await transaction.readPriorResult(input.eventId, parsed.commandCode, actor.playerId);
    if (prior !== null) return prior;
    const operationId = await transaction.startCommand(input.eventId, parsed.commandCode, actor.playerId);
    const targetMatch = await transaction.findTargetAtStart(parsed.targetText);
    if (targetMatch === null) {
      return reject(transaction, operationId, input, parsed.commandCode, actor.playerId, null,
        "존재하지 않는 아이디입니다.\n아이디를 다시 확인해 주세요.", "target_not_found");
    }
    if (targetMatch.rest !== "") {
      const commandName = parsed.kind === "follow" ? "팔로우" : "언팔로우";
      return reject(transaction, operationId, input, parsed.commandCode, actor.playerId, targetMatch.playerId,
        `사용법: /${commandName} [아이디]\n아이디 뒤에는 다른 문구를 입력할 수 없습니다.`, "suffix_rejected");
    }
    if (targetMatch.playerId === actor.playerId) {
      return reject(transaction, operationId, input, parsed.commandCode, actor.playerId, targetMatch.playerId,
        "❌ 본인은 팔로우할 수 없습니다.", "self_rejected");
    }
    const locked = await transaction.lockPlayersOrdered([actor.playerId, targetMatch.playerId]);
    const lockedActor = locked.find((player) => player.playerId === actor.playerId);
    const target = locked.find((player) => player.playerId === targetMatch.playerId);
    if (lockedActor === undefined || target === undefined) {
      return reject(transaction, operationId, input, parsed.commandCode, actor.playerId, targetMatch.playerId,
        "존재하지 않는 아이디입니다.\n아이디를 다시 확인해 주세요.", "target_not_found");
    }
    if (parsed.kind === "follow" && !lockedActor.activePass) {
      return reject(transaction, operationId, input, parsed.commandCode, lockedActor.playerId, target.playerId,
        "❌ 팔로잉 기능은 호이패스·초보패스 전용입니다.\n호이패스 또는 초보패스 가입 후 이용해 주세요.", "sender_pass_required");
    }
    if (parsed.kind === "follow" && !target.activePass) {
      return reject(transaction, operationId, input, parsed.commandCode, lockedActor.playerId, target.playerId,
        "❌ 해당 유저는 호이패스·초보패스 미가입 유저입니다.\n패스 가입 유저끼리만 서로 팔로우할 수 있습니다.", "target_pass_required");
    }
    const alreadyFollowing = await transaction.isFollowing(lockedActor.playerId, target.playerId);
    if (parsed.kind === "follow" && alreadyFollowing) {
      return reject(transaction, operationId, input, parsed.commandCode, lockedActor.playerId, target.playerId,
        `⚠️ 이미 ${target.rankLabel}님을 팔로우하고 있습니다.`, "duplicate_follow");
    }
    if (parsed.kind === "unfollow" && !alreadyFollowing) {
      return reject(transaction, operationId, input, parsed.commandCode, lockedActor.playerId, target.playerId,
        `❌ ${target.rankLabel}님은 현재 팔로잉 유저가 아닙니다.`, "not_following");
    }

    const active = parsed.kind === "follow";
    await transaction.setFollowing(lockedActor.playerId, target.playerId, active);
    const mutual = active && await transaction.isFollowing(target.playerId, lockedActor.playerId);
    await transaction.addAlert(operationId, target.playerId, lockedActor.playerId, active ? "follow" : "unfollow", mutual);
    const actorBadges = active ? await transaction.awardEligibleBadges(operationId, lockedActor.playerId) : [];
    const targetBadges = active ? await transaction.awardEligibleBadges(operationId, target.playerId) : [];
    await transaction.recordActivity(operationId, target.playerId, lockedActor.playerId, active ? "follow" : "unfollow", { mutual });
    const followingCount = await transaction.countFollowing(lockedActor.playerId);
    const data = active
      ? `${mutual ? "🤝 " : "✅ "}${target.rankLabel}${mutual ? " 님과 맞팔이 되었습니다!\n맞팔 혜택으로 마음표현을 1개 더 사용할 수 있습니다." : `님을 팔로우했습니다.\n현재 팔로잉: ${followingCount}명`}`
      : `✅ ${target.rankLabel}님의 팔로우를 해제했습니다.\n현재 팔로잉: ${followingCount}명`;
    return transaction.completeCommand(operationId, {
      eventId: input.eventId, commandCode: parsed.commandCode, actorPlayerId: lockedActor.playerId, targetPlayerId: target.playerId,
      actionCode: active ? "home.social.followed" : "home.social.unfollowed", channelId: input.channelId, data, resultCode: "success",
      changeSummary: { targetPlayerId: target.playerId, active, mutual, followingCount, actorBadges, targetBadges }
    }, { status: "completed", data });
  }
}
