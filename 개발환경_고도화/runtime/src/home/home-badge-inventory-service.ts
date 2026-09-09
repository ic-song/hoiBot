import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { parseHomeBadgeInventoryCommand } from "./home-badge-inventory-command.js";

export type HomeBadgeDefinition = {
  definition_version_id: bigint; ordinal: number; badge_code: string; source_code: string;
  grade_code: string | null; emoji_value: string; display_name: string; detail_text: string;
  criteria_json: string | Record<string, number> | null;
  required_badge_codes_json: string | string[] | null;
};
export type HomeBadgeStats = {
  followers: bigint; mutual: bigint; receivedComments: bigint; receivedHomeLikes: bigint;
  receivedReactions: bigint; totalVisits: bigint; feedActiveDays: bigint;
};
type Cube = {
  badge_code: string; castle_percent: string; raid_percent: string;
  pet_upgrade_percent: string; explore_percent: string; equipped: number;
};
type Projection = { ownedCodes: Set<string>; deletedCodes: Set<string>; equippedCode: string | null; cubes: Map<string, Cube> };
type Result = {
  message: string; outboxId: string; replayed: boolean; definitionVersionId: string;
  awardedBadges: string[]; resultCode: string;
};

const SCOPE = "home.badge_inventory.read";
const ALLSEE = "​".repeat(500);
const statKeys: Record<string, keyof HomeBadgeStats> = {
  followers: "followers", mutual: "mutual", receivedComments: "receivedComments",
  receivedHomeLikes: "receivedHomeLikes", receivedReactions: "receivedReactions",
  totalVisits: "totalVisits", feedActiveDays: "feedActiveDays"
};
const key = (value: string): string => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const json = <T>(value: string | T): T => typeof value === "string" ? JSON.parse(value) as T : value;

function qualifies(definition: HomeBadgeDefinition, stats: HomeBadgeStats | null, owned: Set<string>): boolean {
  if (definition.source_code !== "achievement" || stats === null) return false;
  const required = definition.required_badge_codes_json === null ? [] : json<string[]>(definition.required_badge_codes_json);
  if (required.length > 0) return required.every((code) => owned.has(code));
  const criteria = definition.criteria_json === null ? {} : json<Record<string, number>>(definition.criteria_json);
  return Object.entries(criteria).every(([name, threshold]) => {
    const field = statKeys[name];
    return field !== undefined && stats[field] >= BigInt(threshold);
  });
}

// definition 고정순서로 연쇄 업적 획득을 투영하되 영구삭제 코드는 제외합니다.
export function projectCatchUpCodes(
  definitions: HomeBadgeDefinition[], stats: HomeBadgeStats | null,
  ownedCodes: Set<string>, deletedCodes: Set<string>
): string[] {
  const projected = new Set(ownedCodes), awarded: string[] = [];
  for (const definition of definitions) {
    if (projected.has(definition.badge_code) || deletedCodes.has(definition.badge_code)
      || !qualifies(definition, stats, projected)) continue;
    projected.add(definition.badge_code);
    awarded.push(definition.badge_code);
  }
  return awarded;
}

// 번호·대괄호 ID·ID·정확 이름을 하나의 version-pinned 정의로 해석합니다.
export function resolveHomeBadgeSelection(
  selection: string, definitions: HomeBadgeDefinition[], ownedCodes: Set<string>
): HomeBadgeDefinition | null {
  const owned = definitions.filter((definition) => ownedCodes.has(definition.badge_code));
  if (/^\d+$/.test(selection)) return owned[Number.parseInt(selection, 10) - 1] ?? null;
  const code = selection.match(/^\[?([A-Za-z]{1,4}\d{2,3})\]?$/)?.[1]?.toUpperCase();
  if (code !== undefined) return definitions.find((definition) => definition.badge_code === code) ?? null;
  return definitions.find((definition) => definition.display_name === selection) ?? null;
}

const typeLabel = (definition: HomeBadgeDefinition): string =>
  definition.source_code === "achievement" ? "업적"
    : definition.source_code === "special" ? "특별"
      : definition.source_code === "mbti" ? "MBTI"
        : definition.source_code === "love" ? "연애유형"
          : `뽑기${definition.grade_code ? ` ${definition.grade_code}` : ""}`;
const percent = (value: string | undefined): string => `${Number(value ?? 0).toFixed(1)}%`;

