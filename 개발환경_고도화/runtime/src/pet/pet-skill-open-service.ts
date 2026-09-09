import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const PET_SKILL_OPEN_BOOK_CODE = "pet_skill_book";
export const PET_SKILL_OPEN_BAG_LIMIT = 100n;
export const PET_SKILL_OPEN_COUNT_LIMIT = 100n;
const UINT64_MAX = 18446744073709551615n;
const ALLSEE = "\u200b".repeat(500);

interface CatalogRules {
  grade?: unknown;
  rate?: unknown;
  actualRate?: unknown;
  weight?: unknown;
  [key: string]: unknown;
}

interface CatalogRow {
  id: bigint;
  code: string;
  display_name: string;
  rules_json: string | CatalogRules;
}

interface CatalogEntry {
  id: bigint;
  code: string;
  displayName: string;
  grade: string;
  rate: number;
  weight: number;
  rules: CatalogRules;
}

interface DrawEvidence {
  sequence: number;
  sample: number;
  lower: number;
  upper: number;
  selected: CatalogEntry;
}

export interface PetSkillOpenStoredResult {
  status: "opened";
  reply: string;
  outboxId: string;
  playerId: string;
  playerPetId: string;
  openCount: string;
  remainingBookQuantity: string;
  catalogHash: string;
}

export type PetSkillOpenResult = PetSkillOpenStoredResult | { status: "blocked_by_castle_siege" };
export type PetSkillOpenRng = () => number;

// 정확한 기본 명령 또는 숫자 인자 하나를 가진 완전 일치 명령만 후보로 분류합니다.
export function isPetSkillOpenCandidate(message: string | undefined): boolean {
  return message === "/펫스킬오픈" || (message !== undefined && /^\/펫스킬오픈\s+\d+$/.test(message));
}

// uint64 범위의 입력을 해석하고 레거시처럼 실제 오픈 수량을 최대 100개로 제한합니다.
export function parsePetSkillOpenCount(message: string): bigint | null {
  if (message === "/펫스킬오픈") return 1n;
  const match = /^\/펫스킬오픈\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const requested = BigInt(match[1]!);
  if (requested === 0n || requested > UINT64_MAX) return null;
  return requested > PET_SKILL_OPEN_COUNT_LIMIT ? PET_SKILL_OPEN_COUNT_LIMIT : requested;
}

