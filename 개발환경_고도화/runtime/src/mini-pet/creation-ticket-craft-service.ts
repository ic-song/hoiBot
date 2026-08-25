import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MATERIAL_CODE = "bag_3241894752b82f7a";
const RESULT_DEFINITION_CODE = "mini_pet_collection_creation";
const REQUIRED_MATERIAL = 20000n;

export interface MiniPetCreationTicketCraftCommand {
  externalUserId: string; channelId: string; eventId: string; message: string; environmentCode: "prod" | "dev";
}
export interface MiniPetCreationTicketCraftResult {
  status: "crafted" | "blocked_by_castle_siege" | "ignored_missing_member" | "snapshot_required";
  data?: string; playerId?: string; materialQuantity?: string; ownedMiniPetId?: string;
  stableOwnedId?: string; afterSortIndex?: number; outboxId?: string; replayed?: boolean;
}

// 인자나 접미사가 없는 정확한 창조 미니펫 조합 명령만 허용합니다.
export function isMiniPetCreationTicketCraftCommand(message: string | undefined): boolean {
  return message === "/미니펫창조조합";
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function requestHash(command: MiniPetCreationTicketCraftCommand): string {
  return createHash("sha256").update(JSON.stringify([command.environmentCode, command.externalUserId, command.channelId, command.message])).digest("hex");
}
function stored(value: string | MiniPetCreationTicketCraftResult): MiniPetCreationTicketCraftResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetCreationTicketCraftResult : value;
}

export class MiniPetCreationTicketCraftService {
  constructor(private readonly database: DatabaseClient) {}

