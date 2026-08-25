import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

type LifecycleAction = "list" | "add" | "remove";
interface ParsedLifecycleCommand { action: LifecycleAction; targetName?: string; titleName?: string; index?: number; }
interface OwnedTitleRow {
  title_id: bigint; stable_owned_title_id: string; display_order: number; display_name: string;
  sale_price: string | number; selected: number;
}
interface Actor { actorType: "external_identity" | "admin_operator"; actorId: bigint; playerId?: bigint; }
export interface MiniPetTitleLifecycleCommand {
  externalUserId: string; channelId: string; eventId: string; message: string; environmentCode: "prod" | "dev";
}
export interface MiniPetTitleLifecycleResult {
  status: "completed" | "ignored_missing_member";
  action?: LifecycleAction; data?: string; playerId?: string; titleId?: string;
  stableOwnedTitleId?: string; selectedStableOwnedTitleId?: string | null;
  outboxId?: string; replayed?: boolean;
}

// 목록 exact, 추가의 쉼표 구분 자유문자열, 제거의 양수 번호 형식만 실행 후보로 인정합니다.
export function isMiniPetTitleLifecycleCommand(message: string | undefined): boolean {
  if (message === "/미니펫타이틀목록") return true;
  if (/^\/미니펫타이틀추가\s+[^,\s][^,]*?\s*,\s*\S(?:.*\S)?$/.test(message ?? "")) return true;
  return /^\/미니펫타이틀제거\s+[^,\s][^,]*?\s*,\s*[1-9][0-9]*$/.test(message ?? "");
}

function parseCommand(message: string): ParsedLifecycleCommand {
  if (message === "/미니펫타이틀목록") return { action: "list" };
  const add = /^\/미니펫타이틀추가\s+([^,\s][^,]*?)\s*,\s*(\S(?:.*\S)?)$/.exec(message);
  if (add !== null) return { action: "add", targetName: add[1]!.trim(), titleName: add[2]!.trim() };
  const remove = /^\/미니펫타이틀제거\s+([^,\s][^,]*?)\s*,\s*([1-9][0-9]*)$/.exec(message);
  if (remove !== null) return { action: "remove", targetName: remove[1]!.trim(), index: Number(remove[2]) };
  throw new ApplicationError("INVALID_MINIPET_TITLE_LIFECYCLE_COMMAND", "미니펫 타이틀 명령 형식을 확인해 주세요.", 422);
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function stored(value: string | MiniPetTitleLifecycleResult): MiniPetTitleLifecycleResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetTitleLifecycleResult : value;
}
function ensureContiguous(titles: OwnedTitleRow[]): void {
  if (!titles.every((title, offset) => title.display_order === offset + 1)) {
    throw new ApplicationError("MINIPET_TITLE_ORDER_REPAIR_REQUIRED", "미니펫 타이틀 목록 순서를 먼저 복구해 주세요.", 409);
  }
}
function formatList(titles: OwnedTitleRow[]): string {
  if (titles.length === 0) return "보유한 미니펫 타이틀이 없습니다.";
  return ["🏷️ 미니펫 타이틀 목록", ...titles.map((title) => `${title.display_order}. ${title.display_name}${Boolean(title.selected) ? " [적용중]" : ""}`)].join("\n");
}

export class MiniPetTitleLifecycleService {
  constructor(private readonly database: DatabaseClient) {}