function cubeLines(cube: Cube | undefined): string[] {
  const sum = Number(cube?.castle_percent ?? 0) + Number(cube?.raid_percent ?? 0)
    + Number(cube?.pet_upgrade_percent ?? 0) + Number(cube?.explore_percent ?? 0);
  return [
    `1. 캐슬 ${percent(cube?.castle_percent)}`, `2. 레이드 ${percent(cube?.raid_percent)}`,
    `3. 펫강화 ${percent(cube?.pet_upgrade_percent)}`, `4. 펫탐험 ${percent(cube?.explore_percent)}`,
    ...(sum >= 100 ? ["✨ 기본 합계 100% 이상: 장착 효과 10% 추가"] : [])
  ];
}

export function formatOwnedHomeBadges(input: {
  displayName: string; definitions: HomeBadgeDefinition[]; projection: Projection;
}): string {
  const owned = input.definitions.filter((definition) => input.projection.ownedCodes.has(definition.badge_code));
  const equippedIndex = owned.findIndex((definition) => definition.badge_code === input.projection.equippedCode);
  const lines = [
    `[${input.displayName}] 님`, "💟 홈뱃지 보유 목록", "일반: /홈뱃지정보 [번호|ID|이름]",
    "큐브: /홈뱃지큐브 [번호] [옵션] [횟수]", ALLSEE,
    `대표뱃지: ${equippedIndex >= 0 ? `[${equippedIndex + 1}번] ${owned[equippedIndex]!.emoji_value} ${owned[equippedIndex]!.display_name}` : "없음"}`,
    `보유 ${owned.length}/${input.definitions.length}`
  ];
  if (owned.length === 0) return `${lines.join("\n")}\n보유한 홈뱃지가 없습니다.`;
  owned.forEach((definition, index) => lines.push(
    "", `[${index + 1}번] [${definition.badge_code}] ${definition.emoji_value} ${definition.display_name}${definition.badge_code === input.projection.equippedCode ? " · 장착" : ""}`,
    `유형: ${typeLabel(definition)}`, ...cubeLines(input.projection.cubes.get(definition.badge_code)), definition.detail_text
  ));
  return lines.join("\n");
}

export function formatAllHomeBadges(input: {
  displayName: string; definitions: HomeBadgeDefinition[]; projection: Projection;
}): string {
  const lines = [`[${input.displayName}] 님`, `💟 홈뱃지 전체 ${input.definitions.length}종`, "━━━━━━━━━━━━━━━"];
  input.definitions.forEach((definition, index) => {
    const icon = input.projection.ownedCodes.has(definition.badge_code) ? "✅"
      : input.projection.deletedCodes.has(definition.badge_code) ? "🗑" : "▫️";
    lines.push(`${icon} [${definition.badge_code}] ${definition.emoji_value} ${definition.display_name}${index === 9 ? ALLSEE : ""}`);
  });
  return lines.join("\n");
}

function progressText(
  definition: HomeBadgeDefinition, stats: HomeBadgeStats | null, owned: Set<string>
): string {
  const required = definition.required_badge_codes_json === null ? [] : json<string[]>(definition.required_badge_codes_json);
  if (required.length > 0) return required.map((code) => `${code} ${owned.has(code) ? "획득" : "미획득"}`).join(" · ");
  const criteria = definition.criteria_json === null ? {} : json<Record<string, number>>(definition.criteria_json);
  if (Object.keys(criteria).length === 0 || stats === null) return definition.detail_text;
  return Object.entries(criteria).map(([name, threshold]) => {
    const field = statKeys[name];
    return `${name} ${field === undefined ? "0" : stats[field].toString()}/${threshold}`;
  }).join(" · ");
}

export function formatHomeBadgeDetail(input: {
  displayName: string; definition: HomeBadgeDefinition; projection: Projection; stats: HomeBadgeStats | null;
}): string {
  const status = input.projection.ownedCodes.has(input.definition.badge_code) ? "✅ 보유"
    : input.projection.deletedCodes.has(input.definition.badge_code) ? "🗑 영구 삭제" : "▫️ 미획득";
  return [
    `[${input.displayName}] 님`, `[${input.definition.badge_code}] ${input.definition.emoji_value} ${input.definition.display_name}`,
    `상태: ${status}${input.definition.badge_code === input.projection.equippedCode ? " · 대표뱃지 장착" : ""}`,
    `유형: ${typeLabel(input.definition)}`, input.definition.detail_text,
    `진행도: ${progressText(input.definition, input.stats, input.projection.ownedCodes)}`,
    ...cubeLines(input.projection.cubes.get(input.definition.badge_code))
  ].join("\n");
}