  // 재료 20,000개 차감과 고정 창조 미니펫·안정 ID·원장·응답을 한 트랜잭션으로 저장합니다.
  async execute(command: MiniPetCreationTicketCraftCommand): Promise<MiniPetCreationTicketCraftResult> {
    if (!isMiniPetCreationTicketCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_MINIPET_CREATION_TICKET_CRAFT_COMMAND", "정확히 /미니펫창조조합을 입력해주세요.", 422);
    }
    const hash = requestHash(command);
    return this.database.withTransaction(async (tx) => {
      const environments = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE"
      );
      if (environments[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("MINIPET_CREATION_CRAFT_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }
      const sieges = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))"
      );
      if ((sieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await tx.query<Array<{ identity_id: bigint; player_id: bigint; current_display_name: string }>>(
        `SELECT identity.id identity_id,identity.player_id,profile.current_display_name
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id=identity.player_id
         WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`, [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };
      const scope = `mini_pet.creation_ticket_craft:${command.environmentCode}:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | MiniPetCreationTicketCraftResult | null; request_hash: string | null }>>(
        `SELECT operation.result_json,event.request_hash FROM operations operation
         LEFT JOIN mini_pet_creation_ticket_craft_events event ON event.operation_id=operation.id
         WHERE operation.idempotency_scope=? AND operation.idempotency_key=? FOR UPDATE`, [scope, key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].request_hash !== hash) throw new ApplicationError("MINIPET_CREATION_CRAFT_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_CREATION_CRAFT_PROCESSING", "창조 미니펫 조합이 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }

      const inventoryStates = await tx.query<Array<{ capacity_limit: number; bag_shape_code: string }>>(
        "SELECT capacity_limit,bag_shape_code FROM mini_pet_inventory_player_states WHERE player_id=? FOR UPDATE", [owner.player_id]
      );
      const inventoryState = inventoryStates[0];
      if (inventoryState === undefined || inventoryState.bag_shape_code !== "array") {
        return { status: "snapshot_required", data: "미니펫 가방을 먼저 확인한 뒤 조합해 주세요." };
      }
      const bagRows = await tx.query<Array<{ owned_mini_pet_id: bigint; sort_index: number | null }>>(
        `SELECT state.owned_mini_pet_id,state.sort_index FROM mini_pet_inventory_owned_states state
         JOIN owned_mini_pets owned ON owned.id=state.owned_mini_pet_id AND owned.player_id=state.player_id
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id=owned.id
         WHERE state.player_id=? AND owned.equipped=FALSE AND COALESCE(lifecycle.state_code,'active')='active'
         ORDER BY state.sort_index,state.owned_mini_pet_id FOR UPDATE`, [owner.player_id]
      );
      if (!bagRows.every((row, index) => row.sort_index === index + 1)) {
        return { status: "snapshot_required", data: "미니펫 가방 순서를 먼저 복구해 주세요." };
      }
      if (bagRows.length >= inventoryState.capacity_limit) {
        throw new ApplicationError("MINIPET_BAG_CAPACITY_REQUIRED", "미니펫 가방 공간이 부족합니다. [최대 100개 소지가능]", 409);
      }
      const afterSortIndex = bagRows.length + 1;

      const materials = await tx.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT item.id item_id,stack.quantity,stack.version FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
         WHERE item.code=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`, [owner.player_id, MATERIAL_CODE]
      );
      const material = materials[0];
      if (material === undefined || material.quantity < REQUIRED_MATERIAL) {
        throw new ApplicationError("MINIPET_CREATION_TICKET_REQUIRED", `미니펫뽑기🐹 ${REQUIRED_MATERIAL.toLocaleString("ko-KR")}개가 필요합니다.`, 409);
      }
      const definitions = await tx.query<Array<{ id: bigint; display_name: string }>>(
        "SELECT id,display_name FROM mini_pet_definitions WHERE code=? AND active=TRUE LIMIT 1 FOR UPDATE", [RESULT_DEFINITION_CODE]
      );
      const definition = definitions[0];
      if (definition === undefined) throw new ApplicationError("MINIPET_CREATION_DEFINITION_REQUIRED", "컬렉션창조 미니펫 설정을 찾을 수 없습니다.", 409);

      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const materialAfter = material.quantity - REQUIRED_MATERIAL;
      const materialWrite = materialAfter === 0n
        ? await tx.execute("DELETE FROM inventory_stacks WHERE player_id=? AND item_id=? AND version=?", [owner.player_id, material.item_id, material.version])
        : await tx.execute("UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?", [materialAfter, owner.player_id, material.item_id, material.version]);
      if (materialWrite.affectedRows !== 1n) throw new ApplicationError("MINIPET_CREATION_CRAFT_CONFLICT", "재료 정보가 먼저 변경되었습니다.", 409);

      const owned = await tx.execute(
        `INSERT INTO owned_mini_pets(player_id,mini_pet_definition_id,custom_name,progress,enhancement_level,battle_experience,castle_experience,raid_experience,equipped)
         VALUES(?,?,?,0,0,1,0,0,FALSE)`, [owner.player_id, definition.id, definition.display_name]
      );
      const stableOwnedId = randomUUID();
      await tx.execute("INSERT INTO mini_pet_inventory_owned_states(owned_mini_pet_id,player_id,stable_owned_id,sort_index) VALUES(?,?,?,?)",
        [owned.insertId, owner.player_id, stableOwnedId, afterSortIndex]);
      await tx.execute("INSERT INTO mini_pet_owned_lifecycle(owned_mini_pet_id,player_id,state_code) VALUES(?,?,'active')", [owned.insertId, owner.player_id]);
      await tx.execute(
        "INSERT INTO mini_pet_creation_ticket_craft_events(operation_id,request_hash,environment_code,player_id,material_item_id,material_quantity,owned_mini_pet_id,stable_owned_id,after_sort_index) VALUES(?,?,?,?,?,?,?,?,?)",
        [operation.insertId, hash, command.environmentCode, owner.player_id, material.item_id, REQUIRED_MATERIAL, owned.insertId, stableOwnedId, afterSortIndex]
      );
      await tx.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES(?,1,?,?,?,'mini_pet_creation_ticket_craft')",
        [operation.insertId, owner.player_id, material.item_id, -REQUIRED_MATERIAL]);
      const data = `✅ 미니펫뽑기🐹 ${REQUIRED_MATERIAL.toLocaleString("ko-KR")}개를 조합해 [컬렉션창조 미니펫🐹]을 획득했습니다.`;
      const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'mini_pet_creation_ticket_craft',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'player',?,'mini_pet.creation_ticket_craft','success','Iris /미니펫창조조합',?,UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ materialQuantity: REQUIRED_MATERIAL.toString(), materialAfter: materialAfter.toString(), ownedMiniPetId: owned.insertId.toString(), stableOwnedId, afterSortIndex })]);
      const result: MiniPetCreationTicketCraftResult = { status: "crafted", data, playerId: owner.player_id.toString(), materialQuantity: materialAfter.toString(),
        ownedMiniPetId: owned.insertId.toString(), stableOwnedId, afterSortIndex, outboxId: outbox.insertId.toString(), replayed: false };
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
