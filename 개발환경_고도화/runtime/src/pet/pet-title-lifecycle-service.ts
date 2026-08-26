import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const ALL_SEE = "\u200b".repeat(500);
const TITLE_TICKET_NAME = "펫타이틀권🦊(/펫타이틀이름)";

export type PetTitleCommand =
  | { kind: "list_self" }
  | { kind: "list_target"; targetName: string }
  | { kind: "create"; titleName: string }
  | { kind: "select"; index: number }
  | { kind: "remove"; targetName: string; index: number };

export interface PetTitleLifecycleResult {
  status: "displayed" | "created" | "selected" | "removed" | "silent";
  data: string | null;
  outboxId: string | null;
  playerId?: string;
  instanceId?: string;
}

export interface PetTitleListRow {
  instanceId: bigint;
  displayName: string;
  priceDigits: string;
  acquiredAt: Date | string;
  equipped: boolean | number;
}

interface ActorRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  rank_emoji: string | null;
}

// 다섯 펫 타이틀 명령의 레거시 실행 경계를 완전 패턴으로 판별합니다.
export function parsePetTitleCommand(message: string | undefined): PetTitleCommand | null {
  if (message === "/펫타이틀목록") return { kind: "list_self" };
  let match = /^\/펫타이틀목록\s+(.+)$/.exec(message ?? "");
  if (match !== null) return { kind: "list_target", targetName: match[1]!.slice(0, 4) };
  match = /^\/펫타이틀이름\s+(.+)$/.exec(message ?? "");
  if (match !== null) return { kind: "create", titleName: match[1]!.trim() };
  match = /^\/펫타이틀\s+(\d+)\s*$/.exec(message ?? "");
  if (match !== null) return { kind: "select", index: Number(match[1]!) };
  match = /^\/펫타이틀제거\s+(.+)\s+(\d+)\s*$/.exec(message ?? "");
  if (match !== null) return { kind: "remove", targetName: match[1]!, index: Number(match[2]!) };
  return null;
}

// 공용 dispatch가 인자형 명령을 등록된 별칭으로 조회할 수 있게 정규화합니다.
export function normalizePetTitleDispatchMessage(message: string): string {
  const command = parsePetTitleCommand(message);
  if (command?.kind === "list_self") return "/펫타이틀목록";
  if (command?.kind === "list_target") return "/펫타이틀목록 [유저명]";
  if (command?.kind === "create") return "/펫타이틀이름 [인자]";
  if (command?.kind === "select") return "/펫타이틀 [번호]";
  if (command?.kind === "remove") return "/펫타이틀제거 [유저명] [타이틀번호]";
  return message;
}

// 유효한 펫 타이틀 명령만 부분 dispatch 후보로 올립니다.
export function isPetTitleCommandCandidate(message: string | undefined): boolean {
  return parsePetTitleCommand(message) !== null;
}