  // 목록·추가·제거를 안정 소유 ID, 단일 선택, 감사와 outbox가 묶인 트랜잭션으로 실행합니다.
  async execute(command: MiniPetTitleLifecycleCommand): Promise<MiniPetTitleLifecycleResult> {
    const parsed = parseCommand(command.message);
    return this.database.withTransaction(async (tx) => {
      await this.requireEnvironment(tx, command.environmentCode);
      const actor = parsed.action === "list"
        ? await this.lockSelfActor(tx, command.externalUserId)
        : await this.lockAdminActor(tx, command.externalUserId, command.channelId, command.environmentCode);
      if (actor === null) {
        if (parsed.action === "list") return { status: "ignored_missing_member" };
        throw new ApplicationError("FORBIDDEN", "미니펫 타이틀 관리 권한 또는 허용 채널이 없습니다.", 403);
      }
      const scope = `mini_pet.title_lifecycle:${command.environmentCode}:${actor.actorType}:${actor.actorId}`;
      const prior = await tx.query<Array<{ result_json: string | MiniPetTitleLifecycleResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope,eventKey(command.eventId)]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_TITLE_LIFECYCLE_PROCESSING", "미니펫 타이틀 처리가 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }
      const target = parsed.action === "list"
        ? { playerId: actor.playerId!, displayName: "내" }
        : await this.lockTarget(tx, parsed.targetName!);
      if (target === null) throw new ApplicationError("MINIPET_TITLE_TARGET_NOT_FOUND", "대상 회원을 찾을 수 없습니다.", 404);
      const titles = await this.lockTitles(tx, target.playerId);
      ensureContiguous(titles);
      if (parsed.action === "list") return this.completeList(tx, command, actor, target.playerId, scope, titles);
      if (parsed.action === "add") return this.completeAdd(tx, command, actor, target, scope, titles, parsed.titleName!);
      return this.completeRemove(tx, command, actor, target, scope, titles, parsed.index!);
    });
  }

  private async requireEnvironment(tx: DatabaseTransaction, environmentCode: "prod" | "dev"): Promise<void> {
    const rows = await tx.query<Array<{ environment_code: string }>>(
      "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id=1 FOR UPDATE"
    );
    if (rows[0]?.environment_code !== environmentCode) throw new ApplicationError("MINIPET_TITLE_LIFECYCLE_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
  }

  private async lockSelfActor(tx: DatabaseTransaction, externalUserId: string): Promise<Actor | null> {
    const rows = await tx.query<Array<{ identity_id: bigint; player_id: bigint }>>(
      "SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL LIMIT 1 FOR UPDATE", [externalUserId]
    );
    return rows[0] === undefined ? null : { actorType: "external_identity", actorId: rows[0].identity_id, playerId: rows[0].player_id };
  }

  private async lockAdminActor(tx: DatabaseTransaction, externalUserId: string, channelId: string, environmentCode: string): Promise<Actor | null> {
    const rows = await tx.query<Array<{ operator_id: bigint }>>(
      `SELECT mapping.operator_id FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
       JOIN mini_pet_title_admin_channel_scopes channel_scope ON channel_scope.environment_code=? AND channel_scope.external_channel_id=? AND channel_scope.status='active'
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND (EXISTS (SELECT 1 FROM admin_operator_roles operator_role JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
                      JOIN admin_role_permissions permission ON permission.role_id=role.id
                      WHERE operator_role.operator_id=operator.id AND permission.permission_code='minipet.title.manage')
              OR EXISTS (SELECT 1 FROM admin_operator_permission_overrides permission_override
                         WHERE permission_override.operator_id=operator.id AND permission_override.permission_code='minipet.title.manage' AND permission_override.effect='allow'))
         AND NOT EXISTS (SELECT 1 FROM admin_operator_permission_overrides permission_override
                         WHERE permission_override.operator_id=operator.id AND permission_override.permission_code='minipet.title.manage' AND permission_override.effect='deny')
       LIMIT 1 FOR UPDATE`, [environmentCode,channelId,externalUserId]
    );
    return rows[0] === undefined ? null : { actorType: "admin_operator", actorId: rows[0].operator_id };
  }

  private async lockTarget(tx: DatabaseTransaction, targetName: string): Promise<{ playerId: bigint; displayName: string } | null> {
    const rows = await tx.query<Array<{ player_id: bigint; current_display_name: string }>>(
      "SELECT player_id,current_display_name FROM player_profiles WHERE current_display_name=? LIMIT 2 FOR UPDATE", [targetName]
    );
    if (rows.length > 1) throw new ApplicationError("MINIPET_TITLE_TARGET_AMBIGUOUS", "대상 회원 이름이 중복되었습니다.", 409);
    return rows[0] === undefined ? null : { playerId: rows[0].player_id, displayName: rows[0].current_display_name };
  }

  private lockTitles(tx: DatabaseTransaction, playerId: bigint): Promise<OwnedTitleRow[]> {
    return tx.query<OwnedTitleRow[]>(
      `SELECT state.title_id,state.stable_owned_title_id,state.display_order,state.sale_price,definition.display_name,
        (selection.stable_owned_title_id=state.stable_owned_title_id) selected
       FROM mini_pet_title_owned_states state
       JOIN player_titles owned ON owned.player_id=state.player_id AND owned.title_id=state.title_id
       JOIN title_definitions definition ON definition.id=state.title_id AND definition.scope_code='mini_pet'
       LEFT JOIN mini_pet_title_selections selection ON selection.player_id=state.player_id
       WHERE state.player_id=? ORDER BY state.display_order,state.title_id FOR UPDATE`, [playerId]
    );
  }

  private async start(tx: DatabaseTransaction, scope: string, command: MiniPetTitleLifecycleCommand, actor: Actor) {
    return tx.execute(
      "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,?,?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(),scope,eventKey(command.eventId),actor.actorType,actor.actorId]
    );
  }

  private async finish(tx: DatabaseTransaction, command: MiniPetTitleLifecycleCommand, actor: Actor, targetPlayerId: bigint, operationId: bigint, action: LifecycleAction, data: string, extra: Partial<MiniPetTitleLifecycleResult> = {}): Promise<MiniPetTitleLifecycleResult> {
    const outbox = await tx.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId,command.channelId,JSON.stringify({data})]);
    await tx.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,?,?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [command.eventId,`mini_pet_title_${action}`,operationId]);
    await tx.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,?,?,'player',?,?,'success',?,?,UTC_TIMESTAMP(3))", [operationId,actor.actorType,actor.actorId,targetPlayerId,`mini_pet.title_${action}`,`Iris ${command.message}`,JSON.stringify(extra)]);
    const result: MiniPetTitleLifecycleResult = { status: "completed", action, data, playerId: targetPlayerId.toString(), outboxId: outbox.insertId.toString(), replayed: false, ...extra };
    await tx.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result),operationId]);
    return result;
  }

  private async completeList(tx: DatabaseTransaction, command: MiniPetTitleLifecycleCommand, actor: Actor, playerId: bigint, scope: string, titles: OwnedTitleRow[]): Promise<MiniPetTitleLifecycleResult> {
    const operation = await this.start(tx, scope, command, actor);
    return this.finish(tx, command, actor, playerId, operation.insertId, "list", formatList(titles), {
      selectedStableOwnedTitleId: titles.find((title) => Boolean(title.selected))?.stable_owned_title_id ?? null
    });
  }

  private async completeAdd(tx: DatabaseTransaction, command: MiniPetTitleLifecycleCommand, actor: Actor, target: { playerId: bigint; displayName: string }, scope: string, titles: OwnedTitleRow[], titleName: string): Promise<MiniPetTitleLifecycleResult> {
    if (titles.some((title) => title.display_name === titleName)) throw new ApplicationError("MINIPET_TITLE_ALREADY_OWNED", "이미 보유한 미니펫 타이틀입니다.", 409);
    if (titles.length >= 1000) throw new ApplicationError("MINIPET_TITLE_CAPACITY_EXCEEDED", "미니펫 타이틀 보유 한도를 초과했습니다.", 409);
    const definitions = await tx.query<Array<{ id: bigint }>>("SELECT id FROM title_definitions WHERE scope_code='mini_pet' AND display_name=? ORDER BY id LIMIT 1 FOR UPDATE", [titleName]);
    let titleId = definitions[0]?.id;
    if (titleId === undefined) {
      const code = `mini_pet.dynamic.${createHash("sha256").update(titleName).digest("hex")}`;
      const created = await tx.execute("INSERT INTO title_definitions(code,display_name,scope_code,active) VALUES(?,?,'mini_pet',TRUE) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id),display_name=VALUES(display_name),active=TRUE", [code,titleName]);
      titleId = created.insertId;
    }
    const operation = await this.start(tx, scope, command, actor);
    const stableOwnedTitleId = randomUUID();
    const displayOrder = titles.length + 1;
    await tx.execute("INSERT INTO player_titles(player_id,title_id,acquired_at,equipped) VALUES(?,?,UTC_TIMESTAMP(3),?)", [target.playerId,titleId,titles.length === 0]);
    await tx.execute("INSERT INTO mini_pet_title_owned_states(player_id,title_id,stable_owned_title_id,display_order,sale_price) VALUES(?,?,?,?,10000000000.000)", [target.playerId,titleId,stableOwnedTitleId,displayOrder]);
    let selectedStableOwnedTitleId = titles.find((title) => Boolean(title.selected))?.stable_owned_title_id ?? null;
    if (titles.length === 0) {
      await tx.execute("INSERT INTO mini_pet_title_selections(player_id,title_id,stable_owned_title_id,version) VALUES(?,?,?,1)", [target.playerId,titleId,stableOwnedTitleId]);
      selectedStableOwnedTitleId = stableOwnedTitleId;
    }
    await tx.execute("INSERT INTO mini_pet_title_lifecycle_events(operation_id,actor_operator_id,player_id,title_id,stable_owned_title_id,action_code,title_name_snapshot,sale_price_snapshot,display_order,selected_before,selected_after_stable_owned_title_id) VALUES(?,?,?,?,?,'add',?,10000000000.000,?,FALSE,?)", [operation.insertId,actor.actorId,target.playerId,titleId,stableOwnedTitleId,titleName,displayOrder,selectedStableOwnedTitleId]);
    const data = `✅ ${target.displayName}님에게 [${titleName}] 미니펫 타이틀을 추가했습니다.`;
    return this.finish(tx, command, actor, target.playerId, operation.insertId, "add", data, { titleId: titleId.toString(), stableOwnedTitleId, selectedStableOwnedTitleId });
  }

  private async completeRemove(tx: DatabaseTransaction, command: MiniPetTitleLifecycleCommand, actor: Actor, targetPlayer: { playerId: bigint; displayName: string }, scope: string, titles: OwnedTitleRow[], index: number): Promise<MiniPetTitleLifecycleResult> {
    const target = titles[index - 1];
    if (target === undefined) throw new ApplicationError("MINIPET_TITLE_INDEX_OUT_OF_RANGE", "보유한 미니펫 타이틀 번호를 입력해 주세요.", 409);
    const selections = await tx.query<Array<{ stable_owned_title_id: string }>>("SELECT stable_owned_title_id FROM mini_pet_title_selections WHERE player_id=? FOR UPDATE", [targetPlayer.playerId]);
    const selectedBefore = selections[0]?.stable_owned_title_id === target.stable_owned_title_id;
    const selectedAfter = selectedBefore ? null : selections[0]?.stable_owned_title_id ?? null;
    const operation = await this.start(tx, scope, command, actor);
    if (selectedBefore) {
      await tx.execute("DELETE FROM mini_pet_title_selections WHERE player_id=?", [targetPlayer.playerId]);
      await tx.execute("UPDATE player_titles owned JOIN title_definitions definition ON definition.id=owned.title_id SET owned.equipped=FALSE WHERE owned.player_id=? AND definition.scope_code='mini_pet'", [targetPlayer.playerId]);
    }
    await tx.execute("DELETE FROM mini_pet_title_owned_states WHERE player_id=? AND stable_owned_title_id=?", [targetPlayer.playerId,target.stable_owned_title_id]);
    await tx.execute("DELETE FROM player_titles WHERE player_id=? AND title_id=?", [targetPlayer.playerId,target.title_id]);
    await tx.execute("UPDATE mini_pet_title_owned_states SET display_order=display_order-1,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND display_order>? ORDER BY display_order ASC", [targetPlayer.playerId,target.display_order]);
    await tx.execute("INSERT INTO mini_pet_title_lifecycle_events(operation_id,actor_operator_id,player_id,title_id,stable_owned_title_id,action_code,title_name_snapshot,sale_price_snapshot,display_order,selected_before,selected_after_stable_owned_title_id) VALUES(?,?,?,?,?,'remove',?,?,?,?,?)", [operation.insertId,actor.actorId,targetPlayer.playerId,target.title_id,target.stable_owned_title_id,target.display_name,target.sale_price,target.display_order,selectedBefore,selectedAfter]);
    const data = `✅ ${targetPlayer.displayName}님의 [${target.display_name}] 미니펫 타이틀을 제거했습니다.`;
    return this.finish(tx, command, actor, targetPlayer.playerId, operation.insertId, "remove", data, { titleId: target.title_id.toString(), stableOwnedTitleId: target.stable_owned_title_id, selectedStableOwnedTitleId: selectedAfter });
  }
}
