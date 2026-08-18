import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const PET_RENAME_TICKET_CODE = "legacy-pet-name-change-ticket";

export interface PetRenameCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface PetRenameResult {
  status: "renamed" | "blocked_by_castle_siege";
  playerId?: string;
  petId?: string;
  petName?: string;
  ticketQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}

interface PetRenameOwnerRow {
  identity_id: bigint;
  player_id: bigint;
}

// Iris 메시지가 `/펫이름` 명령 후보인지 실제 변경 없이 판별합니다.
export function isPetRenameCommandCandidate(message: string | undefined): boolean {
  return message === "/펫이름" || message?.startsWith("/펫이름 ") === true;
}

// 변경 명령에서 공백 없는 1~6자 펫 이름만 추출합니다.
export function parsePetRenameCommand(message: string): string | null {
  const match = /^\/펫이름 ([^\s]{1,6})$/.exec(message);
  return match?.[1] ?? null;
}

// 긴 event ID를 operations의 idempotency 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | PetRenameResult): PetRenameResult {
  return typeof value === "string" ? JSON.parse(value) as PetRenameResult : value;
}

// `/펫이름`의 펫 이름과 변경권 차감·원장·감사·답장을 한 트랜잭션으로 저장합니다.
export class PetRenameService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: PetRenameCommand): Promise<PetRenameResult> {
    const petName = parsePetRenameCommand(command.message);
    if (petName === null) {
      const requestedName = command.message.startsWith("/펫이름 ")
        ? command.message.slice("/펫이름 ".length)
        : "";
      if (requestedName.length > 6) {
        throw new ApplicationError("PET_NAME_TOO_LONG", "펫 이름은 6글자 이하로 설정해주세요.", 422);
      }
      throw new ApplicationError("INVALID_PET_RENAME_COMMAND", "펫 이름은 공백 없이 1~6글자로 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<PetRenameOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `pet.rename:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetRenameResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const pets = await transaction.query<Array<{ id: bigint; display_name: string | null; version: bigint }>>(
        "SELECT id, display_name, version FROM player_pets WHERE player_id = ? FOR UPDATE",
        [owner.player_id]
      );
      const pet = pets[0];
      if (pet === undefined || pet.display_name === null || pet.display_name === "") {
        throw new ApplicationError("PET_NOT_FOUND", "펫이 없습니다.", 409);
      }

      const tickets = await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, stack.quantity, stack.version
         FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE
         FOR UPDATE`,
        [owner.player_id, PET_RENAME_TICKET_CODE]
      );
      const ticket = tickets[0];
      if (ticket === undefined || ticket.quantity < 1n) {
        throw new ApplicationError("PET_RENAME_TICKET_REQUIRED", "펫 이름변경권🎫이 없습니다.", 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const petUpdate = await transaction.execute(
        "UPDATE player_pets SET display_name = ?, version = version + 1 WHERE id = ? AND version = ?",
        [petName, pet.id, pet.version]
      );
      if (petUpdate.affectedRows !== 1n) throw new ApplicationError("PET_RENAME_CONFLICT", "펫 정보가 먼저 변경되었습니다.", 409);

      const ticketQuantity = ticket.quantity - 1n;
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [ticketQuantity, owner.player_id, ticket.item_id, ticket.version]
      );
      if (ticketUpdate.affectedRows !== 1n) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, -1, 'pet_rename_ticket_used')`,
        [operation.insertId, owner.player_id, ticket.item_id]
      );

      const data = "펫이름 변경이 완료되었습니다.";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'pet_rename', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player_pet', ?, 'pet.rename', 'success', 'Iris /펫이름', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, pet.id, JSON.stringify({
          previousName: pet.display_name, petName, ticketCode: PET_RENAME_TICKET_CODE, ticketQuantity: ticketQuantity.toString()
        })]
      );
      const result: PetRenameResult = {
        status: "renamed", playerId: owner.player_id.toString(), petId: pet.id.toString(), petName,
        ticketQuantity: ticketQuantity.toString(), outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString()
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
