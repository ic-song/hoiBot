import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { parseHomeBadgeCubeCommand } from "./home-badge-cube-command.js";

const SAMPLE_DENOMINATOR = 0x10000000000000;
type Actor = { identity_id: bigint; player_id: bigint; rank_display: string };
type Definition = { badge_code: string; source_code: string; grade_code: string | null; emoji_value: string; display_name: string; detail_text: string; ordinal: number };
export type HomeBadgeCubeOption = {
  config_version_id: bigint; definition_version_id: bigint; content_hash: string; option_number: number;
  option_code: "castle" | "raid" | "petUpgrade" | "explore"; emoji_value: string; display_name: string;
  cost_quantity: bigint; maximum_tenths: number; item_id: bigint; item_display_name: string;
};
export type HomeBadgeCubeRateBand = { band_ordinal: number; minimum_tenths: number; maximum_tenths: number; weight_value: bigint };
type CubeRow = { castle_percent: string; raid_percent: string; pet_upgrade_percent: string; explore_percent: string; equipped: number; version: bigint };
type CubeValues = { castle: number; raid: number; petUpgrade: number; explore: number };
export type HomeBadgeCubeRoll = { band: HomeBadgeCubeRateBand; bandSample: number; valueSample: number; rolledTenths: number };
export type HomeBadgeCubeAppliedRoll = { appliedTenths: number; protectionFloorTenths: number; nextTargetTenths: number; stageCeilingTenths: number; upgraded: boolean; protected: boolean; milestonePercent: number | null };
export interface HomeBadgeCubeReply { outboxId: string; room: string; data: string }
export interface HomeBadgeCubeResult {
  status: "success" | "usage" | "invalid_selection" | "maximum" | "cube_shortage" | "silent";
  data?: string; outboxId?: string; replies?: HomeBadgeCubeReply[]; replayed?: boolean;
  badgeCode?: string; optionCode?: string; requestedCount?: number; usedCount?: number; consumedQuantity?: string;
  beforeTenths?: number; afterTenths?: number; lastRollTenths?: number; milestones?: number[]; allMaxNotice?: boolean;
}

// 긴 provider event ID를 operation unique key 길이에 맞춥니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// event·player·badge·옵션·횟수에 고정된 재시작 안전 seed를 만듭니다.
export function createHomeBadgeCubeSeed(contentHash: string, eventId: string, playerId: string, badgeCode: string, optionCode: string, count: bigint): string {
  return `${contentHash}|${eventKey(eventId)}|${playerId}|${badgeCode}|${optionCode}|${count.toString()}`;
}

// seed·시도·단계에서 0 이상 1 미만의 결정적 표본을 계산합니다.
export function homeBadgeCubeSample(seed: string, ordinal: number, stage: "band" | "value"): number {
  const hash = createHash("sha256").update(`${seed}|${ordinal}|${stage}`).digest("hex");
  return Number.parseInt(hash.slice(0, 13), 16) / SAMPLE_DENOMINATOR;
}

// DB 확률 구간과 구간 내 0.1% 값을 두 표본으로 선택합니다.
export function planHomeBadgeCubeRoll(seed: string, ordinal: number, bands: HomeBadgeCubeRateBand[]): HomeBadgeCubeRoll {
  const ordered = bands.slice().sort((a, b) => a.band_ordinal - b.band_ordinal);
  const total = ordered.reduce((sum, row) => sum + row.weight_value, 0n);
  if (total !== 100000000n) throw new Error(`홈뱃지 큐브 확률 합계가 100%가 아닙니다: ${total.toString()}`);
  const bandSample = homeBadgeCubeSample(seed, ordinal, "band");
  const scaled = BigInt(Math.floor(bandSample * Number(total)));
  let cumulative = 0n;
  let band = ordered[ordered.length - 1]!;
  for (const row of ordered) { cumulative += row.weight_value; if (scaled < cumulative) { band = row; break; } }
  const valueSample = homeBadgeCubeSample(seed, ordinal, "value");
  const width = band.maximum_tenths - band.minimum_tenths + 1;
  return { band, bandSample, valueSample, rolledTenths: band.minimum_tenths + Math.min(width - 1, Math.floor(valueSample * width)) };
}

