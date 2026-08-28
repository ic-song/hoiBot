import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/귀속해제";
const COMMAND_CODE = "MINI_PET_BINDING_RELEASE";
const SCOPE = "mini_pet.binding_release";
const TICKET_CODE = "ITEM-MINI-PET-UNBIND-TICKET";
const TICKET_NAME = "미니펫귀속해제권🐰(/귀속해제)";
type Numeric = bigint | number | string;
interface Owner { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null }
interface Pet { id: bigint; definition_id: bigint; definition_name: string; grade_name: string | null; definition_emoji: string; custom_name: string | null; custom_emoji: string | null; progress: Numeric; enhancement_level: Numeric; battle_experience: Numeric; castle_experience: Numeric; raid_experience: Numeric; sale_price: Numeric | null; is_elite: number; version: bigint }
interface Ticket { item_id: bigint; quantity: Numeric | null; version: bigint | null }

export interface MiniPetBindingReleaseResult { status: "released" | "rejected"; reply: string; outboxId: string; ownedMiniPetId?: string; bagCount?: string; bagLimit?: string }

// 귀속해제는 인자 없는 exact 명령만 실행 후보로 허용합니다.
export function isMiniPetBindingReleaseCommand(message: string | undefined): boolean { return message === COMMAND; }
export function normalizeMiniPetBindingReleaseDispatchMessage(message: string): string { return isMiniPetBindingReleaseCommand(message) ? COMMAND : message; }

// 일반 10칸과 프리미엄 15칸 정책을 DB 값으로 계산합니다.
export function miniPetBindingReleaseBagLimit(baseLimit: bigint, premiumBonus: bigint, premium: boolean): bigint { return baseLimit + (premium ? premiumBonus : 0n); }

// stable 미니펫 표시값과 해제 후 가방 수량을 완료 문구로 투영합니다.
export function formatMiniPetBindingReleaseReply(nickname: string, petName: string, petEmoji: string, bagCount: bigint, bagLimit: bigint): string {
  return `[${nickname}] 님\n${petEmoji}${petName} 미니펫의 귀속을 해제했습니다.\n미니펫 가방: ${bagCount}/${bagLimit}`;
}

function key(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | MiniPetBindingReleaseResult): MiniPetBindingReleaseResult { return typeof value === "string" ? JSON.parse(value) as MiniPetBindingReleaseResult : value; }
function petName(row: Pet): string { return row.custom_name ?? row.definition_name; }
function petEmoji(row: Pet): string { return row.custom_emoji ?? row.definition_emoji; }

async function complete(t: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actorId: bigint; playerId: bigint; petId: bigint | null; resultCode: string; reply: string; result: Omit<MiniPetBindingReleaseResult, "reply" | "outboxId">; summary: Record<string, unknown> }): Promise<MiniPetBindingReleaseResult> {
  const outbox = await t.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })]);
  await t.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, COMMAND_CODE, input.operationId, input.resultCode]);
  await t.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'owned_mini_pet',?,'mini_pet.binding_release',?,'Iris /귀속해제',?,UTC_TIMESTAMP(3))", [input.operationId, input.actorId, input.petId, input.resultCode, JSON.stringify(input.summary)]);
  const result = { ...input.result, reply: input.reply, outboxId: outbox.insertId.toString() } as MiniPetBindingReleaseResult;
  await t.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 장착 stable 미니펫을 가방으로 옮기고 귀속해제권 한 개를 한 transaction에서 차감합니다.
export class MiniPetBindingReleaseService {
  public constructor(private readonly database: DatabaseClient) {}

