import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetTitleSelectCommand {
  externalUserId: string; channelId: string; eventId: string; message: string; environmentCode: "prod" | "dev";
}
export interface MiniPetTitleSelectResult {
  status: "selected" | "ignored_missing_member" | "snapshot_required";
  data?: string; playerId?: string; titleId?: string; stableOwnedTitleId?: string;
  selectedIndex?: number; outboxId?: string; replayed?: boolean;
}
interface OwnedTitleRow {
  title_id: bigint; stable_owned_title_id: string; display_order: number; display_name: string; equipped: number;
}

// 1 이상의 완전한 숫자 인자 하나를 가진 명령만 변경 후보로 인정합니다.
export function isMiniPetTitleSelectCommand(message: string | undefined): boolean {
  return message !== undefined && /^\/미니펫타이틀\s+[1-9][0-9]*$/.test(message);
}

function selectedIndex(message: string): number {
  const match = /^\/미니펫타이틀\s+([1-9][0-9]*)$/.exec(message);
  if (match === null) throw new ApplicationError("INVALID_MINIPET_TITLE_SELECT_COMMAND", "사용법: /미니펫타이틀 [번호]", 422);
  return Number(match[1]);
}
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function stored(value: string | MiniPetTitleSelectResult): MiniPetTitleSelectResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetTitleSelectResult : value;
}

export class MiniPetTitleSelectService {
  constructor(private readonly database: DatabaseClient) {}

  // 소유 타이틀 순서와 단일 선택 행을 잠근 뒤 선택·감사·응답을 원자적으로 저장합니다.
  async execute(command: MiniPetTitleSelectCommand): Promise<MiniPetTitleSelectResult> {
    const index = selectedIndex(command.message);
    return this.database.withTransaction(async (tx) => {
      const environments = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE"
      );
      if (environments[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("MINIPET_TITLE_SELECT_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }
      const owners = await tx.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        "SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1 FOR UPDATE",
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };
      const scope = `mini_pet.title_select:${command.environmentCode}:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | MiniPetTitleSelectResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_TITLE_SELECT_PROCESSING", "타이틀 선택이 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }
      const titles = await tx.query<OwnedTitleRow[]>(
        `SELECT state.title_id,state.stable_owned_title_id,state.display_order,definition.display_name,owned.equipped
         FROM mini_pet_title_owned_states state
         JOIN player_titles owned ON owned.player_id=state.player_id AND owned.title_id=state.title_id
         JOIN title_definitions definition ON definition.id=state.title_id AND definition.scope_code='mini_pet' AND definition.active=TRUE
         WHERE state.player_id=? ORDER BY state.display_order,state.title_id FOR UPDATE`, [owner.player_id]
      );
      if (titles.length === 0) return { status: "snapshot_required", data: "미니펫 타이틀 목록을 먼저 확인해 주세요." };
      if (!titles.every((title, offset) => title.display_order === offset + 1)) {
        return { status: "snapshot_required", data: "미니펫 타이틀 목록 순서를 먼저 복구해 주세요." };
      }
      const target = titles[index - 1];
      if (target === undefined) throw new ApplicationError("MINIPET_TITLE_INDEX_OUT_OF_RANGE", "보유한 미니펫 타이틀 번호를 입력해 주세요.", 409);
      const selections = await tx.query<Array<{ title_id: bigint; version: bigint }>>(
        "SELECT title_id,version FROM mini_pet_title_selections WHERE player_id=? FOR UPDATE", [owner.player_id]
      );
      const before = selections[0];
      const operation = await tx.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(),scope,key,owner.identity_id]
      );
      if (before === undefined) {
        await tx.execute("INSERT INTO mini_pet_title_selections(player_id,title_id,stable_owned_title_id,version) VALUES(?,?,?,1)",
          [owner.player_id,target.title_id,target.stable_owned_title_id]);
      } else {
        const changed = await tx.execute(
          "UPDATE mini_pet_title_selections SET title_id=?,stable_owned_title_id=?,version=version+1,selected_at=UTC_TIMESTAMP(3) WHERE player_id=? AND version=?",
          [target.title_id,target.stable_owned_title_id,owner.player_id,before.version]
        );
        if (changed.affectedRows !== 1n) throw new ApplicationError("MINIPET_TITLE_SELECT_CONFLICT", "타이틀 선택이 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        `UPDATE player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id
         SET owned.equipped=(owned.title_id=?) WHERE owned.player_id=? AND definition.scope_code='mini_pet'`,
        [target.title_id,owner.player_id]
      );
      await tx.execute(
        "INSERT INTO mini_pet_title_selection_events(operation_id,player_id,before_title_id,after_title_id,stable_owned_title_id,selected_index) VALUES(?,?,?,?,?,?)",
        [operation.insertId,owner.player_id,before?.title_id??null,target.title_id,target.stable_owned_title_id,index]
      );
      const data=`✅ [${target.display_name}] 타이틀을 적용했습니다.`;
      const outbox=await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId,command.channelId,JSON.stringify({data})]);
      await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,'mini_pet_title_select',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [command.eventId,operation.insertId]);
      await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'external_identity',?,'player',?,'mini_pet.title_select','success','Iris /미니펫타이틀',?,UTC_TIMESTAMP(3))",
        [operation.insertId,owner.identity_id,owner.player_id,JSON.stringify({beforeTitleId:before?.title_id.toString()??null,afterTitleId:target.title_id.toString(),stableOwnedTitleId:target.stable_owned_title_id,selectedIndex:index})]);
      const result:MiniPetTitleSelectResult={status:"selected",data,playerId:owner.player_id.toString(),titleId:target.title_id.toString(),stableOwnedTitleId:target.stable_owned_title_id,selectedIndex:index,outboxId:outbox.insertId.toString(),replayed:false};
      await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);
      return result;
    });
  }
}