async function loadProjection(tx: DatabaseTransaction, playerId: bigint): Promise<Projection> {
  const rows = await tx.query<Array<{ badge_code: string; owned: number; equipped: number }>>(
    "SELECT badge_code,owned,equipped FROM player_home_badges WHERE player_id=? ORDER BY badge_code FOR UPDATE", [playerId]
  );
  const assignments = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_badge_assignments WHERE player_id=? ORDER BY priority,badge_code FOR UPDATE", [playerId]
  );
  const deletions = await tx.query<Array<{ badge_code: string }>>(
    "SELECT badge_code FROM player_home_badge_exclusions WHERE player_id=? ORDER BY badge_code", [playerId]
  );
  const cubes = await tx.query<Cube[]>(
    "SELECT badge_code,castle_percent,raid_percent,pet_upgrade_percent,explore_percent,equipped FROM player_home_badge_cubes WHERE player_id=? ORDER BY badge_code FOR UPDATE", [playerId]
  );
  const ownedCodes = new Set(assignments.map((row) => row.badge_code));
  rows.forEach((row) => { if (row.owned === 1) ownedCodes.add(row.badge_code); });
  const deletedCodes = new Set(deletions.map((row) => row.badge_code));
  rows.forEach((row) => { if (row.owned !== 1) deletedCodes.add(row.badge_code); });
  return {
    ownedCodes, deletedCodes,
    equippedCode: rows.find((row) => row.owned === 1 && row.equipped === 1)?.badge_code
      ?? cubes.find((row) => row.equipped === 1)?.badge_code ?? null,
    cubes: new Map(cubes.map((row) => [row.badge_code, row]))
  };
}

async function applyAwards(
  tx: DatabaseTransaction, playerId: bigint, operationId: bigint,
  definitions: HomeBadgeDefinition[], awardedCodes: string[], projection: Projection
): Promise<void> {
  let priority = Number((await tx.query<Array<{ value: bigint }>>(
    "SELECT COALESCE(MAX(priority),0) value FROM player_badge_assignments WHERE player_id=?", [playerId]
  ))[0]!.value) + 1;
  let sequence = Number((await tx.query<Array<{ value: bigint }>>(
    "SELECT COALESCE(MAX(sequence_no),0) value FROM pet_home_activity_alerts WHERE owner_player_id=? FOR UPDATE", [playerId]
  ))[0]!.value) + 1;
  const createdAt = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul", dateStyle: "short", timeStyle: "medium"
  }).format(new Date());
  for (const code of awardedCodes) {
    const definition = definitions.find((row) => row.badge_code === code)!;
    await tx.execute(
      "INSERT IGNORE INTO player_badge_assignments(player_id,badge_code,display_value,priority) VALUES (?,?,?,?)",
      [playerId, code, `${definition.emoji_value} ${definition.display_name}`, priority++]
    );
    await tx.execute(
      "INSERT INTO player_home_badges(player_id,badge_code,owned,equipped,version,updated_at) VALUES (?,?,TRUE,FALSE,1,UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE owned=TRUE,version=version+1,updated_at=UTC_TIMESTAMP(3)",
      [playerId, code]
    );
    await tx.execute(
      "INSERT INTO pet_home_activity_alerts(owner_player_id,sequence_no,alert_type,actor_player_id,created_at_text,read_flag,badge_code,restored_operation_id) VALUES (?,?,'badge_earned',?,?,FALSE,?,?)",
      [playerId, sequence++, playerId, createdAt, code, operationId]
    );
    projection.ownedCodes.add(code);
  }
  await tx.execute(
    "DELETE FROM pet_home_activity_alerts WHERE owner_player_id=? AND sequence_no NOT IN (SELECT sequence_no FROM (SELECT sequence_no FROM pet_home_activity_alerts WHERE owner_player_id=? ORDER BY sequence_no DESC LIMIT 100) keep_rows)",
    [playerId, playerId]
  );
}

// version pin·player lock·catch-up·stored response를 한 transaction으로 처리합니다.
export class HomeBadgeInventoryService {
  constructor(private readonly database: DatabaseClient) {}

