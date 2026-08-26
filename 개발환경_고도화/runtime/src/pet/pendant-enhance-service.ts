import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

const STONE_CODE = "ITEM-PENDANT-ENHANCE-STONE";
const BONUS_SKILL_NAME = "결혼못한 대장장이";
const TABLE = [
  null,
  [100, 5000n, 0.1, 1000000000n, 1n], [100, 10000n, 0.2, 1000000000n, 2n],
  [100, 15000n, 0.3, 1000000000n, 3n], [100, 20000n, 0.4, 1000000000n, 4n],
  [100, 25000n, 0.5, 1000000000n, 5n], [100, 30000n, 0.6, 1000000000n, 6n],
  [33, 250000n, 0.7, 3000000000n, 7n], [33, 375000n, 0.8, 3000000000n, 8n],
  [33, 500000n, 0.9, 3000000000n, 9n], [33, 750000n, 1.0, 3000000000n, 10n],
  [10, 1000000n, 1.1, 10000000000n, 11n], [10, 1250000n, 1.2, 10000000000n, 12n],
  [10, 1500000n, 1.3, 10000000000n, 13n], [10, 2000000n, 1.4, 10000000000n, 14n],
  [5, 2500000n, 1.5, 15000000000n, 15n], [5, 3000000n, 1.6, 15000000000n, 16n],
  [5, 3500000n, 1.7, 15000000000n, 17n], [5, 4000000n, 1.8, 15000000000n, 18n],
  [5, 4500000n, 1.9, 15000000000n, 19n], [5, 5000000n, 2.0, 15000000000n, 20n],
  [3, 6000000n, 2.1, 20000000000n, 21n], [3, 7000000n, 2.2, 20000000000n, 22n],
  [3, 8000000n, 2.3, 20000000000n, 23n], [2, 9000000n, 2.4, 30000000000n, 24n],
  [2, 10000000n, 2.5, 30000000000n, 25n], [1, 12500000n, 2.6, 100000000000n, 26n],
  [1, 15000000n, 2.7, 100000000000n, 27n], [1, 17500000n, 2.8, 100000000000n, 28n],
  [1, 25000000n, 2.9, 100000000000n, 29n], [1, 30000000n, 3.0, 100000000000n, 30n]
] as const;

interface Actor { identity_id: bigint; player_id: bigint; pet_id: bigint; rank_display: string; }
interface PendantRow {
  instance_id: bigint; item_id: bigint; version: bigint; status: string; item_name: string;
  name_value: string | null; icon_value: string | null; grade_value: string | null;
  durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null;
  charm_value: string | null; explore_value: string | null;
}
interface Target {
  row: PendantRow; entry: PendantBagEntry; baseCharm: bigint; baseExplore: number;
}
interface Confirmation {
  id: bigint; inventory_instance_id: bigint; target_version: bigint; next_level: number;
  point_cost: string; stone_cost: bigint; base_rate: string; bonus_rate: string; source_index: number;
}
export interface PendantEnhanceResult {
  status: "preview" | "success" | "failure" | "cancelled" | "usage" | "silent";
  data?: string; outboxId?: string; instanceId?: string; level?: number;
  durability?: string; pointSpent?: string; stoneSpent?: string;
}

// 레거시 outer guard와 확인·취소 평문을 동일 handler 후보로 제한합니다.
export function isPendantEnhanceCommandCandidate(message: string | undefined): boolean {
  return message === "/펜던트강화"
    || (message !== undefined && /^\/펜던트강화\s+.+$/.test(message))
    || message === "진행시켜"
    || message === "쫄았음";
}

// 인자 명령만 registry 대표 별칭으로 정규화하고 확인·취소 별칭은 보존합니다.
export function normalizePendantEnhanceDispatchMessage(message: string): string {
  return message === "진행시켜" || message === "쫄았음"
    ? message
    : isPendantEnhanceCommandCandidate(message) ? "/펜던트강화" : message;
}