// v2.400의 정수 보호선과 한 구간 상승 제한을 한 시도에 적용합니다.
export function applyHomeBadgeCubeRoll(currentTenths: number, maximumTenths: number, rolledTenths: number, hadCommandUpgrade: boolean): HomeBadgeCubeAppliedRoll {
  const protectionFloorTenths = Math.min(maximumTenths, Math.floor(currentTenths / 10) * 10);
  const nextTargetTenths = currentTenths >= maximumTenths ? maximumTenths : Math.min(maximumTenths, protectionFloorTenths + 10);
  const stageCeilingTenths = Math.min(maximumTenths, nextTargetTenths + 9);
  const reached = rolledTenths >= nextTargetTenths;
  const appliedTenths = reached ? Math.min(stageCeilingTenths, rolledTenths) : hadCommandUpgrade ? currentTenths : protectionFloorTenths;
  const upgraded = appliedTenths > currentTenths;
  const reachedFloorPercent = Math.floor(appliedTenths / 10);
  const milestonePercent = upgraded && reachedFloorPercent > protectionFloorTenths / 10 && reachedFloorPercent % 10 === 0 ? reachedFloorPercent : null;
  return { appliedTenths, protectionFloorTenths, nextTargetTenths, stageCeilingTenths, upgraded, protected: !upgraded, milestonePercent };
}

function tenths(value: string | undefined, maximum: number): number {
  const parsed = Math.round(Number(value ?? 0) * 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(maximum, parsed)) : 0;
}
function percent(value: number): string { return `${(value / 10).toFixed(1)}%`; }
function cardPercent(value: number): string { return `${(value / 10).toFixed(1).replace(/\.0$/, "")}%`; }
function quantity(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
function typeLabel(definition: Definition): string {
  return definition.source_code === "achievement" ? "업적" : definition.source_code === "special" ? "특별"
    : definition.source_code === "mbti" ? "MBTI" : definition.source_code === "love" ? "연애유형"
      : `뽑기${definition.grade_code ? ` ${definition.grade_code}` : ""}`;
}
function allMax(values: CubeValues): boolean { return values.castle === 500 && values.raid === 500 && values.petUpgrade === 300 && values.explore === 150; }
function totalBuff(values: CubeValues): boolean { return values.castle + values.raid + values.petUpgrade + values.explore >= 1000; }
function isRace(error: unknown): boolean {
  return typeof error === "object" && error !== null && (("errno" in error && (error.errno === 1062 || error.errno === 1213)) || ("code" in error && (error.code === "ER_DUP_ENTRY" || error.code === "ER_LOCK_DEADLOCK")));
}

// 결과·공지·실행·감사·operation 완료를 같은 transaction에 기록합니다.
async function complete(tx: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actor: Actor; resultCode: string; data: string;
  result: HomeBadgeCubeResult; summary: Record<string, unknown>; notices?: string[]; broadcastIds: readonly string[];
}): Promise<HomeBadgeCubeResult> {
  const replies: HomeBadgeCubeReply[] = [];
  const main = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  replies.push({ outboxId: main.insertId.toString(), room: input.destinationId, data: input.data });
  for (const notice of input.notices ?? []) for (const room of input.broadcastIds) {
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, room, JSON.stringify({ data: notice })]);
    replies.push({ outboxId: outbox.insertId.toString(), room, data: notice });
  }
  await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_BADGE_CUBE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'home.badge.cube',?,'Iris 홈뱃지 큐브',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.actor.player_id, input.resultCode, JSON.stringify(input.summary)]);
  const result: HomeBadgeCubeResult = { ...input.result, data: input.data, outboxId: main.insertId.toString(), replies, replayed: false };
  await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// v2.400 큐브 재고·옵션·보호선·공지 순서를 DB transaction으로 처리합니다.
