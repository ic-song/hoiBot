import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "../pet/pendant-bag-service.js";

const CARROT_FEE = 100n;
const CONFIRM_MINUTES = 5;
const LISTING_DAYS = 30;

interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; rank_emoji: string | null; }
interface PendantRow { instance_id: bigint; item_id: bigint; version: bigint; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null; }
interface Target { row: PendantRow; entry: PendantBagEntry; }
export interface PendantMarketRegisterResult { status: "pending" | "registered" | "rejected" | "silent"; data?: string; outboxId?: string; listingId?: string; instanceId?: string; }

// 펜던트가방 번호와 판매금액이 모두 있는 정확한 등록 형식만 허용합니다.
export function parsePendantMarketRegisterCommand(message: string | undefined): { index: bigint; price: bigint } | undefined {
  if (message === undefined) return undefined;
  const match = /^\/펜던트거래등록\s+(\d+)\s+(\d+)$/.exec(message);
  if (match === null) return undefined;
  const index = BigInt(match[1]!);
  const price = BigInt(match[2]!);
  return index > 0n && price > 0n ? { index, price } : undefined;
}

// broad prefix가 아니라 완전한 실행 형식만 partial dispatch 후보로 사용합니다.
export function isPendantMarketRegisterCommandCandidate(message: string | undefined): boolean {
  return parsePendantMarketRegisterCommand(message) !== undefined;
}

// 인자형 명령을 DB alias 대표 명령으로 정규화합니다.
export function normalizePendantMarketRegisterDispatchMessage(message: string): string {
  return isPendantMarketRegisterCommandCandidate(message) ? "/펜던트거래등록" : message;
}

// 긴 이벤트 ID를 operation 멱등 키 길이에 맞춥니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// 펜던트의 레거시 표시 문자열을 생성합니다.
function display(target: Target): string {
  const icon = target.entry.icon !== "" && target.entry.name.endsWith(target.entry.icon) ? "" : target.entry.icon;
  return `${target.entry.name}${icon}[${target.entry.grade}][⚒️${target.entry.durability}/${target.entry.maxDurability}](+${target.entry.upgrade})`;
}

// bigint 금액을 천 단위 구분 형식으로 표시합니다.
function commas(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 결과 응답·execution·감사·operation을 현재 transaction에서 완료합니다.
async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint; eventId: string; destinationId: string; identityId: bigint; playerId: bigint;
  resultCode: string; actionCode: string; data: string; result: PendantMarketRegisterResult; summary: Record<string, unknown>;
}): Promise<PendantMarketRegisterResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_MARKET_REGISTER',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, input.operationId, input.resultCode]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,?,?,'Iris /펜던트거래등록',?,UTC_TIMESTAMP(3))", [input.operationId, input.identityId, input.playerId, input.actionCode, input.resultCode, JSON.stringify(input.summary)]);
  const result = { ...input.result, data: input.data, outboxId: outbox.insertId.toString() };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 두 번의 동일 입력 확인 뒤 펜던트·당근·매물을 하나의 MariaDB transaction으로 반영합니다.
