import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/샵오픈";
const TICKET_ITEM_CODE = "ITEM-RWD-001";
const MAX_DRAW_QUANTITY = 5000n;
const ALLSEE = "\u200b".repeat(500);

export type HomeFurnitureDrawCommand = { quantity: bigint };
export interface FurnitureDrawBand {
  ordinal: number;
  name: string;
  weight: bigint;
}
export interface FurnitureDrawEntryChoice {
  id: string;
  definitionId: string;
  gradeOrdinal: number;
  display: string;
  furnitureName: string;
  charm: bigint;
}
export interface PlannedFurnitureDraw {
  sequence: number;
  entry: FurnitureDrawEntryChoice;
  gradeName: string;
  gradeRoll: bigint;
  itemRoll: bigint;
}
export interface HomeFurnitureDrawItem {
  sequence: number;
  catalogEntryId: string;
  furnitureInstanceId: string;
  instanceCode: string;
  display: string;
  grade: string;
}
export interface HomeFurnitureDrawResult {
  status: "drawn" | "rejected";
  reply: string;
  outboxId: string;
  noticeOutboxIds: string[];
  requestedQuantity?: string;
  ticketBefore?: string;
  ticketAfter?: string;
  bagCountBefore?: string;
  bagCountAfter?: string;
  bagCapacity?: string;
  catalogVersion?: string;
  seedHash?: string;
  draws?: HomeFurnitureDrawItem[];
}

type Owner = { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null };
type Policy = { base_bag_limit: bigint; premium_bag_bonus: bigint };
type ItemDefinition = { id: bigint };
type Stack = { quantity: bigint | string; version: bigint | string };
type Catalog = { id: bigint; version_code: string; source_sha256: string; rate_scale: bigint | string };
type GradeBandRow = { grade_ordinal: bigint | number; grade_display_name: string; weight_scaled: bigint | string; entry_count: bigint | number };
type EntryRow = { id: bigint; furniture_definition_id: bigint; grade_ordinal: bigint | number; source_display_snapshot: string; display_name: string; charm_value: bigint | string };

export function isHomeFurnitureDrawCandidate(message: string | undefined): boolean {
  return message === COMMAND || (message !== undefined && /^\/샵오픈\s+\d+$/.test(message));
}

export function normalizeHomeFurnitureDrawDispatchMessage(message: string): string {
  return isHomeFurnitureDrawCandidate(message) ? COMMAND : message;
}

export function parseHomeFurnitureDrawCommand(message: string): HomeFurnitureDrawCommand {
  if (message === COMMAND) return { quantity: 1n };
  const match = /^\/샵오픈\s+(\d+)$/.exec(message);
  if (match === null) throw new ApplicationError("HOME_FURNITURE_DRAW_COMMAND_INVALID", "정확한 /샵오픈 [수량]을 입력해주세요.", 422);
  return { quantity: BigInt(match[1]!) };
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | HomeFurnitureDrawResult): HomeFurnitureDrawResult {
  return typeof value === "string" ? JSON.parse(value) as HomeFurnitureDrawResult : value;
}

