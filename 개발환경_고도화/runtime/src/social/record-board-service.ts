import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

type Family = "add" | "read" | "important" | "delete";
type Parsed = { family: Family; body?: string; displayNumber?: number; valid: boolean };
interface Actor { identity_id: bigint; player_id: bigint; display_name: string }
interface Entry { id: bigint; author_name_snapshot: string; body: string; legacy_date: string; display_order: bigint; important: number | boolean; version: bigint }
interface Setting { broadcast_destination_id: string | null }
export interface RecordBoardResult { status: "added" | "listed" | "important_set" | "important_cleared" | "deleted" | "not_found" | "invalid"; data: string; action: Family; entryId: string | null; displayNumber: number | null; important: boolean | null; count: number; outboxIds: string[]; replayed?: boolean }

// 기록 명령 네 종류만 완전한 명령 경계로 후보 처리합니다.
export function isRecordBoardCommandCandidate(message: string | undefined): boolean {
  const value = message ?? "";
  return value === "/기록" || /^\/기록\s/.test(value) || value === "/기록실" || value === "/빌런" || /^\/빌런\s/.test(value) || value === "/기록삭제" || /^\/기록삭제\s/.test(value);
}

// 파라미터 명령을 DB command_aliases의 대표 명령으로 정규화합니다.
export function normalizeRecordBoardCommand(message: string | undefined): string | undefined {
  const parsed = parseRecordBoardCommand(message);
  if (parsed === null) return undefined;
  if (parsed.family === "add") return "/기록";
  if (parsed.family === "read") return "/기록실";
  if (parsed.family === "important") return "/빌런";
  return "/기록삭제";
}

// free-form 본문과 1-based 표시번호를 실행 전에 엄격하게 분리합니다.
export function parseRecordBoardCommand(message: string | undefined): Parsed | null {
  const value = message ?? "";
  if (value === "/기록실") return { family: "read", valid: true };
  if (value === "/기록") return { family: "add", valid: false };
  if (/^\/기록\s/.test(value)) {
    const body = value.replace(/^\/기록\s+/, "").trim().replace(/^凸+\s*/, "");
    return { family: "add", body, valid: body.length > 0 && body.length <= 16384 && !body.includes("\0") };
  }
  const numbered = value.match(/^\/(빌런|기록삭제)(?:\s+(\d+))?$/);
  if (numbered !== null) {
    const family: Family = numbered[1] === "빌런" ? "important" : "delete";
    if (numbered[2] === undefined) return { family, valid: false };
    const number = BigInt(numbered[2]);
    return number > 0n && number <= 4294967295n ? { family, displayNumber: Number(number), valid: true } : { family, valid: false };
  }
  return null;
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function commandCode(family: Family): string { return `SOCIAL_RECORD_BOARD_${family === "important" ? "IMPORTANT" : family.toUpperCase()}`; }
function scope(family: Family): string { return `social.record_board.${family}`; }
function guide(family: Family): string { if (family === "add") return "사용법: /기록 [내용]"; if (family === "important") return "사용법: /빌런 [기록번호]"; if (family === "delete") return "사용법: /기록삭제 [기록번호]"; return "📜 등록된 운영 기록이 없습니다."; }
function readProjection(entries: Entry[]): string { if (entries.length === 0) return "📜 등록된 운영 기록이 없습니다."; return `📜 운영 기록실\n\n${entries.map((entry, index) => `${index + 1}. ${entry.important ? "凸 " : ""}${entry.body}\n- ${entry.author_name_snapshot} (${entry.legacy_date})`).join("\n\n")}`; }

async function finish(transaction: DatabaseTransaction, input: { operationId: bigint; eventId: string; destinationId: string; actor: Actor; family: Family; status: RecordBoardResult["status"]; data: string; entry: Entry | null; displayNumber: number | null; count: number; broadcastDestinationId?: string | null; broadcastData?: string }): Promise<RecordBoardResult> {
  const outboxIds: string[] = [];
  if (input.broadcastDestinationId && input.broadcastDestinationId !== input.destinationId && input.broadcastData) {
    const broadcast = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.broadcastDestinationId, JSON.stringify({ data: input.broadcastData })]);
    outboxIds.push(broadcast.insertId.toString());
  }
  const reply = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.operationId, input.destinationId, JSON.stringify({ data: input.data })]);
  outboxIds.push(reply.insertId.toString());
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode(input.family), input.operationId, input.status]);
  const summary = { action: input.family, mutation: ["added", "important_set", "important_cleared", "deleted"].includes(input.status), entryId: input.entry?.id.toString() ?? null, displayNumber: input.displayNumber, count: input.count, important: input.entry === null ? null : Boolean(input.entry.important) };
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'community_record_entry',?,?,?,'Iris record board command',?,UTC_TIMESTAMP(3))", [input.operationId, input.actor.identity_id, input.entry?.id ?? null, scope(input.family), input.status, JSON.stringify(summary)]);
  const result: RecordBoardResult = { status: input.status, data: input.data, action: input.family, entryId: input.entry?.id.toString() ?? null, displayNumber: input.displayNumber, important: input.entry === null ? null : Boolean(input.entry.important), count: input.count, outboxIds };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 권한·안정 ID 해석·변경·감사·발신을 한 트랜잭션으로 처리합니다.
