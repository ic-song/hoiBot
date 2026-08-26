import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const TICKET_CODE = "ITEM-PENDANT-DRAW-TICKET";
const ALL_SEE = "\u200b".repeat(500);

interface Actor { identity_id: bigint; player_id: bigint; pet_id: bigint | null; rank_display: string; }
interface DrawDefinition {
  item_id: bigint; item_code: string; display_name: string; name_value: string; icon_value: string;
  grade_value: string; charm_value: string; explore_value: string; rate_value: string;
  draw_order: string; grade_order: string; notice_value: string;
}
interface DrawnPendant extends DrawDefinition { instanceId: bigint; sample: number; }
export interface PendantDrawReply { outboxId: string; room: string; data: string; }
export interface PendantDrawOpenResult {
  status: "success" | "usage" | "no_pet" | "ticket_shortage" | "bag_full" | "silent";
  data?: string; outboxId?: string; openCount?: number; instanceIds?: string[]; replies?: PendantDrawReply[];
}

// 레거시 exact·완전 숫자 인자 guard만 허용합니다.
export function isPendantDrawOpenCommandCandidate(message: string | undefined): boolean {
  return message === "/펜던트오픈" || (message !== undefined && /^\/펜던트오픈\s+\d+$/.test(message));
}

// 숫자 인자 명령을 registry 대표 별칭으로 정규화합니다.
export function normalizePendantDrawOpenDispatchMessage(message: string): string {
  return isPendantDrawOpenCommandCandidate(message) ? "/펜던트오픈" : message;
}

// 생략 시 1개, 0은 사용법 응답 경계로 해석합니다.
export function parsePendantDrawOpenCount(message: string): bigint | null {
  if (message === "/펜던트오픈") return 1n;
  const match = /^\/펜던트오픈\s+(\d+)$/.exec(message);
  return match === null ? null : BigInt(match[1]!);
}

// 누적 확률 순서로 하나의 DB 정의를 선택합니다.
export function selectPendantDrawDefinition<T extends { rate: number }>(definitions: T[], sample: number): T {
  let cumulative = 0;
  const roll = sample * 100;
  for (const definition of definitions) {
    cumulative += definition.rate;
    if (roll < cumulative) return definition;
  }
  return definitions[definitions.length - 1]!;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | PendantDrawOpenResult): PendantDrawOpenResult {
  return typeof value === "string" ? JSON.parse(value) as PendantDrawOpenResult : value;
}

function display(draw: DrawnPendant): string {
  const icon = draw.icon_value !== "" && draw.name_value.endsWith(draw.icon_value) ? "" : draw.icon_value;
  return `${draw.name_value}${icon}[${draw.grade_value}][⚒️5/5] (확률:${Number(draw.rate_value)}%)`;
}

