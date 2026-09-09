import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { CommandDispatcher, MariaCommandDispatchRepository } from "../dispatch/command-dispatcher.js";
import { ApplicationError } from "../shared/application-error.js";

export type CharacterCountEnvironment = "prod" | "dev";

export interface CharacterCountSourceRow {
  source_code: string;
  raw_json: string;
  content_sha256: string;
  utf16_code_unit_count: bigint;
  entity_count: bigint;
  read_status: string;
}

export interface CharacterCountStat {
  sourceCode: string;
  label: string;
  section: "핵심 데이터" | "칭호·성장 데이터" | "운영 데이터";
  utf16CodeUnitCount: string;
  entityCount: string;
  syncCommand: string | null;
}

export interface CharacterCountStatsResult {
  status: "counted";
  environment: CharacterCountEnvironment;
  databaseIdentity: string;
  snapshotVersion: string;
  snapshotAt: string;
  sourceCount: number;
  projectionCount: number;
  stats: CharacterCountStat[];
  data: string;
  outboxId: string;
  auditId: string;
}

const SOURCE_DEFINITIONS = [
  ["member", "멤버", "핵심 데이터", null],
  ["pet_home", "펫홈", "핵심 데이터", null],
  ["equipped_furniture", "장착가구", "핵심 데이터", "/장착가구동기화"],
  ["member_pet", "펫멤버", "핵심 데이터", "/펫데이터동기화"],
  ["pet_skill", "펫스킬", "핵심 데이터", null],
  ["pendant", "펜던트", "핵심 데이터", null],
  ["member_title", "회원칭호", "칭호·성장 데이터", null],
  ["pet_title", "펫칭호", "칭호·성장 데이터", "/펫타이틀동기화"],
  ["mini_pet_title", "미니펫칭호", "칭호·성장 데이터", null],
  ["mini_pet_collection", "미니펫도감", "칭호·성장 데이터", null],
  ["trial_tower", "시련의탑", "칭호·성장 데이터", "/시련의탑동기화"],
  ["pet_explore", "펫탐험", "칭호·성장 데이터", null],
  ["guild", "길드", "운영 데이터", "/길드데이터동기화"],
  ["attendance_light", "경량출석", "운영 데이터", null],
  ["board", "게시판", "운영 데이터", null],
  ["free_market", "자유시장", "운영 데이터", "/전체동기화"]
] as const;

const PHYSICAL_SOURCE_CODES = SOURCE_DEFINITIONS.filter((definition) => definition[0] !== "pendant").map((definition) => definition[0]);

// 인자나 접미 문구가 없는 정확한 관리자 통계 명령만 허용합니다.
export function isCharacterCountStatsCommand(message: string | undefined): boolean {
  return message === "/글자수통계";
}

// 15개 원본 스냅샷을 검증하고 member_pet에서 펜던트를 파생해 16개 통계로 투영합니다.
export function projectCharacterCountStats(rows: CharacterCountSourceRow[]): CharacterCountStat[] {
  const byCode = new Map<string, CharacterCountSourceRow>();
  for (const row of rows) {
    if (!PHYSICAL_SOURCE_CODES.includes(row.source_code as typeof PHYSICAL_SOURCE_CODES[number])) throw invalidBundle(`허용되지 않은 source_code: ${row.source_code}`);
    if (byCode.has(row.source_code)) throw invalidBundle(`중복 source_code: ${row.source_code}`);
    if (row.read_status !== "valid") throw invalidBundle(`유효하지 않은 source 상태: ${row.source_code}`);
    if (createHash("sha256").update(row.raw_json).digest("hex") !== row.content_sha256) throw invalidBundle(`hash 불일치: ${row.source_code}`);
    if (BigInt(row.raw_json.length) !== BigInt(row.utf16_code_unit_count)) throw invalidBundle(`UTF-16 글자 수 불일치: ${row.source_code}`);
    try { JSON.parse(row.raw_json); } catch { throw invalidBundle(`JSON 파싱 실패: ${row.source_code}`); }
    byCode.set(row.source_code, row);
  }
  const missing = PHYSICAL_SOURCE_CODES.filter((sourceCode) => !byCode.has(sourceCode));
  if (rows.length !== PHYSICAL_SOURCE_CODES.length || missing.length > 0) throw invalidBundle(`필수 source 누락: ${missing.join(",") || "source 개수 불일치"}`);

  const memberPet = JSON.parse(byCode.get("member_pet")!.raw_json) as unknown;
  if (!isRecord(memberPet)) throw invalidBundle("member_pet 최상위 구조가 객체가 아닙니다.");
  const pendantProjection: Record<string, unknown> = {};
  for (const [userKey, value] of Object.entries(memberPet)) {
    if (!isRecord(value)) continue;
    const bag = value.pendantBag;
    const hasBag = Array.isArray(bag) ? bag.length > 0 : isRecord(bag) ? Object.keys(bag).length > 0 : false;
    if (value.pendant !== undefined && value.pendant !== null || hasBag) pendantProjection[userKey] = { pendant: value.pendant ?? null, pendantBag: bag ?? [] };
  }
  const pendantJson = JSON.stringify(pendantProjection);

  return SOURCE_DEFINITIONS.map(([sourceCode, label, section, syncCommand]) => {
    if (sourceCode === "pendant") return { sourceCode, label, section, utf16CodeUnitCount: pendantJson.length.toString(), entityCount: Object.keys(pendantProjection).length.toString(), syncCommand };
    const row = byCode.get(sourceCode)!;
    return { sourceCode, label, section, utf16CodeUnitCount: BigInt(row.utf16_code_unit_count).toString(), entityCount: BigInt(row.entity_count).toString(), syncCommand };
  });
}