  async execute(input: {
    eventId: string; externalUserId: string; destinationId: string; message: string;
  }): Promise<Result> {
    const command = parseHomeBadgeInventoryCommand(input.message);
    if (command === null) throw new ApplicationError("HOME_BADGE_COMMAND_INVALID", "홈뱃지 명령 형식을 확인해 주세요.", 422);
    const actor = (await this.database.query<Array<{ player_id: bigint; display_name: string }>>(
      `SELECT identity.player_id,profile.current_display_name display_name
       FROM external_identities identity
       JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
       JOIN player_profiles profile ON profile.player_id=player.id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (actor === undefined) throw new ApplicationError("HOME_BADGE_IDENTITY_REQUIRED", "사용자 식별 정보를 확인할 수 없습니다.", 422);

    return this.database.withTransaction(async (tx) => {
      const requestKey = key(input.eventId);
      await tx.query("SELECT id FROM players WHERE id=? FOR UPDATE", [actor.player_id]);
      const prior = (await tx.query<Array<{ result_json: string | Result | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]
      ))[0];
      if (prior?.result_json != null) return { ...json<Result>(prior.result_json), replayed: true };
      const version = (await tx.query<Array<{ id: bigint }>>(
        "SELECT id FROM home_badge_definition_versions WHERE status='shadow' AND effective_at<=UTC_TIMESTAMP(3) ORDER BY effective_at DESC,id DESC LIMIT 1"
      ))[0];
      if (version === undefined) throw new ApplicationError("HOME_BADGE_DEFINITION_MISSING", "홈뱃지 기준정보를 찾을 수 없습니다.", 500);
      const definitions = await tx.query<HomeBadgeDefinition[]>(
        "SELECT definition_version_id,ordinal,badge_code,source_code,grade_code,emoji_value,display_name,detail_text,criteria_json,required_badge_codes_json FROM home_badge_definitions WHERE definition_version_id=? ORDER BY ordinal",
        [version.id]
      );
      if (definitions.length !== 204) throw new ApplicationError(
        "HOME_BADGE_DEFINITION_COUNT_INVALID", `홈뱃지 기준정보가 204종이 아닙니다. (${definitions.length}종)`, 500
      );
      const stats = (await tx.query<HomeBadgeStats[]>(
        "SELECT followers,mutual,received_comments receivedComments,received_home_likes receivedHomeLikes,received_reactions receivedReactions,total_visits totalVisits,feed_active_days feedActiveDays FROM pet_home_badge_stats WHERE player_id=? FOR UPDATE",
        [actor.player_id]
      ))[0] ?? null;
      const projection = await loadProjection(tx, actor.player_id);
      const projectedAwards = projectCatchUpCodes(definitions, stats, projection.ownedCodes, projection.deletedCodes);
      const projectedOwned = new Set([...projection.ownedCodes, ...projectedAwards]);
      const selected = command.kind === "detail"
        ? resolveHomeBadgeSelection(command.selection, definitions, projectedOwned) : null;
      const invalid = command.kind === "detail" && selected === null;
      const operationId = (await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'player',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), SCOPE, requestKey, actor.player_id]
      )).insertId;
      if (!invalid) await applyAwards(tx, actor.player_id, operationId, definitions, projectedAwards, projection);
      const message = invalid
        ? "❌ 존재하지 않는 홈뱃지입니다. 번호·ID·정확한 이름을 확인해 주세요."
        : command.kind === "owned"
          ? formatOwnedHomeBadges({ displayName: actor.display_name, definitions, projection })
          : command.kind === "all"
            ? formatAllHomeBadges({ displayName: actor.display_name, definitions, projection })
            : formatHomeBadgeDetail({ displayName: actor.display_name, definition: selected!, projection, stats });
      const resultCode = invalid ? "invalid_selection" : "success";
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operationId, input.destinationId, JSON.stringify({ data: message })]
      );
      const commandCode = command.kind === "owned" ? "HOME_BADGE_OWNED_READ"
        : command.kind === "all" ? "HOME_BADGE_ALL_READ" : "HOME_BADGE_DETAIL_READ";
      await tx.execute(
        "INSERT INTO home_badge_inventory_reads(operation_id,player_id,definition_version_id,command_kind,selection_text,result_code,awarded_badges_json,snapshot_json) VALUES (?,?,?,?,?,?,?,?)",
        [operationId, actor.player_id, version.id, command.kind, command.kind === "detail" ? command.selection : null,
          resultCode, JSON.stringify(invalid ? [] : projectedAwards),
          JSON.stringify({ definitionCount: definitions.length, ownedCount: projection.ownedCodes.size, deletedCount: projection.deletedCodes.size, equippedCode: projection.equippedCode })]
      );
      await tx.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, commandCode, operationId, resultCode]
      );
      await tx.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json,created_at) VALUES (?,'player',?,'player',?,'home.badge_inventory.read',?,?,UTC_TIMESTAMP(3))",
        [operationId, actor.player_id, actor.player_id, resultCode,
          JSON.stringify({ kind: command.kind, definitionVersionId: version.id.toString(), awardedBadges: invalid ? [] : projectedAwards })]
      );
      const result: Result = {
        message, outboxId: outbox.insertId.toString(), replayed: false,
        definitionVersionId: version.id.toString(), awardedBadges: invalid ? [] : projectedAwards, resultCode
      };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [
        JSON.stringify(result), operationId
      ]);
      return result;
    });
  }
}