// 완전한 숫자 인자만 허용하고 장착 펜던트 0을 보존합니다.
export function parsePendantEnhanceIndex(message: string): bigint | null {
  const match = /^\/펜던트강화\s+(\d+)$/.exec(message);
  return match === null ? null : BigInt(match[1]!);
}

// 긴 provider event ID를 operations 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 정수를 세 자리 쉼표 형식으로 표시합니다.
function comma(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 확률과 탐험 수치를 레거시 표시 자릿수로 정리합니다.
function percent(value: number): string {
  return value.toFixed(Math.abs(value) < 1 ? 2 : 1).replace(/\.?0+$/, "");
}

// DB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function stored(value: string | PendantEnhanceResult): PendantEnhanceResult {
  return typeof value === "string" ? JSON.parse(value) as PendantEnhanceResult : value;
}

// 펜던트 기본·누적 강화 능력치를 계산합니다.
function stats(target: Target, level: number): { charm: bigint; explore: number } {
  let charm = target.baseCharm;
  for (let index = 1; index <= level; index++) charm += TABLE[index]![1];
  return { charm, explore: target.baseExplore + (level === 0 ? 0 : TABLE[level]![2]) };
}

// 펜던트 레거시 표시 문자열을 stable instance 속성에서 생성합니다.
function display(target: Target, level = Number(target.entry.upgrade)): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${target.entry.durability}/${target.entry.maxDurability}][+${level}]`;
}

// operation·outbox·execution·audit 공통 완료 기록을 저장합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; actor: Actor; action: string;
  resultCode: string; data: string; result: PendantEnhanceResult; summary: Record<string, unknown>;
}): Promise<PendantEnhanceResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_ENHANCE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'inventory_instance',?, ?,?,'Iris 펜던트 강화',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.actor.identity_id, input.result.instanceId ?? null, input.action, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute(
    "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
    [JSON.stringify(result), input.operationId]
  );
  return result;
}

// 펜던트 강화 미리보기·확인·취소를 persistent confirmation으로 처리합니다.
export class PendantEnhanceService {
  constructor(private readonly database: DatabaseClient, private readonly random: () => number = Math.random) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantEnhanceResult> {
    if (!isPendantEnhanceCommandCandidate(input.message)) return { status: "silent" };
    const actors = await this.database.query<Actor[]>(
      `SELECT identity.id identity_id,profile.player_id,pet.id pet_id,
              CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display
         FROM external_identities identity
         JOIN players player ON player.id=identity.player_id AND player.status='active'
         JOIN player_profiles profile ON profile.player_id=player.id
         JOIN player_pets pet ON pet.player_id=player.id
         LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        LIMIT 1`,
      [input.externalUserId]
    );
    const actor = actors[0];
    if (actor === undefined) return { status: "silent" };
    if (input.message === "진행시켜") return this.confirm(actor, input);
    if (input.message === "쫄았음") return this.cancel(actor, input);
    return this.preview(actor, input);
  }

  // 펜던트 번호를 stable instance로 고정하고 30초 미리보기를 저장합니다.
  private async preview(actor: Actor, input: { eventId: string; destinationId: string; message: string }): Promise<PendantEnhanceResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantEnhanceResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.enhance.preview' AND idempotency_key=? FOR UPDATE", [key]
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.enhance.preview',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      );
      const index = parsePendantEnhanceIndex(input.message);
      if (index === null) {
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
          action: "pendant.enhance.preview", resultCode: "usage",
          data: "예) /펜던트강화 [펜던트가방번호]\n혹은 장착 펜던트는 숫자 0을 입력해주세요.",
          result: { status: "usage" }, summary: { mutation: false }
        });
      }
      const target = await this.resolveTarget(transaction, actor.player_id, index);
      if (target === undefined) {
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
          action: "pendant.enhance.preview", resultCode: "not_found",
          data: "해당 번호의 펜던트가 존재하지 않습니다.\n━━━━━━━━━━━━━\n예) /펜던트강화 [펜던트가방번호]\n혹은 장착 펜던트는 숫자 0을 입력해주세요.",
          result: { status: "usage" }, summary: { sourceIndex: index.toString(), mutation: false }
        });
      }
      const level = Number(target.entry.upgrade);
      const durability = target.entry.durability;
      if (level >= 30 || durability <= 0n) {
        const data = level >= 30
          ? "이미 펜던트 최대 강화 단계에 도달했습니다.\n━━━━━━━━━━━━━\n현재 강화수치: +30\n최대 강화수치: +30"
          : `[${actor.rank_display}] 님\n해당 펜던트는 내구도가 0이라 강화할 수 없습니다.\n━━━━━━━━━━━━━\n/펜던트복원 [번호] 명령어로 복원 후 다시 시도해주세요.`;
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
          action: "pendant.enhance.preview", resultCode: level >= 30 ? "max_level" : "zero_durability", data,
          result: { status: "usage", instanceId: target.entry.instanceId, level, durability: durability.toString() },
          summary: { sourceIndex: index.toString(), mutation: false }
        });
      }
      const next = level + 1;
      const spec = TABLE[next]!;
      const resources = await this.lockResources(transaction, actor.player_id);
      if (resources.point < spec[3] || resources.stoneQuantity < spec[4]) {
        const data = resources.point < spec[3]
          ? `[${actor.rank_display}] 님\n포인트가 부족하여 펜던트 강화를 진행할 수 없습니다.\n━━━━━━━━━━━━━\n필요 포인트💸: 🅟${comma(spec[3])}\n보유 포인트💸: 🅟${comma(resources.point)}`
          : `[${actor.rank_display}] 님\n펜던트 강화석📿이 부족합니다.\n━━━━━━━━━━━━━\n필요 강화석📿: ${spec[4]}개\n보유 강화석📿: ${resources.stoneQuantity}개`;
        return complete(transaction, {
          operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
          action: "pendant.enhance.preview", resultCode: resources.point < spec[3] ? "point_shortage" : "stone_shortage", data,
          result: { status: "usage", instanceId: target.entry.instanceId, level, durability: durability.toString() },
          summary: { sourceIndex: index.toString(), mutation: false }
        });
      }
      const bonus = await this.readBonus(transaction, actor.pet_id);
      await transaction.execute(
        "UPDATE pendant_upgrade_confirmations SET cancelled_at=UTC_TIMESTAMP(3) WHERE player_id=? AND consumed_at IS NULL AND cancelled_at IS NULL",
        [actor.player_id]
      );
      await transaction.execute(
        `INSERT INTO pendant_upgrade_confirmations
          (player_id,external_identity_id,inventory_instance_id,source_index,target_version,next_level,point_cost,stone_cost,base_rate,bonus_rate,source_event_id,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 SECOND))`,
        [actor.player_id, actor.identity_id, target.row.instance_id, index, target.row.version, next, `${spec[3]}.000`, spec[4], spec[0], bonus, input.eventId]
      );
      const before = stats(target, level);
      const after = stats(target, next);
      const rateLine = bonus > 0
        ? `강화성공 확률🎲: ${percent(spec[0])}%+${percent(bonus)}% = ${percent(Math.min(100, spec[0] + bonus))}%\n결혼못한 대장장이📙 ${percent(bonus)}% 적용`
        : `강화성공 확률🎲: ${percent(spec[0])}%`;
      const data = `[${actor.rank_display}] 펜던트 강화 시도💎\n━━━━━━━━━━━━━\n${display(target)}\n\n강화 성공시:\n종합매력👑: ${comma(before.charm)}+${comma(after.charm - before.charm)}(⬆️)=${comma(after.charm)}💞\n펫탐험성공확률⛰️:${percent(before.explore)}%+${percent(after.explore - before.explore)}%(⬆️)=${percent(after.explore)}%\n\n강화비용💸: 🅟${comma(spec[3])}\n필요 강화석📿: ${spec[4]}개\n${rateLine}\n남은 내구도⚒️: ${durability}회\n━━━━━━━━━━━━━\n펜던트 강화할거임?\n[진행시켜] / [쫄았음]`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        action: "pendant.enhance.preview", resultCode: "preview", data,
        result: { status: "preview", instanceId: target.entry.instanceId, level, durability: durability.toString(), pointSpent: "0", stoneSpent: "0" },
        summary: { sourceIndex: index.toString(), nextLevel: next, targetVersion: target.row.version.toString(), expiresInSeconds: 30 }
      });
    });
  }

  // 확인 상태의 대상·비용을 다시 잠그고 성공/실패 결과를 원자 반영합니다.
  private async confirm(actor: Actor, input: { eventId: string; destinationId: string }): Promise<PendantEnhanceResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantEnhanceResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.enhance.confirm' AND idempotency_key=? FOR UPDATE", [key]
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const confirmations = await transaction.query<Confirmation[]>(
        `SELECT id,inventory_instance_id,target_version,next_level,CAST(point_cost AS CHAR) point_cost,stone_cost,
                CAST(base_rate AS CHAR) base_rate,CAST(bonus_rate AS CHAR) bonus_rate,source_index
           FROM pendant_upgrade_confirmations
          WHERE player_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>=UTC_TIMESTAMP(3)
          ORDER BY id DESC LIMIT 1 FOR UPDATE`, [actor.player_id]
      );
      const confirmation = confirmations[0];
      if (confirmation === undefined) return { status: "silent" };
      const targets = await transaction.query<PendantRow[]>(
        `SELECT instance.id instance_id,instance.item_id,instance.version,instance.status,item.display_name item_name,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.charm')) charm_value,
                JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.explore')) explore_value
           FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id
          WHERE instance.id=? AND instance.player_id=? AND instance.status IN ('owned','equipped') FOR UPDATE`,
        [confirmation.inventory_instance_id, actor.player_id]
      );
      const target = targets[0] === undefined ? undefined : this.toTarget(targets[0]);
      if (target === undefined || target.row.version !== confirmation.target_version
        || Number(target.entry.upgrade) + 1 !== confirmation.next_level || target.entry.durability <= 0n) {
        throw new ApplicationError("PENDANT_ENHANCE_CONFLICT", "펜던트 정보가 먼저 변경되었습니다.", 409);
      }
      const resources = await this.lockResources(transaction, actor.player_id);
      const pointCost = BigInt(confirmation.point_cost.split(".")[0] ?? "0");
      if (resources.point < pointCost) throw new ApplicationError("POINT_REQUIRED", "포인트가 부족합니다.", 409);
      if (resources.stoneQuantity < confirmation.stone_cost) throw new ApplicationError("PENDANT_STONE_REQUIRED", "펜던트 강화석📿이 부족합니다.", 409);
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.enhance.confirm',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      );
      const pointAfter = resources.point - pointCost;
      const stoneAfter = resources.stoneQuantity - confirmation.stone_cost;
      const currencyUpdate = await transaction.execute(
        "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
        [`${pointAfter}.000`, actor.player_id, resources.pointVersion]
      );
      const stoneUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [stoneAfter, actor.player_id, resources.stoneItemId, resources.stoneVersion]
      );
      if (currencyUpdate.affectedRows !== 1n || stoneUpdate.affectedRows !== 1n) {
        throw new ApplicationError("PENDANT_ENHANCE_RESOURCE_CONFLICT", "강화 재화가 먼저 변경되었습니다.", 409);
      }
      const rate = Math.min(100, Number(confirmation.base_rate) + Number(confirmation.bonus_rate));
      const success = this.random() * 100 < rate;
      const level = success ? confirmation.next_level : Number(target.entry.upgrade);
      const durability = success ? target.entry.durability : target.entry.durability - 1n;
      const instanceUpdate = await transaction.execute(
        `UPDATE inventory_instances
            SET attributes_json=JSON_SET(COALESCE(attributes_json,JSON_OBJECT()),'$.upgrade',?,'$.durability',?),
                version=version+1
          WHERE id=? AND player_id=? AND version=?`,
        [level, durability, target.row.instance_id, actor.player_id, target.row.version]
      );
      if (instanceUpdate.affectedRows !== 1n) throw new ApplicationError("PENDANT_ENHANCE_CONFLICT", "펜던트 정보가 먼저 변경되었습니다.", 409);
      const afterStats = stats(target, level);
      if (target.row.status === "equipped") {
        await transaction.execute(
          `UPDATE player_pet_pendants
              SET enhancement_level=?,durability=?,raid_charm=?,castle_charm=?,version=version+1
            WHERE player_pet_id=? AND inventory_instance_id=?`,
          [level, durability, afterStats.charm / 2n, afterStats.charm - afterStats.charm / 2n, actor.pet_id, target.row.instance_id]
        );
      }
      await transaction.execute(
        "INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'PENDANT_ENHANCE')",
        [operation.insertId, actor.player_id, `-${pointCost}.000`, `${pointAfter}.000`]
      );
      await transaction.execute(
        "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PENDANT_ENHANCE')",
        [operation.insertId, actor.player_id, resources.stoneItemId, -confirmation.stone_cost]
      );
      await transaction.execute(
        "UPDATE pendant_upgrade_confirmations SET consumed_at=UTC_TIMESTAMP(3),consumed_event_id=? WHERE id=?",
        [input.eventId, confirmation.id]
      );
      const data = success
        ? `[✅][${actor.rank_display}] 님! 영롱하군요🤩🤩\n\n펜던트 강화 성공!\n━━━━━━━━━━━━━\n${display(target, level)}\n종합매력👑: ${comma(afterStats.charm)}💞\n펫탐험성공확률⛰️:${percent(afterStats.explore)}%\n━━━━━━━━━━━━━\n남은 포인트💸: 🅟${comma(pointAfter)}\n남은 내구도⚒️: ${durability}회`
        : `[❌][${actor.rank_display}] 야야 [😵]실패네? ㅋㅋ\n━━━━━━━━━━━━━\n${display({ ...target, entry: { ...target.entry, durability } }, level)}\n\n남은 포인트💸: 🅟${comma(pointAfter)}\n남은 내구도⚒️: ${durability}회${durability <= 0n ? "\n*복원석으로 수리해보세요." : ""}`;
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        action: "pendant.enhance.confirm", resultCode: success ? "success" : "failure", data,
        result: { status: success ? "success" : "failure", instanceId: target.entry.instanceId, level,
          durability: durability.toString(), pointSpent: pointCost.toString(), stoneSpent: confirmation.stone_cost.toString() },
        summary: { confirmationId: confirmation.id.toString(), rate, success, pointAfter: pointAfter.toString(), stoneAfter: stoneAfter.toString() }
      });
    });
  }

  // 활성 확인 상태가 있을 때만 취소 응답을 기록합니다.
  private async cancel(actor: Actor, input: { eventId: string; destinationId: string }): Promise<PendantEnhanceResult> {
    return this.database.withTransaction(async (transaction) => {
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantEnhanceResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='pendant.enhance.cancel' AND idempotency_key=? FOR UPDATE", [key]
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const confirmations = await transaction.query<Array<{ id: bigint; inventory_instance_id: bigint }>>(
        "SELECT id,inventory_instance_id FROM pendant_upgrade_confirmations WHERE player_id=? AND consumed_at IS NULL AND cancelled_at IS NULL AND expires_at>=UTC_TIMESTAMP(3) ORDER BY id DESC LIMIT 1 FOR UPDATE",
        [actor.player_id]
      );
      const confirmation = confirmations[0];
      if (confirmation === undefined) return { status: "silent" };
      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.enhance.cancel',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), key, actor.identity_id]
      );
      await transaction.execute(
        "UPDATE pendant_upgrade_confirmations SET cancelled_at=UTC_TIMESTAMP(3),cancelled_event_id=? WHERE id=?",
        [input.eventId, confirmation.id]
      );
      return complete(transaction, {
        operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor,
        action: "pendant.enhance.cancel", resultCode: "cancelled", data: "펜던트 강화를 취소했습니다.",
        result: { status: "cancelled", instanceId: confirmation.inventory_instance_id.toString(), pointSpent: "0", stoneSpent: "0" },
        summary: { confirmationId: confirmation.id.toString(), mutation: false }
      });
    });
  }

  // stable instance 정렬에서 장착 0 또는 가방 번호 대상을 선택합니다.
  private async resolveTarget(transaction: DatabaseTransaction, playerId: bigint, index: bigint): Promise<Target | undefined> {
    const rows = await transaction.query<PendantRow[]>(
      `SELECT instance.id instance_id,instance.item_id,instance.version,instance.status,item.display_name item_name,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.charm')) charm_value,
              JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.explore')) explore_value
         FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
        WHERE instance.player_id=? AND instance.status IN ('owned','equipped')
          AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant'
        FOR UPDATE`, [playerId]
    );
    const targets = rows.map((row) => this.toTarget(row));
    if (index === 0n) return targets.filter((target) => target.row.status === "equipped").sort((a, b) => a.row.instance_id < b.row.instance_id ? -1 : 1)[0];
    const owned = sortPendantBagEntries(targets.filter((target) => target.row.status === "owned").map((target) => target.entry));
    const selected = index > BigInt(owned.length) ? undefined : owned[Number(index - 1n)];
    return selected === undefined ? undefined : targets.find((target) => target.entry.instanceId === selected.instanceId);
  }

  // SQL 행을 펜던트 표시·계산 대상으로 변환합니다.
  private toTarget(row: PendantRow): Target {
    return {
      row,
      entry: {
        instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name, icon: row.icon_value ?? "",
        grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"),
        maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0")
      },
      baseCharm: BigInt(row.charm_value ?? "0"),
      baseExplore: Number(row.explore_value ?? "0")
    };
  }

  // 포인트 계정과 펜던트 강화석 stack을 잠가 현재 수량을 반환합니다.
  private async lockResources(transaction: DatabaseTransaction, playerId: bigint): Promise<{
    point: bigint; pointVersion: bigint; stoneItemId: bigint; stoneQuantity: bigint; stoneVersion: bigint;
  }> {
    const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
      "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [playerId]
    );
    const stones = await transaction.query<Array<{ item_id: bigint; quantity: bigint | null; version: bigint | null }>>(
      `SELECT item.id item_id,stack.quantity,stack.version
         FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
        WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`,
      [playerId, STONE_CODE]
    );
    const stone = stones[0];
    if (stone === undefined) throw new ApplicationError("PENDANT_STONE_CATALOG_REQUIRED", "펜던트 강화석 설정을 찾을 수 없습니다.", 409);
    const account = accounts[0];
    return {
      point: BigInt(account?.balance.split(".")[0] ?? "0"), pointVersion: account?.version ?? 0n,
      stoneItemId: stone.item_id, stoneQuantity: stone.quantity ?? 0n, stoneVersion: stone.version ?? 0n
    };
  }

  // 장착된 결혼못한 대장장이 스킬의 1% 보너스를 확인합니다.
  private async readBonus(transaction: DatabaseTransaction, petId: bigint): Promise<number> {
    const rows = await transaction.query<Array<{ equipped: number }>>(
      `SELECT 1 equipped FROM pet_skills equipped_skill
         JOIN skill_definitions skill ON skill.id=equipped_skill.skill_id AND skill.active=TRUE
        WHERE equipped_skill.player_pet_id=? AND equipped_skill.equipped=TRUE AND skill.display_name=?
        LIMIT 1`, [petId, BONUS_SKILL_NAME]
    );
    return rows[0] === undefined ? 0 : 1;
  }
}
