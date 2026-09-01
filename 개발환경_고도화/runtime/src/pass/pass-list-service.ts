import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { isPassListCommandCandidate } from "./pass-list-command.js";
import { PassListPremiumCleanupProvider } from "./pass-list-premium-cleanup-provider.js";

type Operator = { operator_id: bigint; display_name: string };
type PassProjection = { player_id: bigint; display_name: string; rank_emoji: string | null; pass_code: string; entitlement_kind: "permanent" | "dated"; end_date: Date | string | null };
type InvalidItem = { display_name: string; rank_emoji: string | null; quantity: bigint | number | string };
export type PassListResult = { status: "read"; data: string; outboxId: string; auditId: string; replayed: boolean; expiredCount: number };

const scope = "support.pass.list.read", commandCode = "PASS_LIST_READ";
const passOrder = ["oneday", "newbie", "hoi", "premium", "contribution", "diamond"] as const;
const passLabels: Record<string, string> = { oneday: "원데이패스🎲", newbie: "초보패스🐥", hoi: "호이패스🐶", premium: "호이패스 프리미엄👑", contribution: "길드공헌패스🎖️", diamond: "다이아패스💎" };
const key = (value: string) => value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
const stored = (value: string | PassListResult) => typeof value === "string" ? JSON.parse(value) as PassListResult : value;
const dateText = (value: Date | string | null) => value === null ? null : (value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10));
const shortDate = (value: Date | string | null) => { const text = dateText(value); return text ? `${text.slice(2, 4)}.${text.slice(5, 7)}.${text.slice(8, 10)}` : ""; };

// Asia/Seoul 기준 오늘 날짜를 YYYY-MM-DD로 반환합니다.
function todayKst(): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// 레거시 코드와 versioned pass code를 동일한 조회 코드로 정규화합니다.
function normalizePassCode(value: string): string | null {
  const compact = value.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.includes("oneday") || compact === "daily") return "oneday";
  if (compact.includes("newbie") || compact.includes("beginner")) return "newbie";
  if (compact.includes("premium")) return "premium";
  if (compact.includes("contribution")) return "contribution";
  if (compact.includes("diamond")) return "diamond";
  if (compact.includes("hoi") || compact === "support") return "hoi";
  return null;
}

function formatPassList(rows: PassProjection[]): string {
  const allsee = "\u200b".repeat(500), lines = [`호월패스 전체목록 안내:`, `[원데이패스, 초보패스, 호이패스, 호이패스 프리미엄, 길드공헌패스, 다이아패스] / ${allsee}`];
  for (const code of passOrder) {
    lines.push(`${passLabels[code]} 명단`);
    const members = rows.filter((row) => row.pass_code === code).sort((a, b) => {
      if (a.entitlement_kind !== b.entitlement_kind) return a.entitlement_kind === "dated" ? -1 : 1;
      const dateCompare = (dateText(a.end_date) ?? "9999-99-99").localeCompare(dateText(b.end_date) ?? "9999-99-99");
      return dateCompare || a.display_name.localeCompare(b.display_name, "ko");
    });
    if (members.length === 0) lines.push("미사용중[❌]");
    else for (const member of members) lines.push(`[${member.rank_emoji ?? ""}] ${member.entitlement_kind === "permanent" ? "영구권 사용중[✅]" : `${shortDate(member.end_date)} 까지`} ${member.display_name}`);
    lines.push("━━━━━━━━━━━");
  }
  return lines.join("\n");
}

function formatInvalidItems(title: string, empty: string, description: string[], rows: InvalidItem[]): string {
  const lines = [rows.length === 0 ? `✅ ${title}` : `⚠️ ${title}`, "━━━━━━━━━━━━"];
  if (rows.length === 0) lines.push(empty);
  else {
    lines.push(...description);
    rows.forEach((row, index) => lines.push(`${index + 1}. ${row.rank_emoji ?? ""} ${row.display_name} — ${title.startsWith("자동") ? "자동탐험권🌄" : "호이응원패키지(무료)🐹"} x${String(row.quantity)}`));
    lines.push(`총 ${rows.length}명`);
  }
  return lines.join("\n");
}

async function rewardStatus(tx: DatabaseTransaction, today: string): Promise<string> {
  const tables = ["overall_rank_reward_runs", "mini_pet_rank_reward_runs", "guild_rank_reward_runs", "tier_reward_payout_runs", "guild_territory_rank_reward_runs"];
  const values: boolean[] = [];
  for (const table of tables) values.push(((await tx.query<Array<{ count_value: bigint }>>(`SELECT COUNT(*) count_value FROM ${table} WHERE period_key=?`, [today]))[0]?.count_value ?? 0n) > 0n);
  const mark = (index: number) => values[index] ? "✅" : "❌";
  return ["《🎁 금일 순위 보상 지급 현황》", `/보상지급 오후 3시 32분 [${mark(0)}]`, "└ 종합순위 보상", `/연금지급 오후 3시 32분 [${mark(1)}]`, "└ 미니펫 순위 보상", `/길드보상지급 오후 3시 33분 [${mark(2)}]`, `/티어보상지급 오후 3시 36분 [${mark(3)}]`, `/영지순위보상지급 오후 10시 05분 [${mark(4)}]`].join("\n");
}