  public async handle(input: { eventId: string; externalUserId: string; channelId?: string; destinationId?: string; message: string }): Promise<MiniPetBindingReleaseResult> {
    if (!isMiniPetBindingReleaseCommand(input.message)) throw new ApplicationError("MINI_PET_BINDING_RELEASE_COMMAND_INVALID", "정확한 /귀속해제 명령을 입력해주세요.", 422);
    const destinationId = input.channelId ?? input.destinationId ?? "";
    return this.database.withTransaction(async (t) => {
      const owner = (await t.query<Owner[]>(`SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE`, [input.externalUserId]))[0];
      if (owner === undefined) throw new ApplicationError("MINI_PET_BINDING_RELEASE_IDENTITY_REQUIRED", "가입된 사용자 정보를 찾을 수 없습니다.", 403);
      const requestKey = key(input.eventId);
      const prior = (await t.query<Array<{ result_json: string | MiniPetBindingReleaseResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, requestKey]))[0];
      if (prior?.result_json != null) return stored(prior.result_json);
      const operation = await t.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), SCOPE, requestKey, owner.identity_id]);
      const nickname = `${owner.rank_emoji ?? ""}${owner.display_name}`;
      const reject = (code: string, reply: string, petId: bigint | null = null, summary: Record<string, unknown> = {}) => complete(t, { operationId: operation.insertId, eventId: input.eventId, destinationId, actorId: owner.identity_id, playerId: owner.player_id, petId, resultCode: code, reply, result: { status: "rejected" }, summary: { mutation: false, ...summary } });
      const equipped = await t.query<Pet[]>(`SELECT pet.id,pet.mini_pet_definition_id definition_id,definition.display_name definition_name,definition.grade_display_name grade_name,definition.emoji_value definition_emoji,pet.custom_name,pet.custom_emoji,pet.progress,pet.enhancement_level,pet.battle_experience,pet.castle_experience,pet.raid_experience,pet.sale_price,pet.is_elite,pet.version FROM owned_mini_pets pet JOIN mini_pet_definitions definition ON definition.id=pet.mini_pet_definition_id WHERE pet.player_id=? AND pet.equipped=TRUE ORDER BY pet.id LIMIT 2 FOR UPDATE`, [owner.player_id]);
      if (equipped.length > 1) throw new ApplicationError("MINI_PET_BINDING_RELEASE_MULTIPLE_EQUIPPED", "장착 미니펫 상태를 확인할 수 없습니다.", 409);
      const selected = equipped[0];
      if (selected === undefined) return reject("not_equipped", `❌ [${nickname}]님, 귀속 해제할 장착 미니펫이 없습니다.`);
      const ticket = (await t.query<Ticket[]>("SELECT item.id item_id,stack.quantity,stack.version FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=? WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE LIMIT 1 FOR UPDATE", [owner.player_id, TICKET_CODE]))[0];
      if (ticket === undefined) throw new ApplicationError("MINI_PET_BINDING_RELEASE_TICKET_REQUIRED", "미니펫 귀속해제권 정의를 찾을 수 없습니다.", 409);
      if (ticket.quantity === null || BigInt(ticket.quantity) < 1n) return reject("ticket_insufficient", `❌ [${nickname}]님 ${TICKET_NAME} 아이템이 부족합니다.`, selected.id, { ticketItemId: ticket.item_id.toString(), ticketQuantity: "0" });
      const bag = await t.query<Array<{ id: bigint; bag_sequence: Numeric | null }>>("SELECT id,bag_sequence FROM owned_mini_pets WHERE player_id=? AND equipped=FALSE ORDER BY COALESCE(bag_sequence,id),id FOR UPDATE", [owner.player_id]);
      const policy = (await t.query<Array<{ base_bag_limit: Numeric; premium_bag_bonus: Numeric }>>("SELECT base_bag_limit,premium_bag_bonus FROM mini_pet_binding_release_policy WHERE policy_key='default' AND active=TRUE FOR UPDATE"))[0];
      if (policy === undefined) throw new ApplicationError("MINI_PET_BINDING_RELEASE_POLICY_REQUIRED", "미니펫 가방 정책을 찾을 수 없습니다.", 409);
      const premium = BigInt((await t.query<Array<{ count_value: Numeric }>>("SELECT COUNT(*) count_value FROM player_passes WHERE player_id=? AND pass_code='premium' AND enabled=TRUE AND (permanent=TRUE OR ends_at>=UTC_TIMESTAMP(3)) FOR UPDATE", [owner.player_id]))[0]?.count_value ?? 0n) > 0n;
      const bagCount = BigInt(bag.length);
      const bagLimit = miniPetBindingReleaseBagLimit(BigInt(policy.base_bag_limit), BigInt(policy.premium_bag_bonus), premium);
      if (bagCount >= bagLimit) return reject("bag_full", `❌ [${nickname}]님, 미니펫 가방이 가득 찼습니다. (${bagCount}/${bagLimit})`, selected.id, { bagCount: bagCount.toString(), bagLimit: bagLimit.toString(), premium });
      const bagSequence = bagCount + 1n;
      const petSnapshot = { ownedMiniPetId: selected.id.toString(), definitionId: selected.definition_id.toString(), displayName: petName(selected), emoji: petEmoji(selected), gradeName: selected.grade_name, progress: String(selected.progress), enhancementLevel: String(selected.enhancement_level), battleExperience: String(selected.battle_experience), castleExperience: String(selected.castle_experience), raidExperience: String(selected.raid_experience), salePrice: selected.sale_price === null ? null : String(selected.sale_price), elite: Number(selected.is_elite) === 1, version: selected.version.toString(), equipped: true };
      const changed = await t.execute("UPDATE owned_mini_pets SET equipped=FALSE,bag_sequence=?,version=version+1 WHERE id=? AND player_id=? AND equipped=TRUE AND version=?", [bagSequence, selected.id, owner.player_id, selected.version]);
      if (changed.affectedRows !== 1n) throw new ApplicationError("MINI_PET_BINDING_RELEASE_CONFLICT", "장착 미니펫이 먼저 변경되었습니다.", 409);
      const ticketBefore = BigInt(ticket.quantity);
      const ticketAfter = ticketBefore - 1n;
      const ticketWrite = await t.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>=1", [ticketAfter, owner.player_id, ticket.item_id, ticket.version]);
      if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("MINI_PET_BINDING_RELEASE_TICKET_CONFLICT", "미니펫 귀속해제권이 먼저 변경되었습니다.", 409);
      await t.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code,created_at) VALUES (?,1,?,?,-1,'MINI_PET_BINDING_RELEASE_TICKET',UTC_TIMESTAMP(3))", [operation.insertId, owner.player_id, ticket.item_id]);
      await t.execute("INSERT INTO mini_pet_binding_release_operations(operation_id,player_id,owned_mini_pet_id,owned_version_before,ticket_item_id,bag_sequence,bag_count_before,bag_count_after,bag_limit,ticket_before,ticket_after,pet_snapshot_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", [operation.insertId, owner.player_id, selected.id, selected.version, ticket.item_id, bagSequence, bagCount, bagCount + 1n, bagLimit, ticketBefore, ticketAfter, JSON.stringify(petSnapshot)]);
      const reply = formatMiniPetBindingReleaseReply(nickname, petName(selected), petEmoji(selected), bagCount + 1n, bagLimit);
      return complete(t, { operationId: operation.insertId, eventId: input.eventId, destinationId, actorId: owner.identity_id, playerId: owner.player_id, petId: selected.id, resultCode: "released", reply, result: { status: "released", ownedMiniPetId: selected.id.toString(), bagCount: (bagCount + 1n).toString(), bagLimit: bagLimit.toString() }, summary: { mutation: true, stableOwnedMiniPetId: selected.id.toString(), locationBefore: "equipped", locationAfter: "bag", bagSequence: bagSequence.toString(), bagCountBefore: bagCount.toString(), bagCountAfter: (bagCount + 1n).toString(), bagLimit: bagLimit.toString(), premium, ticketItemId: ticket.item_id.toString(), ticketBefore: ticketBefore.toString(), ticketAfter: ticketAfter.toString() } });
    });
  }
}
