import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import type { PetTitleDefinitionLinkProvider } from "../pet/pet-title-definition-link.js";

export interface PetTitleAddCommand {
  targetName: string;
  titleName: string;
  priceDigits: string;
}

export interface PetTitleAddInput extends PetTitleAddCommand {
  idempotencyKey: string;
  sourceEventId: string;
  destinationId: string;
  operatorId: string;
}

export interface PetTitleAddResult {
  status: "added";
  playerId: string;
  instanceId: string;
  instanceKey: string;
  titleKey: string;
  displayOrder: string;
  data: string;
  outboxId: string;
  auditId: string;
}

// 레거시의 전체 형식과 쉼표 뒤 필수 공백 및 마지막 숫자 가격을 보존합니다.
export function parsePetTitleAddCommand(message: string | undefined): PetTitleAddCommand | null {
  if (message === undefined || !message.startsWith("/펫타이틀추가")) return null;
  const match = /^\/펫타이틀추가\s+([^]+)\s*,\s+([^]+)\s+(\d+)\s*$/.exec(message);
  if (match === null) return null;
  return { targetName: match[1]!, titleName: match[2]!, priceDigits: match[3]! };
}

// 정확 명령 후보만 공용 관리자 dispatch에 전달합니다.
export function isPetTitleAddCommandCandidate(message: string | undefined): boolean {
  return parsePetTitleAddCommand(message) !== null;
}

// 긴 Iris event ID를 operations의 멱등 키 길이에 맞게 정규화합니다.
function normalizeEventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 제목 원문을 변경하지 않고 동일 제목을 식별할 안정 KEY를 만듭니다.
function titleKey(value: string): string {
  return `PET_TITLE_${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function parseStoredResult(value: string | PetTitleAddResult): PetTitleAddResult {
  return typeof value === "string" ? JSON.parse(value) as PetTitleAddResult : value;
}

// 펫 존재 여부와 무관하게 사용자별 펫 타이틀 지급 인스턴스를 순서대로 추가합니다.
export class PetTitleAddService {
  constructor(private readonly database: DatabaseClient, private readonly titleDefinitions?: PetTitleDefinitionLinkProvider) {}

  async add(input: PetTitleAddInput): Promise<PetTitleAddResult> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `admin.pet_title.add:${input.operatorId}`;
      const eventKey = normalizeEventKey(input.idempotencyKey);
      const prior = await transaction.query<Array<{ result_json: string | PetTitleAddResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",
        [scope, eventKey],
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return parseStoredResult(prior[0].result_json);

      const targets = await transaction.query<Array<{ player_id: bigint; display_name: string }>>(
        `SELECT player.id AS player_id,profile.current_display_name AS display_name
         FROM players player JOIN player_profiles profile ON profile.player_id=player.id
         WHERE profile.current_display_name=? ORDER BY player.id LIMIT 2 FOR UPDATE`,
        [input.targetName],
      );
      if (targets.length === 0) {
        throw new ApplicationError("PLAYER_NOT_FOUND", `${input.targetName}는(은) 존재하지 않는 사용자입니다.`, 404);
      }
      if (targets.length > 1) {
        throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 사용자가 여러 명이므로 player ID 기반 지급이 필요합니다.", 409);
      }
      const target = targets[0]!;
      const orderRows = await transaction.query<Array<{ last_order: bigint | string }>>(
        "SELECT COALESCE(MAX(display_order),0) AS last_order FROM player_pet_title_instances WHERE player_id=?",
        [target.player_id],
      );
      const displayOrder = BigInt(orderRows[0]?.last_order ?? 0) + 1n;
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, input.operatorId],
      );
      const instanceKey = randomUUID();
      const stableTitleKey = titleKey(input.titleName);
      const definition = await this.titleDefinitions?.ensureAdminCustom(transaction, input.titleName);
      const instance = definition === undefined
        ? await transaction.execute(
          `INSERT INTO player_pet_title_instances
            (instance_key,player_id,title_key,display_name,price_digits,display_order,acquired_at,equipped,status,version)
           VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3),FALSE,'owned',1)`,
          [instanceKey, target.player_id, stableTitleKey, input.titleName, input.priceDigits, displayOrder],
        )
        : await transaction.execute(
          `INSERT INTO player_pet_title_instances
            (instance_key,player_id,title_key,legacy_title_definition_id,title_catalog_entry_id,display_name,price_digits,display_order,acquired_at,equipped,status,version)
           VALUES (?,?,?,?,?,?,?,?,UTC_TIMESTAMP(3),FALSE,'owned',1)`,
          [instanceKey, target.player_id, stableTitleKey, definition.titleId, definition.catalogEntryId, input.titleName, input.priceDigits, displayOrder],
        );
      const data = `[${target.display_name}] 님에게\n[${input.titleName}] 펫 타이틀이 부여되었습니다.`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at)
         VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at)
         VALUES (?,'admin_pet_title_add',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))`,
        [input.sourceEventId, operation.insertId],
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,'admin_operator',?,'player',?,'pet_title.add','success','Iris /펫타이틀추가',?,UTC_TIMESTAMP(3))`,
        [operation.insertId, input.operatorId, target.player_id, JSON.stringify({
          instanceKey, titleKey: stableTitleKey, titleName: input.titleName,
          priceDigits: input.priceDigits, displayOrder: displayOrder.toString(),
        })],
      );
      const result: PetTitleAddResult = {
        status: "added", playerId: target.player_id.toString(), instanceId: instance.insertId.toString(),
        instanceKey, titleKey: stableTitleKey, displayOrder: displayOrder.toString(), data,
        outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(),
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId],
      );
      return result;
    });
  }
}