export class RecordBoardService {
  constructor(private readonly db: DatabaseClient) {}
  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<RecordBoardResult | null> {
    const parsed = parseRecordBoardCommand(input.message);
    if (parsed === null) return null;
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.withTransaction(async transaction => {
          const actors = await transaction.query<Actor[]>("SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' JOIN player_profiles profile ON profile.player_id=player.id JOIN admin_operator_external_identities link ON link.external_identity_id=identity.id JOIN admin_operators operator ON operator.id=link.operator_id AND operator.status='active' JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE JOIN admin_role_permissions role_permission ON role_permission.role_id=role.id AND role_permission.permission_code='social.record_board.manage' WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE", [input.externalUserId]);
          const actor = actors[0];
          if (actor === undefined) return null;
          const key = eventKey(input.eventId), idempotencyScope = scope(parsed.family);
          const prior = await transaction.query<Array<{ result_json: string | RecordBoardResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [idempotencyScope, key]);
          if (prior[0]?.result_json != null) { const result = typeof prior[0].result_json === "string" ? JSON.parse(prior[0].result_json) as RecordBoardResult : prior[0].result_json; return { ...result, replayed: true }; }
          const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), idempotencyScope, key, actor.identity_id]);
          if (!parsed.valid) {
            await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,actor_player_id,display_number) VALUES (?,?,?,?)", [operation.insertId, parsed.family, actor.player_id, parsed.displayNumber ?? null]);
            return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: parsed.family, status: "invalid", data: guide(parsed.family), entry: null, displayNumber: parsed.displayNumber ?? null, count: 0 });
          }
          if (parsed.family === "add") {
            await transaction.query<Entry[]>("SELECT id,author_name_snapshot,body,legacy_date,display_order,important,version FROM community_record_entries WHERE status='published' ORDER BY display_order,id FOR UPDATE");
            await transaction.execute("UPDATE community_record_entries SET display_order=display_order+1,updated_at=UTC_TIMESTAMP(3),version=version+1 WHERE status='published'");
            const inserted = await transaction.execute("INSERT INTO community_record_entries(author_player_id,author_name_snapshot,body,legacy_date,display_order,important,status) VALUES (?,?,?,DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 9 HOUR),'%Y%m%d'),1,FALSE,'published')", [actor.player_id, actor.display_name, parsed.body!]);
            const entry: Entry = { id: inserted.insertId, author_name_snapshot: actor.display_name, body: parsed.body!, legacy_date: "", display_order: 1n, important: false, version: 1n };
            await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,entry_id,actor_player_id,display_number,body_snapshot,important_after) VALUES (?,'add',?,?,1,?,FALSE)", [operation.insertId, entry.id, actor.player_id, entry.body]);
            const settings = await transaction.query<Setting[]>("SELECT broadcast_destination_id FROM community_record_board_settings WHERE id=1");
            return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: "add", status: "added", data: "운영 기록을 등록했습니다.", entry, displayNumber: 1, count: 1, broadcastDestinationId: settings[0]?.broadcast_destination_id, broadcastData: `📌 운영 기록\n${entry.body}` });
          }
          if (parsed.family === "read") {
            const entries = await transaction.query<Entry[]>("SELECT id,author_name_snapshot,body,legacy_date,display_order,important,version FROM community_record_entries WHERE status='published' AND deleted_at IS NULL ORDER BY display_order,id");
            await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,actor_player_id) VALUES (?,'read',?)", [operation.insertId, actor.player_id]);
            return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: "read", status: "listed", data: readProjection(entries), entry: null, displayNumber: null, count: entries.length });
          }
          const entries = await transaction.query<Entry[]>("SELECT id,author_name_snapshot,body,legacy_date,display_order,important,version FROM community_record_entries WHERE status='published' AND deleted_at IS NULL ORDER BY display_order,id LIMIT 1 OFFSET ? FOR UPDATE", [(parsed.displayNumber ?? 1) - 1]);
          const entry = entries[0];
          if (entry === undefined) {
            await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,actor_player_id,display_number) VALUES (?,?,?,?)", [operation.insertId, parsed.family, actor.player_id, parsed.displayNumber!]);
            return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: parsed.family, status: "not_found", data: "해당 기록번호를 찾을 수 없습니다.", entry: null, displayNumber: parsed.displayNumber!, count: 0 });
          }
          if (parsed.family === "important") {
            const before = Boolean(entry.important), after = !before;
            const updated = await transaction.execute("UPDATE community_record_entries SET important=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND version=?", [after, entry.id, entry.version]);
            if (updated.affectedRows !== 1n) throw new Error("Record board important version conflict.");
            entry.important = after;
            await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,entry_id,actor_player_id,display_number,body_snapshot,important_before,important_after) VALUES (?,'important',?,?,?,?,?,?)", [operation.insertId, entry.id, actor.player_id, parsed.displayNumber!, entry.body, before, after]);
            return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: "important", status: after ? "important_set" : "important_cleared", data: after ? "중요 기록으로 표시했습니다." : "중요 표시를 해제했습니다.", entry, displayNumber: parsed.displayNumber!, count: 1 });
          }
          const deleted = await transaction.execute("UPDATE community_record_entries SET status='deleted',deleted_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3),version=version+1 WHERE id=? AND version=?", [entry.id, entry.version]);
          if (deleted.affectedRows !== 1n) throw new Error("Record board delete version conflict.");
          await transaction.execute("INSERT INTO community_record_operations(operation_id,action_code,entry_id,actor_player_id,display_number,body_snapshot,important_before) VALUES (?,'delete',?,?,?,?,?)", [operation.insertId, entry.id, actor.player_id, parsed.displayNumber!, entry.body, Boolean(entry.important)]);
          return finish(transaction, { operationId: operation.insertId, eventId: input.eventId, destinationId: input.destinationId, actor, family: "delete", status: "deleted", data: "운영 기록을 삭제했습니다.", entry, displayNumber: parsed.displayNumber!, count: 1 });
        });
      } catch (error) { last = error; const code = (error as { code?: string }).code; if (code !== "ER_LOCK_DEADLOCK" && code !== "ER_LOCK_WAIT_TIMEOUT") throw error; }
    }
    throw last;
  }
}
