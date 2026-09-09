import type { DatabaseClient } from "../database.js";
import { MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { MariaPetInfoRepository } from "../pet/maria-pet-info-repository.js";
import { TrialTowerProvider, type TrialTowerResult } from "./trial-tower-provider.js";

const ALL_SEE = "​".repeat(500);
const commas = (value: string | number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// 레거시 실행 명령과 완전히 일치하는 입력만 시련의 탑 후보로 분류합니다.
export function isTrialTowerCommand(message: string): boolean { return message === "/시련의탑"; }

// 공용 provider 결과를 레거시 시련의 탑 카드 형태로 표시합니다.
export function formatTrialTowerResult(result: TrialTowerResult): string {
  if (result.floor === undefined || result.policy === undefined) return result.data;
  const verdict = result.status === "win" ? "승리🏆" : "패배💀";
  return [`😈 시련의 탑 ${result.floor}층`, ALL_SEE, verdict, `최종 매력: ${commas(result.policy.playerFinal)}💕`,
    result.policy.triggeredSkill === null ? "발동 스킬: 없음" : `발동 스킬: ${result.policy.triggeredSkill}`,
    result.policy.guideUsed ? "시탑 공략서 1개 사용" : "시탑 공략서 미사용",
    result.status === "win" ? `잡동사니 ${commas(result.policy.junkReward)}개 획득` : "다음 도전을 준비해주세요."].join("\n");
}

// 정확 dispatch, 공성전 차단, 펫 projection과 시련탑 transaction을 연결합니다.
export class TrialTowerCommandService {
  constructor(private readonly db: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string; recordDate: string; autoBonus?: boolean; masterBypass?: boolean }): Promise<{ status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }> {
    if (!isTrialTowerCommand(input.message)) return { status: "legacy_fallback" };
    const dispatch = new MariaCommandDispatchRepository(this.db), definition = await dispatch.findExact(input.message);
    if (definition === undefined || definition.handlerKey !== "trial_tower" || definition.rolloutState === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode: "TRIAL_TOWER", handlerKey: "trial_tower" });
      return { status: "legacy_fallback" };
    }
    if (definition.rolloutState !== "ACTIVE") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode: definition.commandCode, handlerKey: definition.handlerKey });
      return { status: "shadow" };
    }
    const siege = (await this.db.query<Array<{ active: number }>>("SELECT active FROM guild_territory_wars WHERE active=TRUE LIMIT 1"))[0];
    if (siege?.active === 1) return { status: "handled_no_reply" };
    const view = await new MariaPetInfoRepository(this.db).findByExternalIdentity("kakao", input.externalUserId);
    if (view === null) return { status: "handled_no_reply" };
    const skills = await this.db.query<Array<{ display_name: string }>>(`SELECT definition.display_name FROM player_pets pet JOIN pet_skills assignment ON assignment.player_pet_id=pet.id AND assignment.equipped=TRUE JOIN skill_definitions definition ON definition.id=assignment.skill_id AND definition.active=TRUE WHERE pet.player_id=? ORDER BY assignment.slot_no`, [view.playerId]);
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode: definition.commandCode, handlerKey: definition.handlerKey });
    const result = await new TrialTowerProvider(this.db, this.random).attempt({ eventId: input.eventId, destinationId: input.channelId, playerId: view.playerId, recordDate: input.recordDate, autoBonus: input.autoBonus, masterBypass: input.masterBypass, profile: { charm: Number(view.charm.total), petType: view.pet.typeName, upgrade: Number(view.charm.effectiveEnhancement), skills: skills.map(row => row.display_name) }, format: formatTrialTowerResult });
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }
}