export class HomeBadgeCubeService {
  public constructor(private readonly database: DatabaseClient, private readonly broadcastIds: readonly string[] = []) {}

  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeBadgeCubeResult> {
    const command = parseHomeBadgeCubeCommand(input.message);
    if (command === null) return { status: "silent" };
    const actor = (await this.database.query<Actor[]>(`SELECT identity.id identity_id,player.id player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`, [input.externalUserId]))[0];
    if (actor === undefined) return { status: "silent" };
    const scope = "home.badge.cube";
    const key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async tx => {
        const prior = (await tx.query<Array<{ result_json: string | HomeBadgeCubeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as HomeBadgeCubeResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        const operationId = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, key, actor.identity_id])).insertId;
        if (!command.valid || command.badgeNumber === null || command.optionNumber === null || command.tryCount === null) {
          const data = "사용법: /홈뱃지큐브 [홈뱃지번호] [옵션번호] [횟수]\n예시: /홈뱃지큐브 1 2\n예시: /홈뱃지큐브 1 2 1000\n옵션 번호와 비용은 /홈뱃지에서 확인해 주세요.";
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "usage", data, result: { status: "usage" }, summary: { mutation: false }, broadcastIds: this.broadcastIds });
        }
        await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
        const option = (await tx.query<HomeBadgeCubeOption[]>(`SELECT option_row.config_version_id,version.definition_version_id,version.content_hash,option_row.option_number,option_row.option_code,option_row.emoji_value,option_row.display_name,option_row.cost_quantity,option_row.maximum_tenths,option_row.item_id,item.display_name item_display_name FROM home_badge_cube_options option_row JOIN home_badge_cube_config_versions version ON version.id=option_row.config_version_id AND version.status='shadow' JOIN item_definitions item ON item.id=option_row.item_id AND item.active=TRUE WHERE option_row.option_number=? AND option_row.active=TRUE ORDER BY version.effective_at DESC,version.id DESC LIMIT 1`, [command.optionNumber]))[0];
        if (option === undefined) throw new Error("홈뱃지 큐브 옵션 DB seed가 필요합니다.");
        const definitions = await tx.query<Definition[]>("SELECT badge_code,source_code,grade_code,emoji_value,display_name,detail_text,ordinal FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal", [option.definition_version_id]);
        if (definitions.length !== 204) throw new Error(`홈뱃지 DB 정의 204종이 필요합니다: ${definitions.length}`);
        const assignments = await tx.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [actor.player_id]);
        const projections = await tx.query<Array<{ badge_code: string; owned: number; equipped: number }>>("SELECT badge_code,owned,equipped FROM player_home_badges WHERE player_id=? ORDER BY badge_code FOR UPDATE", [actor.player_id]);
        const exclusions = await tx.query<Array<{ badge_code: string }>>("SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? ORDER BY badge_code FOR UPDATE", [actor.player_id]);
        const deleted = new Set(exclusions.map(row => row.badge_code));
        projections.forEach(row => { if (row.owned !== 1) deleted.add(row.badge_code); });
        const owned = new Set(assignments.map(row => row.badge_code));
        projections.forEach(row => { if (row.owned === 1) owned.add(row.badge_code); });
        deleted.forEach(code => owned.delete(code));
        const ownedDefinitions = definitions.filter(row => owned.has(row.badge_code));
        const definition = ownedDefinitions[command.badgeNumber - 1];
        if (definition === undefined) {
          const data = "❌ 존재하지 않거나 보유하지 않은 홈뱃지·옵션입니다.\n보유 번호는 /홈뱃지에서 확인해 주세요.";
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "invalid_selection", data, result: { status: "invalid_selection" }, summary: { badgeNumber: command.badgeNumber, mutation: false }, broadcastIds: this.broadcastIds });
        }
        const allOptions = await tx.query<HomeBadgeCubeOption[]>(`SELECT option_row.config_version_id,version.definition_version_id,version.content_hash,option_row.option_number,option_row.option_code,option_row.emoji_value,option_row.display_name,option_row.cost_quantity,option_row.maximum_tenths,option_row.item_id,item.display_name item_display_name FROM home_badge_cube_options option_row JOIN home_badge_cube_config_versions version ON version.id=option_row.config_version_id JOIN item_definitions item ON item.id=option_row.item_id WHERE option_row.config_version_id=? ORDER BY option_row.option_number`, [option.config_version_id]);
        if (allOptions.length !== 4) throw new Error("홈뱃지 큐브 옵션 4종 DB seed가 필요합니다.");
        const maxima = new Map(allOptions.map(row => [row.option_code, row.maximum_tenths]));
        const cube = (await tx.query<CubeRow[]>("SELECT CAST(castle_percent AS CHAR) castle_percent,CAST(raid_percent AS CHAR) raid_percent,CAST(pet_upgrade_percent AS CHAR) pet_upgrade_percent,CAST(explore_percent AS CHAR) explore_percent,equipped,version FROM player_home_badge_cubes WHERE player_id=? AND badge_code=? FOR UPDATE", [actor.player_id, definition.badge_code]))[0];
        const values: CubeValues = {
          castle: tenths(cube?.castle_percent, maxima.get("castle")!), raid: tenths(cube?.raid_percent, maxima.get("raid")!),
          petUpgrade: tenths(cube?.pet_upgrade_percent, maxima.get("petUpgrade")!), explore: tenths(cube?.explore_percent, maxima.get("explore")!)
        };
        const before = values[option.option_code];
        if (before >= option.maximum_tenths) {
          const data = `⚠️ 이미 ${option.emoji_value} ${option.display_name} 옵션이 최대 ${percent(option.maximum_tenths)}입니다.\n큐브를 사용하지 않았습니다.`;
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "maximum", data, result: { status: "maximum", badgeCode: definition.badge_code, optionCode: option.option_code }, summary: { mutation: false }, broadcastIds: this.broadcastIds });
        }
        const inventory = (await tx.query<Array<{ quantity: bigint | null; version: bigint | null }>>("SELECT stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.id=? FOR UPDATE", [actor.player_id, option.item_id]))[0];
        const held = inventory?.quantity ?? 0n;
        if (held < option.cost_quantity) {
          const data = `❌ ${option.item_display_name}가 부족합니다.\n보유: ${quantity(held)}개\n1회 필요: ${option.cost_quantity.toString()}개`;
          return complete(tx, { operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "cube_shortage", data, result: { status: "cube_shortage", badgeCode: definition.badge_code, optionCode: option.option_code }, summary: { held: held.toString(), mutation: false }, broadcastIds: this.broadcastIds });
        }
        const bands = await tx.query<HomeBadgeCubeRateBand[]>("SELECT band_ordinal,minimum_tenths,maximum_tenths,weight_value FROM home_badge_cube_rate_bands WHERE config_version_id=? ORDER BY band_ordinal", [option.config_version_id]);
        if (bands.length !== 51) throw new Error(`홈뱃지 큐브 확률 구간 51개가 필요합니다: ${bands.length}`);
        const seed = createHomeBadgeCubeSeed(option.content_hash, input.eventId, actor.player_id.toString(), definition.badge_code, option.option_code, command.tryCount);
        const actualLimit = Number(command.tryCount < held / option.cost_quantity ? command.tryCount : held / option.cost_quantity);
        let current = before, used = 0, upgraded = 0, protectedCount = 0, hadCommandUpgrade = false, lastRoll = before;
        const milestoneCandidates: number[] = [];
        for (let ordinal = 1; ordinal <= actualLimit && current < option.maximum_tenths; ordinal++) {
          const planned = planHomeBadgeCubeRoll(seed, ordinal, bands);
          const applied = applyHomeBadgeCubeRoll(current, option.maximum_tenths, planned.rolledTenths, hadCommandUpgrade);
          await tx.execute("INSERT INTO home_badge_cube_rolls(operation_id,roll_ordinal,band_ordinal,band_sample,value_sample,rolled_tenths,before_tenths,protection_floor_tenths,next_target_tenths,stage_ceiling_tenths,applied_tenths,result_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [operationId, ordinal, planned.band.band_ordinal, planned.bandSample.toFixed(19), planned.valueSample.toFixed(19), planned.rolledTenths, current, applied.protectionFloorTenths, applied.nextTargetTenths, applied.stageCeilingTenths, applied.appliedTenths, applied.upgraded ? "upgrade" : "protected"]);
          current = applied.appliedTenths; lastRoll = planned.rolledTenths; used++;
          if (applied.upgraded) { upgraded++; hadCommandUpgrade = true; } else protectedCount++;
          if (applied.milestonePercent !== null) milestoneCandidates.push(applied.milestonePercent);
        }
        values[option.option_code] = current;
        const consumed = BigInt(used) * option.cost_quantity;
        const afterQuantity = held - consumed;
        const inventoryUpdate = await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [afterQuantity, actor.player_id, option.item_id, inventory?.version ?? 0n]);
        if (inventoryUpdate.affectedRows !== 1n) throw new Error("홈뱃지 큐브 재고가 먼저 변경되었습니다.");
        await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'HOME_BADGE_CUBE_USE')", [operationId, actor.player_id, option.item_id, -consumed]);
        const equippedCode = projections.find(row => row.owned === 1 && row.equipped === 1 && !deleted.has(row.badge_code))?.badge_code ?? null;
        await tx.execute(`INSERT INTO player_home_badge_cubes(player_id,badge_code,castle_percent,raid_percent,pet_upgrade_percent,explore_percent,equipped,version,updated_at) VALUES (?,?,?,?,?,?,?,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE castle_percent=VALUES(castle_percent),raid_percent=VALUES(raid_percent),pet_upgrade_percent=VALUES(pet_upgrade_percent),explore_percent=VALUES(explore_percent),equipped=VALUES(equipped),version=version+1,updated_at=UTC_TIMESTAMP(3)`, [actor.player_id, definition.badge_code, values.castle / 10, values.raid / 10, values.petUpgrade / 10, values.explore / 10, equippedCode === definition.badge_code]);
        await tx.execute("UPDATE player_home_badge_cubes SET equipped=(badge_code=?),updated_at=UTC_TIMESTAMP(3) WHERE player_id=?", [equippedCode, actor.player_id]);
        const milestones: number[] = [];
        for (const milestone of milestoneCandidates) {
          const inserted = await tx.execute("INSERT IGNORE INTO home_badge_cube_milestones(player_id,badge_code,option_code,milestone_percent,source_operation_id,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP(3))", [actor.player_id, definition.badge_code, option.option_code, milestone, operationId]);
          if (inserted.affectedRows === 1n) milestones.push(milestone);
        }
        let allMaxNotice = false;
        if (allMax(values)) {
          const inserted = await tx.execute("INSERT IGNORE INTO home_badge_cube_all_max_notices(player_id,badge_code,source_operation_id,created_at) VALUES (?,?,?,UTC_TIMESTAMP(3))", [actor.player_id, definition.badge_code, operationId]);
          allMaxNotice = inserted.affectedRows === 1n;
        }
        await tx.execute("INSERT INTO home_badge_cube_executions(operation_id,player_id,badge_code,config_version_id,option_code,requested_count,used_count,consumed_quantity,before_tenths,after_tenths,last_roll_tenths,upgrade_count,protected_count,all_max_notice) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [operationId, actor.player_id, definition.badge_code, option.config_version_id, option.option_code, command.tryCount, used, consumed, before, current, lastRoll, upgraded, protectedCount, allMaxNotice]);
        const isEquipped = equippedCode === definition.badge_code;
        const lines = [
          `💟[${actor.rank_display}] 님이 홈뱃지 큐브를 오픈합니다!`, "확률정보: 채팅창에 '/큐브확률'을 적어보세요", "━━━━━━━━━━━━━━━",
          `✅️ 사용: ${quantity(consumed)}개`, `💟 남은 큐브: ${quantity(afterQuantity)}개`, "━━━━━━━━━━━━━━━",
          `[${command.badgeNumber}] ${definition.emoji_value} ${definition.display_name} [${typeLabel(definition)}]${isEquipped ? " ✅ 장착 중" : " ⚠️ 미장착"}`,
          "💟 큐브 옵션", `1. ⚔️ 캐슬 매력 +${cardPercent(values.castle)}`, `2. 👾 레이드 매력 +${cardPercent(values.raid)}`,
          `3. 🌟 펫 강화 수치 +${cardPercent(values.petUpgrade)}`, `4. ⛰️ 펫 탐험 확률 +${cardPercent(values.explore)}`, `└ ${definition.detail_text}`, "━━━━━━━━━━━━━━━",
          `선택 옵션: [${option.option_number}]${option.emoji_value} ${option.display_name}`, `변경: +${percent(before)} → +${percent(current)}`,
          `마지막 추첨: ${percent(lastRoll)}`, `시도: ${used}/${command.tryCount.toString()}회 | 상승 ${upgraded}회 | 보호 ${protectedCount}회`
        ];
        if (!isEquipped) lines.push("⚠️ 대표 뱃지로 장착해야 매력·펫강화·펫탐험 효과가 적용됩니다.");
        if (current >= option.maximum_tenths) lines.push(`🎉 ${percent(option.maximum_tenths)} 최대 옵션을 달성했습니다!`);
        if (totalBuff(values)) lines.push("💟 기본 합계 100% 달성! 장착 시 모든 효과에 10% 추가 버프가 적용됩니다.");
        const notices = milestones.map(value => `[💟 홈뱃지 큐브 전체 알림]\n━━━━━━━━━━━━━━━\n[${actor.rank_display}] 님이\n홈뱃지 ${command.badgeNumber}번의 ${option.emoji_value} ${option.display_name} ${value}%를 달성했습니다!\n━━━━━━━━━━━━━━━\n축하드립니다! 🎉`);
        if (allMaxNotice) notices.push(`[💟 홈뱃지 큐브 전체 알림]\n[${actor.rank_display}] 님이\n${definition.emoji_value} ${definition.display_name} 홈뱃지의 모든 옵션 최대치를 달성했습니다!`);
        return complete(tx, {
          operationId, eventId: input.eventId, destinationId: input.destinationId, actor, resultCode: "success", data: lines.join("\n"), notices, broadcastIds: this.broadcastIds,
          result: { status: "success", badgeCode: definition.badge_code, optionCode: option.option_code, requestedCount: Number(command.tryCount), usedCount: used, consumedQuantity: consumed.toString(), beforeTenths: before, afterTenths: current, lastRollTenths: lastRoll, milestones, allMaxNotice },
          summary: { sourceContract: "v2.400", configVersionId: option.config_version_id.toString(), contentHash: option.content_hash, definitionVersionId: option.definition_version_id.toString(), badgeNumber: command.badgeNumber, badgeCode: definition.badge_code, optionCode: option.option_code, requested: command.tryCount.toString(), used, consumed: consumed.toString(), beforeTenths: before, afterTenths: current, rngSeedHash: createHash("sha256").update(seed).digest("hex"), milestones, allMaxNotice }
        });
      });
    } catch (error) {
      if (!isRace(error)) throw error;
      for (let attempt = 0; attempt < 10; attempt++) {
        const prior = (await this.database.query<Array<{ result_json: string | HomeBadgeCubeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=?", [scope, key]))[0];
        if (prior?.result_json != null) {
          const stored = typeof prior.result_json === "string" ? JSON.parse(prior.result_json) as HomeBadgeCubeResult : prior.result_json;
          return { ...stored, replayed: true };
        }
        await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
      }
      throw error;
    }
  }
}
