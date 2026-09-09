import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const MATERIAL_CODE = "legacy-seasoned-chicken";
const TICKET_CODE = "legacy-mini-pet-record-reset-ticket";
const MATERIAL_QUANTITY = 100n;
const RECIPE_VERSION = 1n;

export interface MiniPetBattleResetTicketCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface MiniPetBattleResetTicketCraftResult {
  status: "crafted";
  playerId: string;
  materialQuantity: string;
  ticketQuantity: string;
  outboxId: string;
  data: string;
  auditId: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface DefinitionRow { id: bigint; code: string; }
interface StackRow { item_id: bigint; code: string; quantity: bigint; version: bigint; }

// 정확한 미니펫 전적 초기화권 조합 명령만 허용합니다.
export function isMiniPetBattleResetTicketCraftCommand(message: string | undefined): boolean {
  return message === "/미니펫전적조합";
}

// 긴 event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 동일 command 결과로 복원합니다.
function parseStoredResult(value: string | MiniPetBattleResetTicketCraftResult): MiniPetBattleResetTicketCraftResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetBattleResetTicketCraftResult : value;
}

// 양념치킨 차감과 전적 초기화권 지급을 단일 재고 원장 transaction으로 처리합니다.
export class MiniPetBattleResetTicketCraftService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: MiniPetBattleResetTicketCraftCommand): Promise<MiniPetBattleResetTicketCraftResult> {
    if (!isMiniPetBattleResetTicketCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_MINI_PET_BATTLE_RESET_TICKET_CRAFT_COMMAND", "정확한 /미니펫전적조합을 입력해주세요.", 422);
    }
    return this.database.withTransaction(async (transaction) => {
      const owners = await transaction.query<OwnerRow[]>(
        `SELECT id AS identity_id, player_id FROM external_identities
         WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `mini_pet.battle-reset-ticket.craft:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | MiniPetBattleResetTicketCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,eventKey]
      );
      if (prior[0]?.result_json != null) return parseStoredResult(prior[0].result_json);

      const definitions = await transaction.query<DefinitionRow[]>(
        "SELECT id,code FROM item_definitions WHERE code IN (?,?) AND active=TRUE AND stackable=TRUE ORDER BY code FOR UPDATE",
        [MATERIAL_CODE,TICKET_CODE]
      );
      const materialDefinition = definitions.find((row) => row.code === MATERIAL_CODE);
      const ticketDefinition = definitions.find((row) => row.code === TICKET_CODE);
      if (materialDefinition === undefined || ticketDefinition === undefined) {
        throw new ApplicationError("MINI_PET_BATTLE_RESET_RECIPE_REQUIRED", "미니펫 전적 초기화권 조합 설정을 찾을 수 없습니다.", 409);
      }
      await transaction.execute(
        "INSERT IGNORE INTO inventory_stacks(player_id,item_id,quantity,version) VALUES(?,?,0,1),(?,?,0,1)",
        [owner.player_id,materialDefinition.id,owner.player_id,ticketDefinition.id]
      );
      const stacks = await transaction.query<StackRow[]>(
        `SELECT stack.item_id,item.code,stack.quantity,stack.version FROM inventory_stacks stack
         JOIN item_definitions item ON item.id=stack.item_id
         WHERE stack.player_id=? AND item.code IN (?,?) ORDER BY item.code FOR UPDATE`,
        [owner.player_id,MATERIAL_CODE,TICKET_CODE]
      );
      const material = stacks.find((row) => row.code === MATERIAL_CODE)!;
      const ticket = stacks.find((row) => row.code === TICKET_CODE)!;
      if (material.quantity < MATERIAL_QUANTITY) {
        throw new ApplicationError("SEASONED_CHICKEN_REQUIRED", "양념치킨🐔 100마리가 필요해요!", 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(),scope,eventKey,owner.identity_id]
      );
      const materialQuantity = material.quantity - MATERIAL_QUANTITY;
      const ticketQuantity = ticket.quantity + 1n;
      const materialUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [materialQuantity,owner.player_id,material.item_id,material.version]
      );
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [ticketQuantity,owner.player_id,ticket.item_id,ticket.version]
      );
      if (materialUpdate.affectedRows !== 1n || ticketUpdate.affectedRows !== 1n) {
        throw new ApplicationError("MINI_PET_BATTLE_RESET_TICKET_CRAFT_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)
         VALUES(?,1,?,?,?,'mini_pet_battle_reset_ticket_craft_material'),(?,2,?,?,1,'mini_pet_battle_reset_ticket_crafted')`,
        [operation.insertId,owner.player_id,material.item_id,(-MATERIAL_QUANTITY).toString(),operation.insertId,owner.player_id,ticket.item_id]
      );
      await transaction.execute(
        `INSERT INTO mini_pet_battle_reset_ticket_craft_events
          (operation_id,player_id,material_item_id,ticket_item_id,material_quantity,ticket_quantity,recipe_version)
         VALUES(?,?,?,?,?,?,?)`,
        [operation.insertId,owner.player_id,material.item_id,ticket.item_id,MATERIAL_QUANTITY,ticketQuantity,RECIPE_VERSION]
      );
      const data = "미니펫전적초기화권0️⃣ 1개가 완성되었습니다!\n/미니펫전적초기화로 전적을 초기화할 수 있어요.";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId,command.channelId,JSON.stringify({data})]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'MINI_PET_BATTLE_RESET_TICKET_CRAFT',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [command.eventId,operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'external_identity',?,'player',?,'mini_pet.battle_reset_ticket.craft','success','Iris /미니펫전적조합',?,UTC_TIMESTAMP(3))`,
        [operation.insertId,owner.identity_id,owner.player_id,JSON.stringify({materialQuantity:materialQuantity.toString(),ticketQuantity:ticketQuantity.toString(),recipeVersion:RECIPE_VERSION.toString()})]
      );
      const result: MiniPetBattleResetTicketCraftResult = {
        status:"crafted",playerId:owner.player_id.toString(),materialQuantity:materialQuantity.toString(),ticketQuantity:ticketQuantity.toString(),
        outboxId:outbox.insertId.toString(),data,auditId:audit.insertId.toString()
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