// 목록의 현재 순번과 영구 instance ID를 분리한 채 레거시 UI를 만듭니다.
export function formatPetTitleList(rankName: string, rows: readonly PetTitleListRow[], detailed: boolean): string {
  if (rows.length === 0) return "보유한 펫 타이틀이 없습니다.";
  let output = `[${rankName}]님의 펫 타이틀 목록\n\n`;
  if (rows.length > 10) output += `펫 타이틀 10개 이상 보유자\n${ALL_SEE}`;
  rows.forEach((row, index) => {
    if (Boolean(row.equipped)) output += "☞ ";
    output += `${index + 1}. ${row.displayName}`;
    if (detailed) {
      const acquired = new Date(row.acquiredAt).toLocaleString("ko-KR", {
        timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      });
      output += `/획득일: ${acquired}/가격: 🅟${row.priceDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
    }
    output += "\n";
  });
  return output.trim();
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | PetTitleLifecycleResult): PetTitleLifecycleResult {
  return typeof value === "string" ? JSON.parse(value) as PetTitleLifecycleResult : value;
}

function commandCode(command: PetTitleCommand): string {
  return command.kind === "list_self" ? "PET_TITLE_LIST_SELF"
    : command.kind === "list_target" ? "PET_TITLE_LIST_TARGET"
    : command.kind === "create" ? "PET_TITLE_NAME_CREATE"
    : command.kind === "select" ? "PET_TITLE_SELECT"
    : "ADMIN_PET_TITLE_REMOVE";
}

// 사용자·운영자 펫 타이틀 조회와 생성·선택·제거를 하나의 원자 생명주기로 처리합니다.
export class PetTitleLifecycleService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PetTitleLifecycleResult> {
    const command = parsePetTitleCommand(input.message);
    if (command === null) throw new ApplicationError("INVALID_PET_TITLE_COMMAND", "올바른 펫 타이틀 명령어 형식을 사용해주세요.", 422);
    if (command.kind === "create" && command.titleName.length > 20) {
      throw new ApplicationError("PET_TITLE_NAME_TOO_LONG", "❌ 펫 타이틀 이름은 최대 20자까지 가능합니다.", 422);
    }
    if ((command.kind === "select" || command.kind === "remove") && command.index < 1) {
      throw new ApplicationError("PET_TITLE_INDEX_INVALID", "펫 타이틀 번호는 1 이상이어야 합니다.", 422);
    }

    return this.database.withTransaction(async (transaction) => {
      if (command.kind === "select") {
        const active = await transaction.query<Array<{ active_count: bigint }>>(
          "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status='active' AND (starts_at IS NULL OR starts_at<=UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at>=UTC_TIMESTAMP(3))",
        );
        if ((active[0]?.active_count ?? 0n) > 0n) return { status: "silent", data: null, outboxId: null };
      }

      const actors = await transaction.query<ActorRow[]>(
        `SELECT identity.id AS identity_id,identity.player_id,profile.current_display_name,rank_profile.rank_emoji
           FROM external_identities identity JOIN players player ON player.id=identity.player_id
           JOIN player_profiles profile ON profile.player_id=player.id
           LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
            AND player.status='active' AND player.deleted_at IS NULL FOR UPDATE`,
        [input.externalUserId],
      );
      const actor = actors[0];
      if (actor === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      let operatorId: bigint | null = null;
      if (command.kind === "list_target" || command.kind === "remove") {
        const roles = command.kind === "remove" ? ["super_admin"] : ["super_admin", "manager"];
        const operators = await transaction.query<Array<{ operator_id: bigint }>>(
          `SELECT mapping.operator_id FROM admin_operator_external_identities mapping
             JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
             JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
             JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
            WHERE mapping.external_identity_id=? AND role.code IN (${roles.map(() => "?").join(",")}) LIMIT 1 FOR UPDATE`,
          [actor.identity_id, ...roles],
        );
        operatorId = operators[0]?.operator_id ?? null;
        if (operatorId === null) throw new ApplicationError("PET_TITLE_FORBIDDEN", "펫 타이틀 관리 권한이 없습니다.", 403);
      }

      const scope = `pet.title.${command.kind}:${operatorId ?? actor.identity_id}`;
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PetTitleLifecycleResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key],
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);

      let target = actor;
      if (command.kind === "list_target" || command.kind === "remove") {
        const targets = await transaction.query<ActorRow[]>(
          `SELECT 0 AS identity_id,player.id AS player_id,profile.current_display_name,rank_profile.rank_emoji
             FROM players player JOIN player_profiles profile ON profile.player_id=player.id
             LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
            WHERE profile.current_display_name=? AND player.status='active' AND player.deleted_at IS NULL
            ORDER BY player.id LIMIT 2 FOR UPDATE`, [command.targetName],
        );
        if (targets.length === 0) throw new ApplicationError("PET_TITLE_TARGET_NOT_FOUND", `${command.targetName}님의 펫 타이틀 정보가 없습니다.`, 404);
        if (targets.length > 1) throw new ApplicationError("PLAYER_NAME_AMBIGUOUS", "동일 표시명의 사용자가 여러 명입니다.", 409);
        target = targets[0]!;
      }

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at)
         VALUES (?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, key, operatorId === null ? "external_identity" : "admin_operator", operatorId ?? actor.identity_id],
      );
      let status: PetTitleLifecycleResult["status"] = "displayed";
      let instanceId: bigint | undefined;
      let data: string;

      if (command.kind === "list_self" || command.kind === "list_target") {
        const rows = await this.titleRows(transaction, target.player_id);
        data = formatPetTitleList(`${target.rank_emoji ?? ""}${target.current_display_name}`, rows, command.kind === "list_target");
      } else if (command.kind === "create") {
        const tickets = await transaction.query<Array<{ item_id: bigint; quantity: bigint; version: bigint }>>(
          `SELECT stack.item_id,stack.quantity,stack.version FROM item_definitions item
             JOIN inventory_stacks stack ON stack.item_id=item.id AND stack.player_id=?
            WHERE item.display_name=? AND item.active=TRUE AND item.stackable=TRUE FOR UPDATE`,
          [actor.player_id, TITLE_TICKET_NAME],
        );
        const ticket = tickets[0];
        if (ticket === undefined || ticket.quantity < 1n) throw new ApplicationError("PET_TITLE_TICKET_REQUIRED", `❌ ${TITLE_TICKET_NAME} 아이템이 부족합니다.`, 409);
        const order = await transaction.query<Array<{ last_order: bigint }>>(
          "SELECT COALESCE(MAX(display_order),0) AS last_order FROM player_pet_title_instances WHERE player_id=? FOR UPDATE", [actor.player_id],
        );
        const inserted = await transaction.execute(
          `INSERT INTO player_pet_title_instances(instance_key,player_id,title_key,display_name,price_digits,display_order,acquired_at,equipped,status,version)
           VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3),FALSE,'owned',1)`,
          [randomUUID(), actor.player_id, `PET_TITLE_${createHash("sha256").update(command.titleName).digest("hex")}`, command.titleName, "100000000", (order[0]?.last_order ?? 0n) + 1n],
        );
        instanceId = inserted.insertId;
        const updated = await transaction.execute(
          "UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND version=? AND quantity>0",
          [actor.player_id, ticket.item_id, ticket.version],
        );
        if (updated.affectedRows !== 1n) throw new ApplicationError("INVENTORY_VERSION_CONFLICT", "인벤토리가 먼저 변경되었습니다.", 409);
        await transaction.execute(
          "INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,1,?,?,-1,'pet_title_ticket_used')",
          [operation.insertId, actor.player_id, ticket.item_id],
        );
        status = "created";
        data = `[${actor.rank_emoji ?? ""}${actor.current_display_name}] 님이 새로운 펫 타이틀을 생성완료!\n\n🎉 생성된 타이틀: [${command.titleName}]\n\n사용 아이템:\n ${TITLE_TICKET_NAME} -1 소모`;
      } else {
        const rows = await this.titleRows(transaction, target.player_id);
        const selected = rows[command.index - 1];
        if (selected === undefined) throw new ApplicationError("PET_TITLE_NOT_FOUND", "해당 번호의 펫 타이틀이 존재하지 않습니다.", 404);
        instanceId = selected.instanceId;
        if (command.kind === "select") {
          await transaction.execute("UPDATE player_pet_title_instances SET equipped=FALSE,version=version+1 WHERE player_id=? AND status='owned' AND equipped=TRUE", [actor.player_id]);
          await transaction.execute("UPDATE player_pet_title_instances SET equipped=TRUE,version=version+1 WHERE id=? AND player_id=? AND status='owned'", [selected.instanceId, actor.player_id]);
          status = "selected";
          data = `[${actor.rank_emoji ?? ""}${actor.current_display_name}] 님의 **펫 타이틀**이\n[${selected.displayName}] (으)로 적용되었습니다.`;
        } else {
          await transaction.execute("UPDATE player_pet_title_instances SET status='removed',equipped=FALSE,version=version+1 WHERE id=? AND player_id=? AND status='owned'", [selected.instanceId, target.player_id]);
          status = "removed";
          data = `[${target.rank_emoji ?? ""}${target.current_display_name}] 님의\n[${selected.displayName}] 펫 타이틀이 제거되었습니다.`;
        }
      }

      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })],
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, commandCode(command), operation.insertId],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at)
         VALUES (?,?,?,?,?,'pet_title.lifecycle','success',?, ?,UTC_TIMESTAMP(3))`,
        [operation.insertId, operatorId === null ? "external_identity" : "admin_operator", operatorId ?? actor.identity_id, "player", target.player_id, `Iris ${input.message}`, JSON.stringify({ kind: command.kind, instanceId: instanceId?.toString() ?? null })],
      );
      const result: PetTitleLifecycleResult = { status, data, outboxId: outbox.insertId.toString(), playerId: target.player_id.toString(), ...(instanceId === undefined ? {} : { instanceId: instanceId.toString() }) };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  private async titleRows(transaction: DatabaseTransaction, playerId: bigint): Promise<PetTitleListRow[]> {
    return transaction.query<PetTitleListRow[]>(
      `SELECT id AS instanceId,display_name AS displayName,price_digits AS priceDigits,acquired_at AS acquiredAt,equipped
         FROM player_pet_title_instances WHERE player_id=? AND status='owned' ORDER BY display_order,id FOR UPDATE`, [playerId],
    );
  }
}