// DB 대표 별칭으로 숫자형 명령을 정규화하되 잘못된 입력은 원문으로 남깁니다.
export function normalizePetSkillOpenDispatchMessage(message: string): string {
  if (message === "/펫스킬오픈") return message;
  return /^\/펫스킬오픈\s+\d+$/.test(message) ? "/펫스킬오픈 [숫자]" : message;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function rulesObject(value: string | CatalogRules): CatalogRules {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new ApplicationError("PET_SKILL_OPEN_CATALOG_INVALID", "펫스킬 확률 설정을 확인할 수 없습니다.", 409);
  return parsed as CatalogRules;
}

function finiteNumber(value: unknown): number | null {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function canonicalCatalog(entries: CatalogEntry[]): string {
  return JSON.stringify(entries.map((entry) => ({
    id: entry.id.toString(),
    code: entry.code,
    displayName: entry.displayName,
    grade: entry.grade,
    rate: entry.rate,
    weight: entry.weight,
    rules: Object.fromEntries(Object.entries(entry.rules).sort(([left], [right]) => left.localeCompare(right))),
  })));
}

function pick(entries: CatalogEntry[], rng: PetSkillOpenRng, sequence: number): DrawEvidence {
  const sample = rng();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new ApplicationError("PET_SKILL_OPEN_RNG_INVALID", "펫스킬 추첨값이 올바르지 않습니다.", 409);
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const lower = cumulative / totalWeight;
    cumulative += entry.weight;
    const upper = index === entries.length - 1 ? 1 : cumulative / totalWeight;
    if (sample < upper || index === entries.length - 1) return { sequence, sample, lower, upper, selected: entry };
  }
  throw new ApplicationError("PET_SKILL_OPEN_DRAW_FAILED", "펫스킬 추첨에 실패했습니다.", 409);
}

function gradeOrder(grade: string): number {
  const order: Record<string, number> = { SS: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
  return order[grade] ?? 999;
}

// 책 소비, 확률 추첨, 스킬 적재와 모든 운영 증적을 한 DB 트랜잭션으로 처리합니다.
export class PetSkillOpenService {
  constructor(private readonly database: DatabaseClient, private readonly rng: PetSkillOpenRng = Math.random) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetSkillOpenResult> {
    const count = parsePetSkillOpenCount(input.message);
    if (count === null) throw new ApplicationError("INVALID_PET_SKILL_OPEN", "사용법: /펫스킬오픈 [개수]", 422);

    return this.database.withTransaction(async (transaction) => {
      const siege = await transaction.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))",
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owner = (await transaction.query<Array<{ identity_id: bigint; player_id: bigint; current_display_name: string; rank_emoji: string | null }>>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name,rank_profile.rank_emoji
         FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL
         JOIN player_profiles profile ON profile.player_id=identity.player_id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' FOR UPDATE`,
        [input.externalUserId],
      ))[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `pet.skill_open:${owner.identity_id}`;
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetSkillOpenStoredResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key],
      );
      if (prior[0]?.result_json != null) {
        return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as PetSkillOpenStoredResult : prior[0].result_json;
      }

      const pet = (await transaction.query<Array<{ id: bigint }>>(
        "SELECT id FROM player_pets WHERE player_id=? ORDER BY id LIMIT 1 FOR UPDATE", [owner.player_id],
      ))[0];
      if (pet === undefined) throw new ApplicationError("PET_SKILL_OPEN_PET_REQUIRED", "펫이 없습니다.", 409);

      const catalogRows = await transaction.query<CatalogRow[]>(
        `SELECT id,code,display_name,rules_json FROM skill_definitions
         WHERE active=TRUE AND JSON_EXTRACT(rules_json,'$.grade') IS NOT NULL
           AND (JSON_EXTRACT(rules_json,'$.actualRate') IS NOT NULL OR JSON_EXTRACT(rules_json,'$.rate') IS NOT NULL)
           AND JSON_EXTRACT(rules_json,'$.weight') IS NOT NULL
         ORDER BY id FOR UPDATE`,
      );
      const catalog = catalogRows.map((row): CatalogEntry => {
        const rules = rulesObject(row.rules_json);
        const grade = typeof rules.grade === "string" ? rules.grade : "";
        const rate = finiteNumber(rules.actualRate ?? rules.rate);
        const weight = finiteNumber(rules.weight);
        if (grade === "" || rate === null || rate < 0 || weight === null || weight <= 0) throw new ApplicationError("PET_SKILL_OPEN_CATALOG_INVALID", "펫스킬 확률 설정을 확인할 수 없습니다.", 409);
        return { id: row.id, code: row.code, displayName: row.display_name, grade, rate, weight, rules };
      });
      if (catalog.length === 0) throw new ApplicationError("PET_SKILL_OPEN_CATALOG_REQUIRED", "펫스킬 확률 설정을 찾을 수 없습니다.", 409);
      const catalogSnapshot = canonicalCatalog(catalog);
      const catalogHash = createHash("sha256").update(catalogSnapshot).digest("hex");

      const bookItem = (await transaction.query<Array<{ id: bigint; display_name: string }>>(
        "SELECT id,display_name FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE FOR UPDATE", [PET_SKILL_OPEN_BOOK_CODE],
      ))[0];
      if (bookItem === undefined) throw new ApplicationError("PET_SKILL_OPEN_BOOK_CONFIG_REQUIRED", "펫스킬북 설정을 찾을 수 없습니다.", 409);
      const book = (await transaction.query<Array<{ quantity: bigint; version: bigint }>>(
        "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE", [owner.player_id, bookItem.id],
      ))[0];
      const bookQuantity = BigInt(book?.quantity ?? 0n);
      if (book === undefined || bookQuantity <= 0n) throw new ApplicationError("PET_SKILL_OPEN_BOOK_REQUIRED", `${bookItem.display_name}이 가방에 없어요.😅`, 409);
      if (bookQuantity < count) throw new ApplicationError("PET_SKILL_OPEN_BOOK_SHORTAGE", `${bookItem.display_name} 수량이 부족합니다.\n보유: ${commas(bookQuantity)}개`, 409);

      const inventory = await transaction.query<Array<{ skill_id: bigint; quantity: bigint; version: bigint }>>(
        "SELECT skill_id,quantity,version FROM pet_skill_inventory WHERE player_pet_id=? ORDER BY skill_id FOR UPDATE", [pet.id],
      );
      const bagQuantity = inventory.reduce((sum, row) => sum + BigInt(row.quantity), 0n);
      const remaining = PET_SKILL_OPEN_BAG_LIMIT - bagQuantity;
      if (remaining < count) throw new ApplicationError(
        "PET_SKILL_OPEN_BAG_FULL",
        `❌ 스킬가방 공간이 부족합니다.\n현재: ${commas(bagQuantity)}/${PET_SKILL_OPEN_BAG_LIMIT}\n남은 공간: ${commas(remaining < 0n ? 0n : remaining)}개`,
        409,
      );

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id],
      );
      const bookAfter = bookQuantity - count;
      const bagAfter = bagQuantity + count;
      await transaction.execute(
        `INSERT INTO pet_skill_open_operations(operation_id,player_id,player_pet_id,book_item_id,open_count,book_quantity_before,book_quantity_after,skill_bag_quantity_before,skill_bag_quantity_after,catalog_hash,catalog_snapshot_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [operation.insertId, owner.player_id, pet.id, bookItem.id, count, bookQuantity, bookAfter, bagQuantity, bagAfter, catalogHash, catalogSnapshot],
      );

      const draws: DrawEvidence[] = [];
      const awarded = new Map<bigint, { entry: CatalogEntry; count: bigint }>();
      for (let sequence = 1; sequence <= Number(count); sequence += 1) {
        const draw = pick(catalog, this.rng, sequence);
        draws.push(draw);
        const aggregate = awarded.get(draw.selected.id);
        if (aggregate === undefined) awarded.set(draw.selected.id, { entry: draw.selected, count: 1n });
        else aggregate.count += 1n;
      }

      const bookChanged = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [bookAfter, owner.player_id, bookItem.id, book.version],
      );
      if (bookChanged.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_OPEN_CONFLICT", "펫스킬북 보유량이 먼저 변경되었습니다.", 409);

      for (const award of awarded.values()) {
        const existing = inventory.find((row) => row.skill_id === award.entry.id);
        if (existing === undefined) {
          await transaction.execute(
            "INSERT INTO pet_skill_inventory(player_pet_id,skill_id,quantity,version,updated_at) VALUES (?,?,?,1,UTC_TIMESTAMP(3))",
            [pet.id, award.entry.id, award.count],
          );
        } else {
          const changed = await transaction.execute(
            "UPDATE pet_skill_inventory SET quantity=quantity+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_pet_id=? AND skill_id=? AND version=?",
            [award.count, pet.id, award.entry.id, existing.version],
          );
          if (changed.affectedRows !== 1n) throw new ApplicationError("PET_SKILL_OPEN_CONFLICT", "펫스킬가방이 먼저 변경되었습니다.", 409);
        }
      }

      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'pet_skill_book_open_consume')",
        [operation.insertId, owner.player_id, bookItem.id, -count],
      );
      for (const draw of draws) {
        await transaction.execute(
          `INSERT INTO pet_skill_open_draws(operation_id,sequence_no,sample_value,interval_lower,interval_upper,selected_skill_id,selected_skill_code,selected_display_name,selected_grade,selected_rate,selected_weight,selected_rules_json)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          [operation.insertId, draw.sequence, draw.sample.toFixed(19), draw.lower.toFixed(19), draw.upper.toFixed(19), draw.selected.id, draw.selected.code, draw.selected.displayName, draw.selected.grade, draw.selected.rate.toFixed(10), draw.selected.weight.toFixed(10), JSON.stringify(draw.selected.rules)],
        );
      }

      const results = Array.from(awarded.values()).sort((left, right) => {
        const gradeDifference = gradeOrder(left.entry.grade) - gradeOrder(right.entry.grade);
        return gradeDifference !== 0 ? gradeDifference : left.entry.displayName.localeCompare(right.entry.displayName, "ko");
      });
      let reply = `📙 펫스킬북 ${commas(count)}개 오픈!\n[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님 획득 결과\n\n`;
      results.forEach((row, index) => {
        if (index === 10) reply += ALLSEE;
        reply += `- [${row.entry.grade}] ${row.entry.displayName} (확률: ${row.entry.rate.toFixed(1)}%) x${commas(row.count)}\n`;
      });
      reply += `\n잔여: ${commas(bookAfter)}개\n/펫스킬가방에서 확인하세요.`;
      reply = reply.trim();

      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data: reply })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_SKILL_OPEN',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId],
      );
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player_pet',?,'pet.skill_open','success','Iris /펫스킬오픈',?,UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, pet.id, JSON.stringify({ openCount: count.toString(), bookQuantity: bookAfter.toString(), skillBagQuantity: bagAfter.toString(), catalogHash, draws: draws.length })],
      );
      const result: PetSkillOpenStoredResult = { status: "opened", reply, outboxId: outbox.insertId.toString(), playerId: owner.player_id.toString(), playerPetId: pet.id.toString(), openCount: count.toString(), remainingBookQuantity: bookAfter.toString(), catalogHash };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