function hashRoll(seedHash: string, domain: string, bound: bigint): bigint {
  if (bound <= 0n) throw new Error("가구 뽑기 난수 범위가 비어 있습니다.");
  const value = BigInt("0x" + createHash("sha256").update(seedHash).update("\0").update(domain).digest("hex").slice(0, 16));
  return value % bound;
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// catalog 등급 확률과 등급 내부 목록을 이벤트 seed로 결정해 재시작 가능한 결과를 만듭니다.
export function planHomeFurnitureDraws(
  seedHash: string,
  bands: FurnitureDrawBand[],
  entries: FurnitureDrawEntryChoice[],
  quantity: number
): PlannedFurnitureDraw[] {
  const orderedBands = [...bands].sort((left, right) => left.ordinal - right.ordinal);
  const totalWeight = orderedBands.reduce((sum, band) => sum + band.weight, 0n);
  const byGrade = new Map<number, FurnitureDrawEntryChoice[]>();
  for (const entry of entries) {
    const group = byGrade.get(entry.gradeOrdinal) ?? [];
    group.push(entry);
    byGrade.set(entry.gradeOrdinal, group);
  }
  const result: PlannedFurnitureDraw[] = [];
  for (let sequence = 1; sequence <= quantity; sequence += 1) {
    const gradeRoll = hashRoll(seedHash, `grade:${sequence}`, totalWeight);
    let cumulative = 0n;
    let selectedBand = orderedBands[orderedBands.length - 1];
    for (const band of orderedBands) {
      cumulative += band.weight;
      if (gradeRoll < cumulative) {
        selectedBand = band;
        break;
      }
    }
    if (selectedBand === undefined) throw new Error("가구 등급 catalog가 비어 있습니다.");
    const candidates = byGrade.get(selectedBand.ordinal) ?? [];
    if (candidates.length === 0) throw new Error(`가구 등급 catalog 항목이 비어 있습니다: ${selectedBand.name}`);
    const itemRoll = hashRoll(seedHash, `item:${sequence}`, BigInt(candidates.length));
    result.push({ sequence, entry: candidates[Number(itemRoll)]!, gradeName: selectedBand.name, gradeRoll, itemRoll });
  }
  return result;
}

function instanceCode(seedHash: string, sequence: number, attempt: number): string {
  const space = 36n ** 6n;
  return hashRoll(seedHash, `code:${sequence}:${attempt}`, space).toString(36).padStart(6, "0").toUpperCase();
}

// 가구 뽑기 결과를 기존 가구 UI 형식과 stable 인스턴스 코드로 표시합니다.
export function formatHomeFurnitureDrawReply(
  nickname: string,
  ticketBefore: bigint,
  ticketAfter: bigint,
  bagBefore: bigint,
  bagAfter: bigint,
  bagCapacity: bigint,
  draws: Array<{ display: string; instanceCode: string }>
): string {
  const lines = draws.map((draw, index) => `${index === 10 ? ALLSEE : ""}${index + 1}. ${draw.display} [${draw.instanceCode}]`);
  return `🏡[${nickname}]님, 가구 뽑기 완료!\n\n사용 티켓: ${ticketBefore - ticketAfter}개 (${ticketBefore} → ${ticketAfter})\n가구 가방: ${bagBefore}/${bagCapacity} → ${bagAfter}/${bagCapacity}\n━━━━━━━━━━━━━━━\n${lines.join("\n")}`;
}

async function complete(
  transaction: DatabaseTransaction,
  input: {
    operationId: bigint;
    eventId: string;
    destinationId: string;
    identityId: bigint;
    playerId: bigint;
    resultCode: string;
    reply: string;
    result: Omit<HomeFurnitureDrawResult, "reply" | "outboxId" | "noticeOutboxIds">;
    summary: Record<string, unknown>;
    notices?: string[];
  }
): Promise<HomeFurnitureDrawResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })]
  );
  const noticeOutboxIds: string[] = [];
  for (const notice of input.notices ?? []) {
    const noticeOutbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.operationId, input.destinationId, JSON.stringify({ data: notice })]
    );
    noticeOutboxIds.push(noticeOutbox.insertId.toString());
  }
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_FURNITURE_DRAW',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'home.furniture_draw',?,'Iris /샵오픈',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.identityId, input.playerId, input.resultCode, JSON.stringify(input.summary)]
  );
  const result: HomeFurnitureDrawResult = {
    ...input.result,
    reply: input.reply,
    outboxId: outbox.insertId.toString(),
    noticeOutboxIds
  };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 티켓 차감, 가방 용량, catalog draw, 가구 인스턴스와 모든 원장을 한 transaction으로 처리합니다.
