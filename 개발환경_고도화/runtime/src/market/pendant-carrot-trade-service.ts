import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "../pet/pendant-bag-service.js";

const CARROT_FEE = 100n;
const BAG_LIMIT = 50n;
interface PlayerRow { identity_id?: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; rank_emoji: string | null; }
interface PendantRow { instance_id: bigint; item_id: bigint; version: bigint; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null; }
interface Target { row: PendantRow; entry: PendantBagEntry; }
export interface PendantCarrotTradeResult { status: "traded" | "rejected" | "usage" | "silent"; data?: string; outboxId?: string; instanceId?: string; targetPlayerId?: string; }

// 레거시 두 alias의 exact·인자 포함 outer guard를 보존합니다.
export function isPendantCarrotTradeCommandCandidate(message: string | undefined): boolean {
  return message !== undefined && (message === "/펜던트당근" || message === "/펜던트당근거래" || /^\/펜던트당근(?:거래)?\s+.+$/.test(message));
}

// 거래대상 표시명과 마지막 숫자 가방 순번을 해석합니다.
export function parsePendantCarrotTradeCommand(message: string): { targetName: string; index: bigint } | undefined {
  const match = /^\/펜던트당근(?:거래)?\s+(.+)\s+(\d+)$/.exec(message);
  if (match === null || match[1]!.trim() === "") return undefined;
  return { targetName: match[1]!.trim(), index: BigInt(match[2]!) };
}

// 두 alias를 DB 대표 명령으로 정규화합니다.
export function normalizePendantCarrotTradeDispatchMessage(message: string): string {
  return isPendantCarrotTradeCommandCandidate(message) ? "/펜던트당근" : message;
}

