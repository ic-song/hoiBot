import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";
import type { PetExploreThresholdComponents } from "./pet-explore-settlement-input-snapshot-provider.js";

const MAP_COMMAND = "/지도";
const USER_CHECK_PATTERN = /^\/탐험유저확인(?:\s+(?:[0-9]|10))?$/;
const ALL_SEE = "\u200b".repeat(500);

const DESTINATIONS = [
  ["diamond_mine_event", "다이아 광산"],
  ["pet_enhancement_mine", "펫강화 광산"],
  ["intimacy_mine", "친밀도 광산"],
  ["luck_mine", "행운 광산"],
  ["jeondor_dungeon", "전도 던전"],
  ["chicken_farm_dungeon", "치킨농장 던전"],
  ["land_document_dungeon", "영지권 던전"],
  ["shop_open_dungeon", "상점오픈 던전"],
  ["belcar_maze", "벨카르의 미궁"],
  ["archmage_ruins", "대마법사의 유적"],
  ["guild_raid_event", "길드레이드 던전"],
] as const;

type CommandKind = "map" | "user_check";
type HandleResult = { status: "changed"; data: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" };
type ParticipationRow = {
  participation_id: bigint;
  player_id: bigint;
  display_name: string;
  destination_code: string;
  threshold_components_json: string | PetExploreThresholdComponents | null;
  source_gap_codes_json: string | readonly string[] | null;
};
type FixedRow = { player_id: bigint; display_name: string; destination_code: string };
type RecordRow = { player_name: string; win_count: bigint; lose_count: bigint };
type RuntimeRow = { event_mine_active: number; guild_raid_active: number };
type SchedulerRow = { next_run_at: Date | string | null; interval_minutes: number };
type CleanupCounts = { participation: number; fixed: number; record: number };

// 지도와 관리자 탐험유저확인 명령만 완전 일치 패턴으로 분류합니다.
export function parsePetExploreStatusProjectionCommand(message: string | undefined): { kind: CommandKind; slot: number | null } | null {
  if (message === MAP_COMMAND) return { kind: "map", slot: null };
  if (message === undefined || !USER_CHECK_PATTERN.test(message)) return null;
  const argument = message.match(/\s+(\d+)$/)?.[1];
  return { kind: "user_check", slot: argument === undefined ? null : Number(argument) };
}

function parseJson<T>(value: string | T | null): T | null {
  if (value === null) return null;
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

function destinationName(code: string): string {
  return DESTINATIONS.find(([candidate]) => candidate === code)?.[1] ?? code;
}

function destinationSlot(code: string): number {
  return DESTINATIONS.findIndex(([candidate]) => candidate === code);
}

function formatThreshold(components: PetExploreThresholdComponents | null): string {
  if (components === null) return "성공률 구성요소: 정산 projection 대기";
  const total = Math.max(0, components.base + components.tier + components.experience + components.lord + components.trait + components.pendant + components.homeBadge + components.upItem - components.penalty + components.premium);
  const percent = (total / 100).toFixed(total % 100 === 0 ? 0 : 2);
  return `성공률 ${percent}% (기본 ${components.base / 100}% + 티어 ${components.tier / 100}% + 경험 ${components.experience / 100}% + 영주 ${components.lord / 100}% + 특성 ${components.trait / 100}% + 펜던트 ${components.pendant / 100}% + 홈배지 ${components.homeBadge / 100}% + 아이템 ${components.upItem / 100}% + 프리미엄 ${components.premium / 100}% - 패널티 ${components.penalty / 100}%)`;
}

// 레거시 지도 출력의 현재 탐험지, 인원, 자동고정, 성공률 구성요소를 DB projection으로 렌더링합니다.
export function formatPetExploreMap(input: {
  playerId: bigint;
  participations: readonly ParticipationRow[];
  fixed: readonly FixedRow[];
  runtime: RuntimeRow;
  scheduler: SchedulerRow | null;
}): string {
  const current = input.participations.find((row) => row.player_id === input.playerId);
  const configured = input.fixed.find((row) => row.player_id === input.playerId);
  const next = input.scheduler?.next_run_at === null || input.scheduler?.next_run_at === undefined
    ? `다음 탐험: 대기 중 (${input.scheduler?.interval_minutes ?? 60}분 간격)`
    : `다음 탐험: ${new Date(input.scheduler.next_run_at).toISOString()} (${input.scheduler.interval_minutes}분 간격)`;
  const lines = ["🗺️ 펫탐험 지도🗺️", "※ 현재 DB 탐험 상태를 기준으로 표시합니다.", next];
  if (current === undefined) lines.push("현재 탐험: 참여 중이 아닙니다.");
  else {
    lines.push(`현재 탐험: ${destinationName(current.destination_code)}`);
    lines.push(formatThreshold(parseJson<PetExploreThresholdComponents>(current.threshold_components_json)));
    const gaps = parseJson<readonly string[]>(current.source_gap_codes_json) ?? [];
    if (gaps.length > 0) lines.push(`정책 확인 필요: ${gaps.join(", ")}`);
  }
  lines.push(`자동탐험 고정: ${configured === undefined ? "미설정" : destinationName(configured.destination_code)}`);
  lines.push("━━━━━━━━━━━━");
  for (let slot = 0; slot < DESTINATIONS.length; slot += 1) {
    if (slot === 0 && input.runtime.event_mine_active !== 1) continue;
    if (slot === 10 && input.runtime.guild_raid_active !== 1) continue;
    const code = DESTINATIONS[slot]![0];
    const currentCount = input.participations.filter((row) => row.destination_code === code).length;
    const fixedCount = input.fixed.filter((row) => row.destination_code === code).length;
    lines.push(`${slot}. ${DESTINATIONS[slot]![1]}: 현재 ${currentCount}명 / 자동고정 ${fixedCount}명`);
  }
  return lines.join("\n");
}

// 관리자용 전체/슬롯별 참여자와 자동고정, 전적을 10명 allsee 경계로 출력합니다.
export function formatPetExploreUserCheck(input: {
  slot: number | null;
  participations: readonly ParticipationRow[];
  fixed: readonly FixedRow[];
  records: readonly RecordRow[];
  cleanup: CleanupCounts;
}): string {
  const recordMap = new Map(input.records.map((row) => [row.player_name, row]));
  const cleanup = `🧹 삭제 계정 펫탐험 데이터 정리\n현재참여 ${input.cleanup.participation}건 / 자동탐고정 ${input.cleanup.fixed}건 / 전적 ${input.cleanup.record}건`;
  if (input.slot === null) {
    const rows = DESTINATIONS.map(([code, name], slot) => `${slot}. ${name}: 현재 ${input.participations.filter((row) => row.destination_code === code).length}명 / 자동고정 ${input.fixed.filter((row) => row.destination_code === code).length}명`);
    return ["🔎 펫탐험 유저 확인", ...rows, cleanup].join("\n");
  }
  const code = DESTINATIONS[input.slot]![0];
  const current = input.participations.filter((row) => row.destination_code === code);
  const fixed = input.fixed.filter((row) => row.destination_code === code);
  const rows = current.map((row, index) => {
    const record = recordMap.get(row.display_name);
    const recordLabel = record === undefined ? "전적 없음" : `${record.win_count.toString()}승 ${record.lose_count.toString()}패`;
    return `${index + 1}. [${row.display_name}] 현재탐험 / ${recordLabel}`;
  });
  if (rows.length > 10) rows.splice(10, 0, ALL_SEE);
  const fixedRows = fixed.map((row, index) => `${index + 1}. [${row.display_name}] 자동고정`);
  if (fixedRows.length > 10) fixedRows.splice(10, 0, ALL_SEE);
  return [`🔎 ${input.slot}. ${destinationName(code)}`, `현재참여 ${current.length}명`, ...(rows.length === 0 ? ["참여자가 없습니다."] : rows), `자동고정 ${fixed.length}명`, ...(fixedRows.length === 0 ? ["자동고정 유저가 없습니다."] : fixedRows), cleanup].join("\n");
}

async function cleanupInactive(tx: DatabaseTransaction, eventId: string, actorId: string): Promise<CleanupCounts> {
  const staleParticipations = await tx.query<Array<{ id: bigint }>>(`SELECT p.id FROM pet_explore_participations p JOIN players player ON player.id=p.player_id WHERE p.state_code='active' AND player.status<>'active' FOR UPDATE`);
  const staleFixed = await tx.query<Array<{ player_id: bigint }>>(`SELECT fixed.player_id FROM pet_explore_auto_fixed_configs fixed JOIN players player ON player.id=fixed.player_id WHERE player.status<>'active' FOR UPDATE`);
  const staleRecords = await tx.query<Array<{ player_name: string }>>(`SELECT DISTINCT rank.player_name FROM player_pet_explore_rank_stats rank JOIN player_profiles profile ON profile.current_display_name=rank.player_name JOIN players player ON player.id=profile.player_id WHERE player.status<>'active' FOR UPDATE`);
  const counts = { participation: staleParticipations.length, fixed: staleFixed.length, record: staleRecords.length };
  if (counts.participation + counts.fixed + counts.record === 0) return counts;
  const operation = await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (UUID(),'pet_explore.status_cleanup',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [eventId, actorId]);
  if (staleParticipations.length > 0) await tx.execute("UPDATE pet_explore_participations p JOIN players player ON player.id=p.player_id SET p.state_code='cancelled',p.version=p.version+1,p.updated_operation_id=? WHERE p.state_code='active' AND player.status<>'active'", [operation.insertId]);
  if (staleFixed.length > 0) await tx.execute("DELETE fixed FROM pet_explore_auto_fixed_configs fixed JOIN players player ON player.id=fixed.player_id WHERE player.status<>'active'");
  if (staleRecords.length > 0) await tx.execute("DELETE rank FROM player_pet_explore_rank_stats rank JOIN player_profiles profile ON profile.current_display_name=rank.player_name JOIN players player ON player.id=profile.player_id WHERE player.status<>'active'");
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pet_explore',NULL,'pet_explore.status.cleanup','cleaned','Iris 탐험 상태 조회',?,UTC_TIMESTAMP(3))", [operation.insertId, actorId, JSON.stringify(counts)]);
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(counts), operation.insertId]);
  return counts;
}