export class HomeFurnitureDrawService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeFurnitureDrawResult> {
    if (!isHomeFurnitureDrawCandidate(input.message)) {
      throw new ApplicationError("HOME_FURNITURE_DRAW_COMMAND_INVALID", "정확한 /샵오픈 [수량]을 입력해주세요.", 422);
    }
    const command = parseHomeFurnitureDrawCommand(input.message);
    const key = eventKey(input.eventId);
    try {
      return await this.database.withTransaction(async (transaction) => {
        const owner = (await transaction.query<Owner[]>(
          "SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE",
          [input.externalUserId]
        ))[0];
        if (owner === undefined) throw new ApplicationError("HOME_FURNITURE_DRAW_OWNER_REQUIRED", "가입된 사용자 정보를 찾을 수 없습니다.", 404);
        const prior = (await transaction.query<Array<{ result_json: string | HomeFurnitureDrawResult | null }>>(
          "SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_draw' AND idempotency_key=? FOR UPDATE",
          [key]
        ))[0];
        if (prior?.result_json !== null && prior?.result_json !== undefined) return stored(prior.result_json);
        const operationId = (await transaction.execute(
          "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture_draw',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
          [randomUUID(), key, owner.identity_id]
        )).insertId;
        const nickname = `${owner.rank_emoji ?? ""}${owner.display_name}`;
        const reject = (code: string, reply: string, summary: Record<string, unknown> = {}) => complete(transaction, {
          operationId,
          eventId: input.eventId,
          destinationId: input.destinationId,
          identityId: owner.identity_id,
          playerId: owner.player_id,
          resultCode: code,
          reply,
          result: { status: "rejected", requestedQuantity: command.quantity.toString() },
          summary: { mutation: false, requestedQuantity: command.quantity.toString(), ...summary }
        });
        if (command.quantity < 1n || command.quantity > MAX_DRAW_QUANTITY) {
          return reject("invalid_quantity", `❌[${nickname}]님, 수량은 1개부터 5,000개까지 입력해주세요.\n사용법: /샵오픈 [수량]`);
        }

        await transaction.execute("INSERT IGNORE INTO player_homes(player_id,display_name) VALUES (?,?)", [owner.player_id, "서울역 4번출구🚉"]);
        await transaction.query("SELECT player_id FROM player_homes WHERE player_id=? FOR UPDATE", [owner.player_id]);
        const policy = (await transaction.query<Policy[]>(
          "SELECT base_bag_limit,premium_bag_bonus FROM home_furniture_bag_policy WHERE policy_key='default' FOR UPDATE"
        ))[0];
        if (policy === undefined) throw new Error("가구 가방 정책을 찾을 수 없습니다.");
        const premium = BigInt((await transaction.query<Array<{ count_value: bigint }>>(
          "SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND pass_code='premium' AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) FOR UPDATE",
          [owner.player_id]
        ))[0]?.count_value ?? 0n);
        const bagCapacity = BigInt(policy.base_bag_limit) + (premium > 0n ? BigInt(policy.premium_bag_bonus) : 0n);
        const bagCountBefore = BigInt((await transaction.query<Array<{ count_value: bigint }>>(
          "SELECT COUNT(*) count_value FROM furniture_inventory_instances WHERE player_id=? AND status='bag' FOR UPDATE",
          [owner.player_id]
        ))[0]?.count_value ?? 0n);
        if (bagCountBefore + command.quantity > bagCapacity) {
          return reject("bag_capacity_exceeded", `❌[${nickname}]님, 가구 가방 공간이 부족합니다. (${bagCountBefore}/${bagCapacity})\n필요 공간: ${command.quantity}칸`, {
            bagCountBefore: bagCountBefore.toString(),
            bagCapacity: bagCapacity.toString()
          });
        }

        const ticketItem = (await transaction.query<ItemDefinition[]>(
          "SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE LIMIT 1 FOR UPDATE",
          [TICKET_ITEM_CODE]
        ))[0];
        if (ticketItem === undefined) throw new Error("샵오픈 티켓 정의를 찾을 수 없습니다.");
        await transaction.execute("INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,0,0)", [owner.player_id, ticketItem.id]);
        const ticketStack = (await transaction.query<Stack[]>(
          "SELECT quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
          [owner.player_id, ticketItem.id]
        ))[0];
        if (ticketStack === undefined) throw new Error("샵오픈 티켓 가방을 찾을 수 없습니다.");
        const ticketBefore = BigInt(ticketStack.quantity);
        if (ticketBefore < command.quantity) {
          return reject("ticket_insufficient", `❌[${nickname}]님, 펫스윗홈인테리어샵🖼️ 아이템이 부족합니다. (${ticketBefore}/${command.quantity})`, {
            ticketBefore: ticketBefore.toString()
          });
        }

        const catalog = (await transaction.query<Catalog[]>(
          "SELECT id,version_code,source_sha256,rate_scale FROM home_furniture_draw_catalog_versions WHERE active=TRUE ORDER BY id DESC LIMIT 1 FOR UPDATE"
        ))[0];
        if (catalog === undefined) throw new Error("활성 가구 뽑기 catalog를 찾을 수 없습니다.");
        const bandRows = await transaction.query<GradeBandRow[]>(
          "SELECT grade_ordinal,grade_display_name,weight_scaled,entry_count FROM home_furniture_draw_grade_bands WHERE catalog_version_id=? ORDER BY grade_ordinal",
          [catalog.id]
        );
        const entryRows = await transaction.query<EntryRow[]>(
          "SELECT entry.id,entry.furniture_definition_id,entry.grade_ordinal,entry.source_display_snapshot,definition.display_name,definition.charm_value FROM home_furniture_draw_entries entry JOIN furniture_definitions definition ON definition.id=entry.furniture_definition_id AND definition.active=TRUE WHERE entry.catalog_version_id=? ORDER BY entry.grade_ordinal,entry.within_grade_sequence",
          [catalog.id]
        );
        const bands: FurnitureDrawBand[] = bandRows.map((row) => ({
          ordinal: Number(row.grade_ordinal),
          name: row.grade_display_name,
          weight: BigInt(row.weight_scaled)
        }));
        const entries: FurnitureDrawEntryChoice[] = entryRows.map((row) => ({
          id: row.id.toString(),
          definitionId: row.furniture_definition_id.toString(),
          gradeOrdinal: Number(row.grade_ordinal),
          display: row.source_display_snapshot,
          furnitureName: row.display_name,
          charm: BigInt(row.charm_value)
        }));
        if (bands.reduce((sum, band) => sum + band.weight, 0n) !== BigInt(catalog.rate_scale)) throw new Error("가구 등급 확률 합계가 catalog scale과 다릅니다.");
        for (const band of bandRows) {
          const count = entries.filter((entry) => entry.gradeOrdinal === Number(band.grade_ordinal)).length;
          if (count !== Number(band.entry_count)) throw new Error(`가구 catalog 개수가 다릅니다: ${band.grade_display_name}`);
        }

        const seedHash = createHash("sha256")
          .update(catalog.source_sha256)
          .update("\0")
          .update(key)
          .update("\0")
          .update(owner.player_id.toString())
          .update("\0")
          .update(command.quantity.toString())
          .digest("hex");
        const planned = planHomeFurnitureDraws(seedHash, bands, entries, Number(command.quantity));
        const ticketAfter = ticketBefore - command.quantity;
        const ticketWrite = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=?",
          [ticketAfter.toString(), owner.player_id, ticketItem.id, ticketStack.version, command.quantity.toString()]
        );
        if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("HOME_FURNITURE_DRAW_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'HOME_FURNITURE_DRAW_TICKET')",
          [operationId, owner.player_id, ticketItem.id, (-command.quantity).toString()]
        );
        const bagCountAfter = bagCountBefore + command.quantity;
        await transaction.execute(
          "INSERT INTO home_furniture_draw_operations(operation_id,player_id,catalog_version_id,ticket_item_id,requested_quantity,ticket_before,ticket_after,bag_count_before,bag_count_after,bag_capacity,seed_hash,result_digest) VALUES (?,?,?,?,?,?,?,?,?,?,?,REPEAT('0',64))",
          [operationId, owner.player_id, catalog.id, ticketItem.id, command.quantity.toString(), ticketBefore.toString(), ticketAfter.toString(), bagCountBefore.toString(), bagCountAfter.toString(), bagCapacity.toString(), seedHash]
        );

        const draws: HomeFurnitureDrawItem[] = [];
        for (const draw of planned) {
          let created: { id: bigint; code: string } | undefined;
          for (let attempt = 0; attempt < 64; attempt += 1) {
            const code = instanceCode(seedHash, draw.sequence, attempt);
            try {
              const inserted = await transaction.execute(
                "INSERT INTO furniture_inventory_instances(instance_code,player_id,furniture_definition_id,charm_snapshot,grade_display_name,status,version) VALUES (?,?,?,?,?,'bag',1)",
                [code, owner.player_id, draw.entry.definitionId, draw.entry.charm.toString(), draw.gradeName]
              );
              created = { id: inserted.insertId, code };
              break;
            } catch (error) {
              if (!isDuplicateKeyError(error)) throw error;
            }
          }
          if (created === undefined) throw new Error("가구 인스턴스 코드를 생성하지 못했습니다.");
          await transaction.execute(
            "INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,?,?, ?,'none','bag','HOME_FURNITURE_DRAW')",
            [operationId, draw.sequence, owner.player_id, created.id]
          );
          await transaction.execute(
            "INSERT INTO home_furniture_draw_results(operation_id,sequence_no,catalog_entry_id,furniture_instance_id,grade_roll,item_roll,instance_code) VALUES (?,?,?,?,?,?,?)",
            [operationId, draw.sequence, draw.entry.id, created.id, draw.gradeRoll.toString(), draw.itemRoll.toString(), created.code]
          );
          draws.push({
            sequence: draw.sequence,
            catalogEntryId: draw.entry.id,
            furnitureInstanceId: created.id.toString(),
            instanceCode: created.code,
            display: draw.entry.display,
            grade: draw.gradeName
          });
        }
        const resultDigest = createHash("sha256").update(JSON.stringify(draws)).digest("hex");
        await transaction.execute("UPDATE home_furniture_draw_operations SET result_digest=? WHERE operation_id=?", [resultDigest, operationId]);
        const reply = formatHomeFurnitureDrawReply(nickname, ticketBefore, ticketAfter, bagCountBefore, bagCountAfter, bagCapacity, draws);
        const rare = draws.filter((draw) => draw.grade !== "리브");
        const notices = rare.length === 0 ? [] : [
          `🎉[${nickname}]님, 특별 등급 가구 획득!\n${rare.map((draw) => `${draw.display} [${draw.instanceCode}]`).join("\n")}`
        ];
        return complete(transaction, {
          operationId,
          eventId: input.eventId,
          destinationId: input.destinationId,
          identityId: owner.identity_id,
          playerId: owner.player_id,
          resultCode: "drawn",
          reply,
          notices,
          result: {
            status: "drawn",
            requestedQuantity: command.quantity.toString(),
            ticketBefore: ticketBefore.toString(),
            ticketAfter: ticketAfter.toString(),
            bagCountBefore: bagCountBefore.toString(),
            bagCountAfter: bagCountAfter.toString(),
            bagCapacity: bagCapacity.toString(),
            catalogVersion: catalog.version_code,
            seedHash,
            draws
          },
          summary: {
            mutation: true,
            requestedQuantity: command.quantity.toString(),
            ticketItemId: ticketItem.id.toString(),
            ticketBefore: ticketBefore.toString(),
            ticketAfter: ticketAfter.toString(),
            bagCountBefore: bagCountBefore.toString(),
            bagCountAfter: bagCountAfter.toString(),
            bagCapacity: bagCapacity.toString(),
            catalogVersion: catalog.version_code,
            catalogSourceSha256: catalog.source_sha256,
            seedHash,
            resultDigest,
            rareCount: rare.length
          }
        });
      });
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      const prior = await this.database.query<Array<{ result_json: string | HomeFurnitureDrawResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.furniture_draw' AND idempotency_key=?",
        [key]
      );
      if (prior[0]?.result_json === undefined || prior[0].result_json === null) throw error;
      return stored(prior[0].result_json);
    }
  }
}