// 기존 명령의 세 구역과 동기화 안내를 유지한 통계 응답을 만듭니다.
export function formatCharacterCountStats(stats: CharacterCountStat[], environment: CharacterCountEnvironment, snapshotVersion: string): string {
  const lines = [`📊 저장 데이터 글자 수 통계 [${environment === "prod" ? "운영" : "DEV"}]`, `snapshot: ${snapshotVersion}`];
  for (const section of ["핵심 데이터", "칭호·성장 데이터", "운영 데이터"] as const) {
    lines.push("", `■ ${section}`);
    for (const stat of stats.filter((candidate) => candidate.section === section)) {
      lines.push(`- ${stat.label}: ${formatNumber(stat.utf16CodeUnitCount)}자 / ${formatNumber(stat.entityCount)}명`);
      if (stat.syncCommand !== null) lines.push(`  ${stat.syncCommand}`);
    }
  }
  return lines.join("\n");
}

// 관리자 권한과 고정 snapshot을 확인한 뒤 조회 결과, 감사, Outbox를 원자 기록합니다.
export class CharacterCountStatsService {
  constructor(private readonly database: DatabaseClient) {}

  async handleIris(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<
    { status: "changed"; data: string; outboxId: string } | { status: "shadow" | "legacy_fallback" | "handled_no_reply" }
  > {
    const decision = await new CommandDispatcher(new MariaCommandDispatchRepository(this.database), { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }).resolve({
      eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true
    });
    if (decision.route === "SHADOW") return { status: "shadow" };
    if (decision.route !== "MODERN") return { status: "legacy_fallback" };
    const result = await this.read({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.channelId, environment: "prod" });
    if (result === null) return { status: "handled_no_reply" };
    return { status: "changed", data: result.data, outboxId: result.outboxId };
  }

  async read(input: { eventId: string; externalUserId: string; destinationId: string; environment: CharacterCountEnvironment }): Promise<CharacterCountStatsResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' AND operator.status='active'
       AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides denied WHERE denied.operator_id=operator.id AND denied.permission_code='stats.character_count.read' AND denied.effect='deny')
       AND (EXISTS (SELECT 1 FROM admin_operator_permission_overrides allowed WHERE allowed.operator_id=operator.id AND allowed.permission_code='stats.character_count.read' AND allowed.effect='allow')
         OR EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='stats.character_count.read' WHERE operator_role.operator_id=operator.id))
       LIMIT 1`, [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;
    const idempotencyKey = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ id: bigint; status: string; result_json: string | CharacterCountStatsResult | null; age_seconds: bigint }>>(
        "SELECT id,status,result_json,TIMESTAMPDIFF(SECOND,created_at,UTC_TIMESTAMP(3)) age_seconds FROM operations WHERE idempotency_scope='stats.character_count.read' AND idempotency_key=? FOR UPDATE", [idempotencyKey]
      ))[0];
      if (previous?.status === "completed" && previous.result_json !== null) return parseResult(previous.result_json);
      if (previous?.status === "processing" && BigInt(previous.age_seconds) < 300n) throw new ApplicationError("CHARACTER_COUNT_STATS_IN_PROGRESS", "같은 글자수 통계 요청을 처리 중입니다.", 409);

      const environment = (await transaction.query<Array<{ environment_code: CharacterCountEnvironment; database_identity: string; active_snapshot_set_id: bigint | null }>>(
        "SELECT environment_code,database_identity,active_snapshot_set_id FROM legacy_snapshot_environments WHERE environment_code=? FOR UPDATE", [input.environment]
      ))[0];
      if (environment === undefined || environment.active_snapshot_set_id === null) throw invalidBundle(`${input.environment} 활성 snapshot이 없습니다.`);
      const snapshotSet = (await transaction.query<Array<{ id: bigint; database_identity: string; snapshot_version: bigint; snapshot_at: string }>>(
        "SELECT id,database_identity,snapshot_version,DATE_FORMAT(snapshot_at,'%Y-%m-%d %H:%i:%s') snapshot_at FROM legacy_snapshot_sets WHERE id=? AND environment_code=? AND snapshot_status='ready' FOR UPDATE",
        [environment.active_snapshot_set_id, input.environment]
      ))[0];
      if (snapshotSet === undefined || snapshotSet.database_identity !== environment.database_identity) throw invalidBundle("DB environment identity와 snapshot이 일치하지 않습니다.");
      const rows = await transaction.query<CharacterCountSourceRow[]>(
        "SELECT source_code,raw_json,content_sha256,utf16_code_unit_count,entity_count,read_status FROM legacy_source_snapshots WHERE snapshot_set_id=? ORDER BY source_code FOR UPDATE", [snapshotSet.id]
      );
      const stats = projectCharacterCountStats(rows);
      const snapshotVersion = BigInt(snapshotSet.snapshot_version).toString();
      const data = formatCharacterCountStats(stats, input.environment, snapshotVersion);
      const operation = previous === undefined
        ? await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'stats.character_count.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), idempotencyKey, operator.id])
        : { insertId: previous.id };
      if (previous !== undefined) await transaction.execute("UPDATE operations SET status='processing',result_json=NULL,created_at=UTC_TIMESTAMP(3),completed_at=NULL WHERE id=?", [previous.id]);
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId,input.destinationId,JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_CHARACTER_COUNT_STATS',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId,operation.insertId]);
      await transaction.execute("INSERT INTO admin_character_count_stat_executions(operation_id,snapshot_set_id,environment_code,database_identity,snapshot_version,source_count,projection_count,result_sha256) VALUES (?,?,?,?,?,?,?,?)", [operation.insertId,snapshotSet.id,input.environment,environment.database_identity,snapshotSet.snapshot_version,rows.length,stats.length,createHash("sha256").update(data).digest("hex")]);
      const audit = await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'legacy_snapshot_set',?,'stats.character_count.read','success','Iris /글자수통계',?,UTC_TIMESTAMP(3))", [operation.insertId,operator.id,snapshotSet.id,JSON.stringify({ readOnly:true,environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion,sourceCount:rows.length,projectionCount:stats.length })]);
      const result: CharacterCountStatsResult = { status:"counted",environment:input.environment,databaseIdentity:environment.database_identity,snapshotVersion,snapshotAt:snapshotSet.snapshot_at,sourceCount:rows.length,projectionCount:stats.length,stats,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operation.insertId]);
      return result;
    }));
  }
}

function invalidBundle(detail: string): ApplicationError {
  return new ApplicationError("CHARACTER_COUNT_SNAPSHOT_INVALID", `글자수 통계 snapshot이 완전하지 않습니다: ${detail}`, 409);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatNumber(value: string): string {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function parseResult(value: string | CharacterCountStatsResult): CharacterCountStatsResult {
  return typeof value === "string" ? JSON.parse(value) as CharacterCountStatsResult : value;
}

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt=0;attempt<3;attempt+=1) {
    try { return await work(); }
    catch (error) {
      const databaseError=error as {code?:unknown;errno?:unknown};
      if (attempt===2 || (databaseError.code!=="ER_LOCK_DEADLOCK" && databaseError.errno!==1213 && databaseError.code!=="ER_DUP_ENTRY" && databaseError.errno!==1062)) throw error;
    }
  }
  throw new Error("Character count stats retry exhausted.");
}