export class PetExploreStatusProjectionService {
  public constructor(private readonly database: DatabaseClient) {}

  // rollout, 권한, 삭제계정 정리 후 현재 탐험 상태를 하나의 일관된 snapshot으로 반환합니다.
  public async handleIris(input: { eventId: string; externalUserId: string; channelId: string; message: string }): Promise<HandleResult> {
    const command = parsePetExploreStatusProjectionCommand(input.message);
    if (command === null) return { status: "handled_no_reply" };
    const commandCode = command.kind === "map" ? "PET_EXPLORE_MAP_READ" : "PET_EXPLORE_USER_CHECK_READ";
    const handlerKey = command.kind === "map" ? "pet_explore_map_read" : "pet_explore_user_check_read";
    const definition = (await this.database.query<Array<{ rollout_state: RolloutState; enabled: number }>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1", [commandCode]))[0];
    const dispatch = new MariaCommandDispatchRepository(this.database);
    if (definition === undefined || definition.enabled !== 1 || definition.rollout_state === "LEGACY_ONLY") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "LEGACY_FALLBACK", reasonCode: "ROLLOUT_LEGACY_ONLY", commandCode, handlerKey });
      return { status: "legacy_fallback" };
    }
    if (definition.rollout_state !== "ACTIVE") {
      await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "SHADOW", reasonCode: "ROLLOUT_SHADOW", commandCode, handlerKey });
      return { status: "shadow" };
    }
    const player = (await this.database.query<Array<{ player_id: bigint }>>(`SELECT identity.player_id FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (player === undefined) return { status: "handled_no_reply" };
    let actorId = player.player_id.toString();
    if (command.kind === "user_check") {
      const operator = (await this.database.query<Array<{ operator_id: bigint }>>(`SELECT operator.id operator_id FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.code='super_admin' AND role.active=TRUE WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
      if (operator === undefined) return { status: "handled_no_reply" };
      actorId = operator.operator_id.toString();
    }
    await dispatch.record({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true }, { route: "MODERN", reasonCode: "MODERN_ROUTE_ALLOWED", commandCode, handlerKey });
    return this.database.withTransaction(async (tx) => {
      const cleanup = await cleanupInactive(tx, input.eventId, actorId);
      const runtime = (await tx.query<RuntimeRow[]>("SELECT event_mine_active,guild_raid_active FROM pet_explore_runtime_config WHERE config_id=1"))[0];
      if (runtime === undefined) throw new ApplicationError("PET_EXPLORE_RUNTIME_CONFIG_MISSING", "펫탐험 설정을 찾을 수 없습니다.", 409);
      const participations = await tx.query<ParticipationRow[]>(`SELECT participation.id participation_id,participation.player_id,profile.current_display_name display_name,participation.destination_code,source.threshold_components_json,source.source_gap_codes_json FROM pet_explore_rounds round_state JOIN pet_explore_participations participation ON participation.round_id=round_state.id AND participation.state_code='active' JOIN players player ON player.id=participation.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN pet_explore_settlement_participant_source_projections source ON source.participation_id=participation.id WHERE round_state.state_code='open' ORDER BY participation.id`);
      const fixed = await tx.query<FixedRow[]>(`SELECT fixed.player_id,profile.current_display_name display_name,fixed.destination_code FROM pet_explore_auto_fixed_configs fixed JOIN players player ON player.id=fixed.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id ORDER BY fixed.player_id`);
      if (command.kind === "map") {
        const scheduler = (await tx.query<SchedulerRow[]>("SELECT next_run_at,interval_minutes FROM pet_explore_scheduler_state WHERE schedule_code='pet_explore' LIMIT 1"))[0] ?? null;
        return { status: "changed", data: formatPetExploreMap({ playerId: player.player_id, participations, fixed, runtime, scheduler }) };
      }
      const records = await tx.query<RecordRow[]>("SELECT player_name,win_count,lose_count FROM player_pet_explore_rank_stats ORDER BY source_order,player_name");
      return { status: "changed", data: formatPetExploreUserCheck({ slot: command.slot, participations, fixed, records, cleanup }) };
    });
  }
}