function resultText(actor: Actor, draws: DrawnPendant[]): string {
  const sorted = draws.slice().sort((a, b) => Number(a.grade_order) - Number(b.grade_order) || Number(a.draw_order) - Number(b.draw_order));
  let data = `[${actor.rank_display}] 님\n펜던트 ${draws.length}개 오픈 결과💎\n━━━━━━━\n`;
  for (let index = 0; index < sorted.length; index++) {
    if (index === 4) data += `${ALL_SEE}\n`;
    data += `${display(sorted[index]!)}\n`;
  }
  return data.replace(/\n$/, "");
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actor: Actor; resultCode: string;
  data: string; result: PendantDrawOpenResult; notices?: string[]; broadcastIds: string[];
  summary: Record<string, unknown>;
}): Promise<PendantDrawOpenResult> {
  const replies: PendantDrawReply[] = [];
  const main = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  replies.push({ outboxId: main.insertId.toString(), room: input.destinationId, data: input.data });
  for (const notice of input.notices ?? []) {
    for (const room of input.broadcastIds) {
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.operationId, room, JSON.stringify({ data: notice })]
      );
      replies.push({ outboxId: outbox.insertId.toString(), room, data: notice });
    }
  }
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_DRAW_OPEN',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pendant.draw.open',?,'Iris /펜던트오픈',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.actor.identity_id, input.actor.player_id, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, data: input.data, outboxId: main.insertId.toString(), replies };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 티켓 차감·펜던트 생성·원장·추첨 증거·공지 outbox를 하나의 트랜잭션으로 처리합니다.
export class PendantDrawOpenService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random, private readonly broadcastIds: string[] = []) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantDrawOpenResult> {
    if (!isPendantDrawOpenCommandCandidate(input.message)) return { status: "silent" };
    const actors = await this.database.query<Actor[]>(
      `SELECT identity.id identity_id,player.id player_id,pet.id pet_id,
              CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active'
         JOIN player_profiles profile ON profile.player_id=player.id
         LEFT JOIN player_pets pet ON pet.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1`,
      [input.externalUserId]
    );
    const actor = actors[0];
    if (actor === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantDrawOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.draw.open' AND idempotency_key=? FOR UPDATE", [key]
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.draw.open',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      );
      const count = parsePendantDrawOpenCount(input.message);
      if (count === null || count === 0n) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        resultCode: "usage", data: "예) /펜던트오픈 [개수]", result: { status: "usage" }, broadcastIds: this.broadcastIds,
        summary: { mutation: false }
      });
      if (actor.pet_id === null) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        resultCode: "no_pet", data: "펫을 먼저 생성해주세요.", result: { status: "no_pet" }, broadcastIds: this.broadcastIds,
        summary: { mutation: false }
      });
      const tickets = await transaction.query<Array<{ item_id: bigint; quantity: bigint | null; version: bigint | null }>>(
        `SELECT item.id item_id,stack.quantity,stack.version FROM item_definitions item
          LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
         WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`, [actor.player_id, TICKET_CODE]
      );
      const ticket = tickets[0];
      if (ticket === undefined) throw new Error("펜던트 뽑기권 DB seed가 필요합니다.");
      const have = ticket.quantity ?? 0n;
      if (have === 0n) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        resultCode: "ticket_shortage", data: "펜던트뽑기💎(/펜던트오픈)이 부족합니다.", result: { status: "ticket_shortage" }, broadcastIds: this.broadcastIds,
        summary: { requested: count.toString(), available: "0", mutation: false }
      });
      const owned = await transaction.query<Array<{ id: bigint }>>(
        `SELECT instance.id FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id
          WHERE instance.player_id=? AND instance.status='owned'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant'
          FOR UPDATE`, [actor.player_id]
      );
      if (owned.length >= 50) return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        resultCode: "bag_full", data: "펜던트 가방이 가득 찼습니다. (50/50)", result: { status: "bag_full" }, broadcastIds: this.broadcastIds,
        summary: { requested: count.toString(), bagCount: owned.length, mutation: false }
      });
      const definitions = await transaction.query<DrawDefinition[]>(
        `SELECT id item_id,code item_code,display_name,
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.name')),display_name) name_value,
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.icon')),'') icon_value,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.grade')) grade_value,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.charm')) charm_value,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.explore')) explore_value,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.rate')) rate_value,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.drawOrder')) draw_order,
                JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.gradeOrder')) grade_order,
                COALESCE(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.notice')),'false') notice_value
           FROM item_definitions WHERE code LIKE 'ITEM-PENDANT-DRAW-%' AND code<>? AND active=TRUE AND stackable=FALSE
          ORDER BY CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json,'$.drawOrder')) AS UNSIGNED)`, [TICKET_CODE]
      );
      if (definitions.length !== 13) throw new Error("펜던트 추첨 DB 정의 13종이 필요합니다.");
      const openCount = count < have ? count : have;
      const ticketAfter = have - openCount;
      const update = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [ticketAfter, actor.player_id, ticket.item_id, ticket.version ?? 0n]
      );
      if (update.affectedRows !== 1n) throw new Error("펜던트 뽑기권이 먼저 변경되었습니다.");
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PENDANT_DRAW_OPEN_TICKET')",
        [operation.insertId, actor.player_id, ticket.item_id, -openCount]
      );
      const draws: DrawnPendant[] = [];
      for (let ordinal = 1n; ordinal <= openCount; ordinal++) {
        const sample = Math.max(0, Math.min(0.9999999999999999999, this.random()));
        const definition = selectPendantDrawDefinition(definitions.map(value => ({ ...value, rate: Number(value.rate_value) })), sample);
        const attributes = { objectType: "pendant", name: definition.name_value, icon: definition.icon_value, grade: definition.grade_value,
          upgrade: 0, durability: 5, maxDurability: 5, bound: false, charm: definition.charm_value, explore: Number(definition.explore_value) };
        const instance = await transaction.execute("INSERT INTO inventory_instances(player_id,item_id,attributes_json) VALUES (?,?,?)", [actor.player_id, definition.item_id, JSON.stringify(attributes)]);
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,1,'PENDANT_DRAW_OPEN_RESULT')",
          [operation.insertId, Number(ordinal + 1n), actor.player_id, definition.item_id, instance.insertId]
        );
        await transaction.execute(
          "INSERT INTO pendant_draw_results(operation_id,draw_ordinal,player_id,item_id,inventory_instance_id,sample_value,rate_value,grade_code,created_at) VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3))",
          [operation.insertId, Number(ordinal), actor.player_id, definition.item_id, instance.insertId, sample.toFixed(19), definition.rate_value, definition.grade_value]
        );
        draws.push({ ...definition, instanceId: instance.insertId, sample });
      }
      const notices = draws.filter(draw => draw.notice_value === "true").map(draw => `🎉 [${actor.rank_display}] 님이 ${display(draw)}를 획득했습니다!`);
      const data = resultText(actor, draws);
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        resultCode: "success", data, notices, broadcastIds: this.broadcastIds,
        result: { status: "success", openCount: Number(openCount), instanceIds: draws.map(draw => draw.instanceId.toString()) },
        summary: { requested: count.toString(), opened: openCount.toString(), ticketBefore: have.toString(), ticketAfter: ticketAfter.toString(), bagBefore: owned.length, bagAfter: owned.length + Number(openCount), noticeCount: notices.length }
      });
    });
  }
}