// 긴 event ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// 레거시 펜던트 표시 문자열을 생성합니다.
function display(target: Target): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${target.entry.durability}/${target.entry.maxDurability}](+${target.entry.upgrade})`;
}

// 응답·execution·감사·operation을 현재 transaction에서 완료합니다.
async function complete(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; identityId: bigint; targetId: bigint | null; resultCode: string; actionCode: string; data: string; result: PendantCarrotTradeResult; summary: Record<string, unknown>; }): Promise<PendantCarrotTradeResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_CARROT_TRADE',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /펜던트당근',?,UTC_TIMESTAMP(3))", [input.operationId, input.identityId, input.targetId, input.actionCode, input.resultCode, JSON.stringify(input.summary)]);
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 킹 이상 회원 간 펜던트 소유권과 당근 수수료를 원자 이전합니다.
export class PendantCarrotTradeService {
  constructor(private readonly database: DatabaseClient) {}
  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantCarrotTradeResult> {
    if (!isPendantCarrotTradeCommandCandidate(input.message)) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const owners = await transaction.query<PlayerRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name,profile.tier_code,rank_profile.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const owner = owners[0];
      if (owner?.identity_id === undefined) return { status: "silent" };
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantCarrotTradeResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='pendant.carrot.trade' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.carrot.trade',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, owner.identity_id]);
      const command = parsePendantCarrotTradeCommand(input.message);
      if (command === undefined) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: null, resultCode: "usage", actionCode: "pendant.carrot.trade.reject", data: "예) /펜던트당근 [거래대상닉네임] [펜던트가방번호]", result: { status: "usage" }, summary: { mutation: false } });
      const targets = await transaction.query<PlayerRow[]>(`SELECT player.id player_id,profile.current_display_name,profile.tier_code,rank_profile.rank_emoji
        FROM player_profiles profile JOIN players player ON player.id=profile.player_id AND player.status='active'
        JOIN player_pets pet ON pet.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE profile.current_display_name=? LIMIT 1 FOR UPDATE`, [command.targetName]);
      const recipient = targets[0];
      if (recipient === undefined) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: null, resultCode: "target_not_found", actionCode: "pendant.carrot.trade.reject", data: "거래 대상 유저를 찾을 수 없습니다.", result: { status: "rejected" }, summary: { targetName: command.targetName, mutation: false } });
      if (!(await this.eligible(transaction, owner.tier_code))) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "sender_tier_required", actionCode: "pendant.carrot.trade.reject", data: `❌[${owner.rank_emoji ?? ""}${owner.current_display_name}]님 펜던트 거래는 티어 👑킹 이상부터 가능합니다.`, result: { status: "rejected" }, summary: { mutation: false, tierCode: owner.tier_code } });
      if (!(await this.eligible(transaction, recipient.tier_code))) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "target_tier_required", actionCode: "pendant.carrot.trade.reject", data: `❌[${recipient.rank_emoji ?? ""}${recipient.current_display_name}]님은 티어 👑킹 미만이라 당근 거래 물품을 받을 수 없습니다.`, result: { status: "rejected" }, summary: { mutation: false, targetTierCode: recipient.tier_code } });
      const carrots = await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(`SELECT stack.item_id,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id
        WHERE stack.player_id=? AND (item.code='ITEM-RWD-044' OR item.display_name='🥕당근이세요?' OR item.display_name='당근') ORDER BY CASE WHEN item.code='ITEM-RWD-044' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`, [owner.player_id]);
      const carrot = carrots[0];
      if (carrot === undefined || carrot.quantity < CARROT_FEE) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "insufficient_carrot", actionCode: "pendant.carrot.trade.reject", data: "펜던트 거래 수수료 당근🥕 100개가 부족합니다.", result: { status: "rejected" }, summary: { mutation: false, requiredCarrot: "100" } });
      const recipientCount = await transaction.query<Array<{ count_value: bigint }>>(`SELECT COUNT(*) count_value FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id
        WHERE instance.player_id=? AND instance.status='owned' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`, [recipient.player_id]);
      if ((recipientCount[0]?.count_value ?? 0n) >= BAG_LIMIT) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "target_bag_full", actionCode: "pendant.carrot.trade.reject", data: "상대 펜던트가방 공간이 부족합니다.", result: { status: "rejected" }, summary: { mutation: false, targetBagCount: (recipientCount[0]?.count_value ?? 0n).toString() } });
      const pendant = await this.resolveTarget(transaction, owner.player_id, command.index);
      if (pendant === undefined) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "pendant_not_found", actionCode: "pendant.carrot.trade.reject", data: "해당 번호의 펜던트가 존재하지 않습니다.", result: { status: "rejected" }, summary: { mutation: false, sourceIndex: command.index.toString() } });
      const transfer = await transaction.execute("UPDATE inventory_instances SET player_id=?,version=version+1 WHERE id=? AND player_id=? AND status='owned' AND version=?", [recipient.player_id, pendant.row.instance_id, owner.player_id, pendant.row.version]);
      const fee = await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [CARROT_FEE, owner.player_id, carrot.item_id, carrot.version]);
      if (transfer.affectedRows !== 1n || fee.affectedRows !== 1n) throw new Error("PENDANT_CARROT_TRADE_CONFLICT");
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PENDANT_CARROT_TRADE_FEE')", [operation.insertId, owner.player_id, carrot.item_id, -CARROT_FEE]);
      await transaction.execute("INSERT INTO pendant_carrot_trades(operation_id,sender_player_id,recipient_player_id,inventory_instance_id,source_index,carrot_item_id,carrot_fee,instance_version_before,instance_version_after) VALUES (?,?,?,?,?,?,?,?,?)", [operation.insertId, owner.player_id, recipient.player_id, pendant.row.instance_id, command.index, carrot.item_id, CARROT_FEE, pendant.row.version, pendant.row.version + 1n]);
      const data = `펜던트 당근거래 완료\n━━━━━━━━━━━━━\n보낸 유저: ${owner.current_display_name}\n받은 유저: ${recipient.current_display_name}\n${display(pendant)}\n수수료: 당근🥕 100개`;
      return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, targetId: recipient.player_id, resultCode: "traded", actionCode: "pendant.carrot.trade", data, result: { status: "traded", instanceId: pendant.row.instance_id.toString(), targetPlayerId: recipient.player_id.toString() }, summary: { sourceIndex: command.index.toString(), instanceId: pendant.row.instance_id.toString(), carrotFee: "100" } });
    });
  }

  // 킹 이상 거래 가능 tier 정책을 확인합니다.
  private async eligible(transaction: DatabaseTransaction, tierCode: string | null): Promise<boolean> {
    const rows = await transaction.query<Array<{ allowed: bigint }>>("SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND can_register=TRUE", [tierCode]);
    return (rows[0]?.allowed ?? 0n) > 0n;
  }

  // 레거시 등급·이름 순번을 stable instance로 확정해 잠급니다.
  private async resolveTarget(transaction: DatabaseTransaction, playerId: bigint, index: bigint): Promise<Target | undefined> {
    const rows = await transaction.query<PendantRow[]>(`SELECT instance.id instance_id,instance.item_id,instance.version,item.display_name item_name,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
      FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE WHERE instance.player_id=? AND instance.status='owned'
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`, [playerId]);
    const targets = rows.map((row) => ({ row, entry: { instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name, icon: row.icon_value ?? "", grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"), maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0") } }));
    const selected = index > BigInt(targets.length) ? undefined : sortPendantBagEntries(targets.map((value) => value.entry))[Number(index - 1n)];
    return selected === undefined ? undefined : targets.find((value) => value.entry.instanceId === selected.instanceId);
  }
}