// 만료된 pass를 정리하고 두 저장소의 활성 entitlement를 하나의 운영 목록으로 투영합니다.
export class PassListService {
  public constructor(private readonly database: DatabaseClient) {}
  public async execute(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PassListResult> {
    if (!isPassListCommandCandidate(input.message)) throw new ApplicationError("PASS_LIST_COMMAND_INVALID", "패스목록 명령 형식을 확인해 주세요.", 422);
    const operator = (await this.database.query<Operator[]>(`SELECT mapping.operator_id,operator.display_name FROM external_identities identity JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY mapping.operator_id LIMIT 1`, [input.externalUserId]))[0];
    if (!operator) throw new ApplicationError("PASS_LIST_FORBIDDEN", "패스목록 조회 권한이 없습니다.", 403);
    return this.database.withTransaction(async (tx) => {
      const idempotencyKey = key(input.eventId), prior = (await tx.query<Array<{ result_json: string | PassListResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, idempotencyKey]))[0];
      if (prior?.result_json != null) return { ...stored(prior.result_json), replayed: true };
      const operation = (await tx.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), scope, idempotencyKey, operator.operator_id])).insertId;
      const today = todayKst();
      const expiredSupport = await tx.query<Array<{ id: bigint; player_id: bigint; pass_code: string }>>("SELECT id,player_id,pass_code FROM player_support_passes WHERE status='active' AND entitlement_kind='dated' AND end_date<? FOR UPDATE", [today]);
      for (const row of expiredSupport) {
        await tx.execute("UPDATE player_support_passes SET status='expired',version=version+1,updated_operation_id=?,updated_at=UTC_TIMESTAMP(3) WHERE id=?", [operation, row.id]);
        await tx.execute("INSERT INTO support_pass_change_events(operation_id,pass_id,player_id,pass_code,action_code,previous_status,previous_kind,previous_end_date,next_status,next_kind,next_end_date,changed,created_at) SELECT ?,id,player_id,pass_code,'expire','active',entitlement_kind,end_date,'expired',entitlement_kind,end_date,TRUE,UTC_TIMESTAMP(3) FROM player_support_passes WHERE id=?", [operation, row.id]);
      }
      const expiredLegacy = await tx.query<Array<{ player_id: bigint; pass_code: string }>>("SELECT player_id,pass_code FROM player_passes WHERE enabled=TRUE AND permanent=FALSE AND ends_at IS NOT NULL AND DATE(ends_at)<? FOR UPDATE", [today]);
      const premiumPlayers = new Set<string>();
      for (const row of [...expiredSupport, ...expiredLegacy]) if (normalizePassCode(row.pass_code) === "premium") premiumPlayers.add(String(row.player_id));
      const premiumCleanup = new PassListPremiumCleanupProvider();
      for (const playerId of premiumPlayers) await premiumCleanup.cleanup(tx, { parentOperationId: operation, operatorId: operator.operator_id, playerId: BigInt(playerId), today });
      if (expiredLegacy.length) await tx.execute("UPDATE player_passes SET enabled=FALSE WHERE enabled=TRUE AND permanent=FALSE AND ends_at IS NOT NULL AND DATE(ends_at)<?", [today]);
      const cleanupPlayers = new Set<string>();
      for (const row of [...expiredSupport, ...expiredLegacy]) { const normalized = normalizePassCode(row.pass_code); if (normalized === "newbie" || normalized === "hoi" || normalized === "premium") cleanupPlayers.add(String(row.player_id)); }
      let ledgerSequence = 1;
      for (const playerId of cleanupPlayers) {
        const activeLegacy = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND enabled=TRUE AND (permanent=TRUE OR ends_at IS NULL OR DATE(ends_at)>=?) AND (LOWER(pass_code) LIKE '%newbie%' OR LOWER(pass_code) LIKE '%hoi%' OR LOWER(pass_code) LIKE '%premium%' OR LOWER(pass_code)='support')", [playerId, today]))[0]!.count_value;
        const activeVersioned = (await tx.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_support_passes WHERE player_id=? AND status='active' AND (entitlement_kind='permanent' OR end_date>=?) AND pass_code IN ('newbie','hoi','premium')", [playerId, today]))[0]!.count_value;
        if (activeLegacy + activeVersioned > 0n) continue;
        const ticket = (await tx.query<Array<{ item_id: bigint; quantity: bigint }>>("SELECT stack.item_id,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.display_name='자동탐험권🌄' FOR UPDATE", [playerId]))[0];
        if (ticket && ticket.quantity > 0n) { await tx.execute("UPDATE inventory_stacks SET quantity=0,version=version+1 WHERE player_id=? AND item_id=?", [playerId, ticket.item_id]); await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code,created_at) VALUES (?,?,?,?,NULL,?,'support_pass_expired',UTC_TIMESTAMP(3))", [operation, ledgerSequence++, playerId, ticket.item_id, -ticket.quantity]); }
      }
      const raw = await tx.query<Array<PassProjection & { source_priority: number }>>(`SELECT legacy.player_id,profile.current_display_name display_name,rank_profile.rank_emoji,legacy.pass_code,IF(legacy.permanent,'permanent','dated') entitlement_kind,legacy.ends_at end_date,2 source_priority FROM player_passes legacy JOIN players player ON player.id=legacy.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=legacy.player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=legacy.player_id WHERE legacy.enabled=TRUE AND (legacy.permanent=TRUE OR legacy.ends_at IS NULL OR DATE(legacy.ends_at)>=?) UNION ALL SELECT versioned.player_id,profile.current_display_name,rank_profile.rank_emoji,versioned.pass_code,versioned.entitlement_kind,versioned.end_date,1 FROM player_support_passes versioned JOIN players player ON player.id=versioned.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=versioned.player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=versioned.player_id WHERE versioned.status='active' AND (versioned.entitlement_kind='permanent' OR versioned.end_date>=?)`, [today, today]);
      const unique = new Map<string, PassProjection>();
      for (const row of raw.sort((a, b) => a.source_priority - b.source_priority)) { const normalized = normalizePassCode(row.pass_code); if (normalized) { const mapKey = `${row.player_id}:${normalized}`; if (!unique.has(mapKey)) unique.set(mapKey, { ...row, pass_code: normalized }); } }
      const invalidTickets = await tx.query<InvalidItem[]>(`SELECT profile.current_display_name display_name,rank_profile.rank_emoji,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id AND item.display_name='자동탐험권🌄' JOIN player_profiles profile ON profile.player_id=stack.player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=stack.player_id WHERE stack.quantity>0 AND NOT EXISTS(SELECT 1 FROM player_passes pass WHERE pass.player_id=stack.player_id AND pass.enabled=TRUE AND (pass.permanent=TRUE OR pass.ends_at IS NULL OR DATE(pass.ends_at)>=?) AND (LOWER(pass.pass_code) LIKE '%newbie%' OR LOWER(pass.pass_code) LIKE '%hoi%' OR LOWER(pass.pass_code) LIKE '%premium%' OR LOWER(pass.pass_code)='support')) AND NOT EXISTS(SELECT 1 FROM player_support_passes pass WHERE pass.player_id=stack.player_id AND pass.status='active' AND pass.pass_code IN ('newbie','hoi','premium') AND (pass.entitlement_kind='permanent' OR pass.end_date>=?)) ORDER BY profile.current_display_name`, [today, today]);
      const packageRows = await tx.query<InvalidItem[]>(`SELECT profile.current_display_name display_name,rank_profile.rank_emoji,SUM(source.quantity) quantity FROM (SELECT stack.player_id,stack.quantity FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE item.display_name LIKE '호이응원패키지(무료)🐹%' UNION ALL SELECT CAST(balance.owner_id AS UNSIGNED),balance.quantity FROM package_item_balances balance JOIN package_item_definitions item ON item.item_id=balance.item_id WHERE balance.owner_type='PLAYER' AND item.item_name LIKE '호이응원패키지(무료)🐹%') source JOIN player_profiles profile ON profile.player_id=source.player_id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=source.player_id GROUP BY source.player_id,profile.current_display_name,rank_profile.rank_emoji HAVING SUM(source.quantity)>=3 ORDER BY profile.current_display_name`);
      const data = [formatPassList([...unique.values()]), await rewardStatus(tx, today), formatInvalidItems("자동탐험권 정합성 검사", "삭제 대상 유저가 없습니다.", ["초보패스·호이패스·호이패스 프리미엄 명단에는 없지만", "자동탐험권🌄을 보유 중인 유저입니다."], invalidTickets), formatInvalidItems("호이응원패키지(무료)🐹 보유 검사", "3개 이상 소지 유저가 없습니다.", ["[1]~[10] 합산 기준입니다."], packageRows)].join("\n\n");
      const expiredCount = expiredSupport.length + expiredLegacy.length;
      const audit = await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'pass_registry',NULL,'support.pass.list.read','read','Iris 패스목록 조회',?,UTC_TIMESTAMP(3))", [operation, operator.operator_id, JSON.stringify({ expiredCount, projectedCount: unique.size, invalidTicketCount: invalidTickets.length, packageWarningCount: packageRows.length })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','read',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operation]);
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation, input.destinationId, JSON.stringify({ data })]);
      const result: PassListResult = { status: "read", data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), replayed: false, expiredCount };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation]);
      return result;
    });
  }
}