export class PendantMarketRegisterService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantMarketRegisterResult> {
    const command = parsePendantMarketRegisterCommand(input.message);
    if (command === undefined) return { status: "silent" };
    return this.database.withTransaction(async (transaction) => {
      const owners = await transaction.query<OwnerRow[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name,profile.tier_code,rank_profile.rank_emoji
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const owner = owners[0];
      if (owner === undefined) return { status: "silent" };
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantMarketRegisterResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='market.pendant.register' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) : prior[0].result_json;
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'market.pendant.register',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, owner.identity_id]);
      const eligible = await transaction.query<Array<{ allowed: bigint }>>("SELECT COUNT(*) allowed FROM market_registration_tier_policies WHERE tier_code=? AND can_register=TRUE", [owner.tier_code]);
      if ((eligible[0]?.allowed ?? 0n) === 0n) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
        resultCode: "tier_required", actionCode: "market.pendant.register.reject", data: `❌ [${owner.rank_emoji ?? ""}${owner.current_display_name}]님 거래등록은 티어 \"킹\" 이상만 가능합니다.`, result: { status: "rejected" }, summary: { mutation: false, tierCode: owner.tier_code } });
      const target = await this.resolveTarget(transaction, owner.player_id, command.index);
      if (target === undefined) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
        resultCode: "pendant_not_found", actionCode: "market.pendant.register.reject", data: "해당 번호의 펜던트가 존재하지 않습니다.", result: { status: "rejected" }, summary: { mutation: false, sourceIndex: command.index.toString() } });
      const limit = await this.registrationLimit(transaction, owner.player_id);
      const active = await transaction.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM market_listings WHERE seller_player_id=? AND status='open' AND (expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3))", [owner.player_id]);
      if ((active[0]?.count_value ?? 0n) + 1n > limit) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
        resultCode: "listing_limit", actionCode: "market.pendant.register.reject", data: `❌ 자유시장 등록 가능 건수를 초과했습니다.\n현재: ${active[0]?.count_value ?? 0n}/${limit}건\n요청: +1건`, result: { status: "rejected" }, summary: { mutation: false, active: (active[0]?.count_value ?? 0n).toString(), limit: limit.toString() } });
      const carrots = await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(`SELECT stack.item_id,stack.quantity,stack.version FROM inventory_stacks stack
        JOIN item_definitions item ON item.id=stack.item_id
        WHERE stack.player_id=? AND (item.code='ITEM-RWD-044' OR item.display_name='🥕당근이세요?' OR item.display_name='당근')
        ORDER BY CASE WHEN item.code='ITEM-RWD-044' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`, [owner.player_id]);
      const carrot = carrots[0];
      if (carrot === undefined || carrot.quantity < CARROT_FEE) return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
        resultCode: "insufficient_carrot", actionCode: "market.pendant.register.reject", data: "펜던트 거래 등록 수수료 당근🥕 100개가 부족합니다.", result: { status: "rejected" }, summary: { mutation: false, requiredCarrot: "100" } });
      const pendingRows = await transaction.query<Array<{ command_text: string; inventory_instance_id: bigint; instance_version: bigint; price_amount: string }>>("SELECT command_text,inventory_instance_id,instance_version,price_amount FROM market_registration_confirmations WHERE player_id=? AND expires_at>UTC_TIMESTAMP(3) FOR UPDATE", [owner.player_id]);
      const pending = pendingRows[0];
      const same = pending !== undefined && pending.command_text === input.message && pending.inventory_instance_id === target.row.instance_id && pending.instance_version === target.row.version && BigInt(pending.price_amount.split(".")[0]!) === command.price;
      if (!same) {
        await transaction.execute(`INSERT INTO market_registration_confirmations(player_id,command_text,inventory_instance_id,instance_version,price_amount,expires_at,updated_at)
          VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? MINUTE),UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE command_text=VALUES(command_text),inventory_instance_id=VALUES(inventory_instance_id),instance_version=VALUES(instance_version),price_amount=VALUES(price_amount),expires_at=VALUES(expires_at),updated_at=VALUES(updated_at)`, [owner.player_id, input.message, target.row.instance_id, target.row.version, command.price.toString(), CONFIRM_MINUTES]);
        const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 확인\n━━━━━━━━━━━━\n[${display(target)}] 1개\n🅟${commas(command.price)}에 등록하시겠습니까?\n\n※ 등록 수수료 [당근🥕 100개]가 차감됩니다.\n※ 5분 안에 같은 명령어를 다시 입력하면 등록됩니다.`;
        return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
          resultCode: "confirmation_pending", actionCode: "market.pendant.register.confirm", data, result: { status: "pending", instanceId: target.row.instance_id.toString() }, summary: { mutation: false, sourceIndex: command.index.toString(), instanceId: target.row.instance_id.toString(), price: command.price.toString() } });
      }
      await transaction.execute("UPDATE inventory_instances SET status='reserved',version=version+1 WHERE id=? AND player_id=? AND status='owned' AND version=?", [target.row.instance_id, owner.player_id, target.row.version]);
      await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [CARROT_FEE, owner.player_id, carrot.item_id, carrot.version]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,?,'PENDANT_MARKET_REGISTER_FEE')", [operation.insertId, owner.player_id, carrot.item_id, -CARROT_FEE]);
      const expiresAt = new Date(Date.now() + LISTING_DAYS * 86_400_000);
      const listing = await transaction.execute("INSERT INTO market_listings(seller_player_id,asset_type_code,item_id,inventory_instance_id,quantity,price_currency_code,price_amount,expires_at) VALUES (?,'instance',?,?,1,'point',?,?)", [owner.player_id, target.row.item_id, target.row.instance_id, command.price.toString(), expiresAt]);
      await transaction.execute("INSERT INTO market_asset_reservations(listing_id,reservation_key,reserved_at,expires_at) VALUES (?,UUID(),UTC_TIMESTAMP(3),?)", [listing.insertId, expiresAt]);
      await transaction.execute("INSERT INTO market_events(listing_id,operation_id,event_code,detail_json) VALUES (?,?,'created',?)", [listing.insertId, operation.insertId, JSON.stringify({ assetType: "pendant", carrotFee: "100", sourceIndex: command.index.toString() })]);
      await transaction.execute("INSERT INTO market_pendant_registration_ledger(operation_id,listing_id,player_id,inventory_instance_id,source_index,price_amount,carrot_item_id,carrot_fee,instance_version_before,instance_version_after) VALUES (?,?,?,?,?,?,?,?,?,?)", [operation.insertId, listing.insertId, owner.player_id, target.row.instance_id, command.index, command.price.toString(), carrot.item_id, CARROT_FEE, target.row.version, target.row.version + 1n]);
      await transaction.execute("DELETE FROM market_registration_confirmations WHERE player_id=?", [owner.player_id]);
      const data = `[${owner.rank_emoji ?? ""}${owner.current_display_name}] 님\n🏪 자유시장 등록 완료\n━━━━━━━━━━━━\n[${display(target)}]\n🅟${commas(command.price)}에 등록되었습니다.\n\n※ 등록 수수료 [당근🥕 100개]가 차감되었습니다.\n※ 거래수수료는 판매자에게 10% 부담됩니다.`;
      return complete(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, identityId: owner.identity_id, playerId: owner.player_id,
        resultCode: "registered", actionCode: "market.pendant.register", data, result: { status: "registered", listingId: listing.insertId.toString(), instanceId: target.row.instance_id.toString() }, summary: { sourceIndex: command.index.toString(), instanceId: target.row.instance_id.toString(), listingId: listing.insertId.toString(), price: command.price.toString(), carrotFee: "100" } });
    });
  }

  // 레거시 등급·이름 정렬 순번을 stable instance ID로 고정해 잠급니다.
  private async resolveTarget(transaction: DatabaseTransaction, playerId: bigint, index: bigint): Promise<Target | undefined> {
    const rows = await transaction.query<PendantRow[]>(`SELECT instance.id instance_id,instance.item_id,instance.version,item.display_name item_name,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
      JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
      FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
      WHERE instance.player_id=? AND instance.status='owned' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant' FOR UPDATE`, [playerId]);
    const targets = rows.map((row) => ({ row, entry: { instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name, icon: row.icon_value ?? "", grade: row.grade_value ?? "", durability: BigInt(row.durability_value ?? "5"), maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0") } }));
    const sorted = sortPendantBagEntries(targets.map((target) => target.entry));
    const selected = index > BigInt(sorted.length) ? undefined : sorted[Number(index - 1n)];
    return selected === undefined ? undefined : targets.find((target) => target.entry.instanceId === selected.instanceId);
  }

  // 기본 1건에 회원권 7건과 장사꾼 스킬 2건을 레거시 규칙대로 합산합니다.
  private async registrationLimit(transaction: DatabaseTransaction, playerId: bigint): Promise<bigint> {
    const benefits = await transaction.query<Array<{ ticket: bigint; merchant: bigint }>>(`SELECT
      EXISTS(SELECT 1 FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND stack.quantity>0 AND item.display_name='자유시장회원권🏪') ticket,
      EXISTS(SELECT 1 FROM player_pets pet JOIN pet_skills owned ON owned.player_pet_id=pet.id JOIN skill_definitions skill ON skill.id=owned.skill_id WHERE pet.player_id=? AND skill.display_name='타고난 장사꾼') merchant`, [playerId, playerId]);
    return 1n + ((benefits[0]?.ticket ?? 0n) > 0n ? 7n : 0n) + ((benefits[0]?.merchant ?? 0n) > 0n ? 2n : 0n);
  }
}
