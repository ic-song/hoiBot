import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const TICKET_CODE = "legacy-mini-pet-record-reset-ticket";

export interface MiniPetBattleRecordResetCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface MiniPetBattleRecordResetResult {
  status: "reset";
  playerId: string;
  ticketQuantity: string;
  previousWinCount: string;
  previousLossCount: string;
  previousBattleAttempts: string;
  outboxId: string;
  data: string;
  auditId: string;
}

interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface PetRow { id: bigint; }
interface DefinitionRow { id: bigint; }
interface StackRow { item_id: bigint; quantity: bigint; version: bigint; }
interface BattleStateRow { win_count: bigint; loss_count: bigint; version: bigint; }
interface DailyStateRow { mini_battle_attempts: bigint; mini_battle_wins: bigint; mini_battle_losses: bigint; version: bigint; }

// 정확한 미니펫 전적 초기화 명령만 허용합니다.
export function isMiniPetBattleRecordResetCommand(message: string | undefined): boolean {
  return message === "/미니펫전적초기화";
}

// 긴 event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 결과를 동일 command 결과로 복원합니다.
function parseStoredResult(value: string | MiniPetBattleRecordResetResult): MiniPetBattleRecordResetResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetBattleRecordResetResult : value;
}

// 초기화권 차감과 미니펫 전적 초기화를 단일 transaction으로 처리합니다.
export class MiniPetBattleRecordResetService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: MiniPetBattleRecordResetCommand): Promise<MiniPetBattleRecordResetResult> {
    if (!isMiniPetBattleRecordResetCommand(command.message)) {
      throw new ApplicationError("INVALID_MINI_PET_BATTLE_RECORD_RESET_COMMAND", "정확한 /미니펫전적초기화를 입력해주세요.", 422);
    }
    return this.database.withTransaction(async (transaction) => {
      const owners = await transaction.query<OwnerRow[]>(
        `SELECT id AS identity_id,player_id FROM external_identities
         WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `mini-pet.battle-record.reset:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const prior = await transaction.query<Array<{ result_json: string | MiniPetBattleRecordResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,eventKey]
      );
      if (prior[0]?.result_json != null) return parseStoredResult(prior[0].result_json);

      const pet = (await transaction.query<PetRow[]>(
        "SELECT id FROM player_pets WHERE player_id=? ORDER BY id LIMIT 1 FOR UPDATE", [owner.player_id]
      ))[0];
      if (pet === undefined) throw new ApplicationError("MINI_PET_DATA_REQUIRED", "펫 정보를 찾을 수 없습니다.", 409);

      const definition = (await transaction.query<DefinitionRow[]>(
        "SELECT id FROM item_definitions WHERE code=? AND active=TRUE AND stackable=TRUE FOR UPDATE", [TICKET_CODE]
      ))[0];
      if (definition === undefined) {
        throw new ApplicationError("MINI_PET_BATTLE_RECORD_RESET_TICKET_DEFINITION_REQUIRED", "미니펫 전적 초기화권 설정을 찾을 수 없습니다.", 409);
      }
      const stack = (await transaction.query<StackRow[]>(
        "SELECT item_id,quantity,version FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
        [owner.player_id,definition.id]
      ))[0];
      if (stack === undefined || stack.quantity < 1n) {
        throw new ApplicationError("MINI_PET_BATTLE_RECORD_RESET_TICKET_REQUIRED", "미니펫전적초기화권0️⃣이 필요해요!", 409);
      }

      await transaction.execute(
        "INSERT INTO mini_pet_battle_states(player_id,win_count,loss_count,version) VALUES(?,0,0,1) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)",
        [owner.player_id]
      );
      await transaction.execute(
        `INSERT INTO player_pet_daily_records(player_id,record_date,mini_battle_attempts,mini_battle_wins,mini_battle_losses,version)
         VALUES(?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),0,0,0,1)
         ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)`,
        [owner.player_id]
      );
      const battle = (await transaction.query<BattleStateRow[]>(
        "SELECT win_count,loss_count,version FROM mini_pet_battle_states WHERE player_id=? FOR UPDATE", [owner.player_id]
      ))[0]!;
      const daily = (await transaction.query<DailyStateRow[]>(
        `SELECT mini_battle_attempts,mini_battle_wins,mini_battle_losses,version FROM player_pet_daily_records
         WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) FOR UPDATE`, [owner.player_id]
      ))[0]!;

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(),scope,eventKey,owner.identity_id]
      );
      const ticketQuantity = stack.quantity - 1n;
      const ticketUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity=?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",
        [ticketQuantity,owner.player_id,stack.item_id,stack.version]
      );
      const battleUpdate = await transaction.execute(
        `UPDATE mini_pet_battle_states SET win_count=0,loss_count=0,version=version+1,updated_at=UTC_TIMESTAMP(3)
         WHERE player_id=? AND version=?`,
        [owner.player_id,battle.version]
      );
      const dailyUpdate = await transaction.execute(
        `UPDATE player_pet_daily_records SET mini_battle_attempts=0,mini_battle_wins=0,mini_battle_losses=0,version=version+1,updated_at=UTC_TIMESTAMP(3)
         WHERE player_id=? AND record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)) AND version=?`,
        [owner.player_id,daily.version]
      );
      if (ticketUpdate.affectedRows !== 1n || battleUpdate.affectedRows !== 1n || dailyUpdate.affectedRows !== 1n) {
        throw new ApplicationError("MINI_PET_BATTLE_RECORD_RESET_CONFLICT", "전적 또는 가방 정보가 먼저 변경되었습니다.", 409);
      }
      await transaction.execute(
        `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)
         VALUES(?,1,?,?, -1,'mini_pet_battle_record_reset_ticket_used')`,
        [operation.insertId,owner.player_id,stack.item_id]
      );
      await transaction.execute(
        `INSERT INTO mini_pet_battle_record_reset_events
          (operation_id,player_id,ticket_item_id,reset_date,previous_win_count,previous_loss_count,previous_battle_attempts,ticket_quantity)
         VALUES(?,?,?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),?,?,?,?)`,
        [operation.insertId,owner.player_id,stack.item_id,battle.win_count,battle.loss_count,daily.mini_battle_attempts,ticketQuantity]
      );
      const data = "미니펫 전적이 초기화되었습니다!";
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId,command.channelId,JSON.stringify({data})]
      );
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES(?,'MINI_PET_BATTLE_RECORD_RESET',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [command.eventId,operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES(?,'external_identity',?,'player',?,'mini_pet.battle_record.reset','success','Iris /미니펫전적초기화',?,UTC_TIMESTAMP(3))`,
        [operation.insertId,owner.identity_id,owner.player_id,JSON.stringify({previousWinCount:battle.win_count.toString(),previousLossCount:battle.loss_count.toString(),previousBattleAttempts:daily.mini_battle_attempts.toString(),ticketQuantity:ticketQuantity.toString()})]
      );
      const result: MiniPetBattleRecordResetResult = {
        status:"reset",playerId:owner.player_id.toString(),ticketQuantity:ticketQuantity.toString(),
        previousWinCount:battle.win_count.toString(),previousLossCount:battle.loss_count.toString(),previousBattleAttempts:daily.mini_battle_attempts.toString(),
        outboxId:outbox.insertId.toString(),data,auditId:audit.insertId.toString()
      };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
