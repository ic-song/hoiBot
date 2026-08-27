import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";

export interface DeveloperNoteEntry {
  version: string;
  releasedOn: string;
  changes: string[];
}

export interface DeveloperNoteReadResult {
  data: string;
  outboxId: string;
  entryCount: number;
  firstVersion: string | null;
  lastVersion: string | null;
}

// 인자가 없는 정확한 개발자노트 명령만 현대화 dispatch 후보로 허용합니다.
export function isDeveloperNoteReadCommand(message: string | undefined): boolean {
  return message === "/개발자노트";
}

// 같은 날짜의 항목을 한 날짜 구역으로 묶고 현재 노출 상한인 10개만 표시합니다.
export function formatDeveloperNotes(sourceEntries: readonly DeveloperNoteEntry[]): string {
  const entries = sourceEntries.slice(0, 10);
  if (entries.length === 0) return "📘 등록된 개발자 노트가 없습니다.";
  const lines = ["📘 호이봇 개발자노트", ""];
  let previousDate: string | undefined;
  entries.forEach((entry, entryIndex) => {
    if (entry.releasedOn !== previousDate) {
      if (previousDate !== undefined) lines.push("");
      lines.push(`📅 ${entry.releasedOn}`);
      previousDate = entry.releasedOn;
    }
    const version = entry.version.startsWith("ver_") ? entry.version : `ver_${entry.version}`;
    lines.push(version);
    if (entry.changes.length === 0) lines.push("• 변경 내용 없음");
    else entry.changes.forEach((change) => lines.push(`• ${change}`));
    if (entryIndex < entries.length - 1 && entries[entryIndex + 1]!.releasedOn === entry.releasedOn) lines.push("");
  });
  return lines.join("\n");
}

// 운영자 권한을 확인하고 최신 개발자노트 projection을 감사·outbox와 함께 원자 기록합니다.
export class DeveloperNoteReadService {
  constructor(private readonly database: DatabaseClient) {}

  async read(input: { eventId: string; externalUserId: string; destinationId: string }): Promise<DeveloperNoteReadResult | null> {
    const operator = (await this.database.query<Array<{ id: bigint }>>(
      `SELECT operator.id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=?
          AND identity.status='linked' AND operator.status='active'
          AND NOT EXISTS (
            SELECT 1 FROM admin_operator_permission_overrides denied
             WHERE denied.operator_id=operator.id AND denied.permission_code='developer_note.read' AND denied.effect='deny'
          )
          AND (
            EXISTS (
              SELECT 1 FROM admin_operator_permission_overrides allowed
               WHERE allowed.operator_id=operator.id AND allowed.permission_code='developer_note.read' AND allowed.effect='allow'
            )
            OR EXISTS (
              SELECT 1 FROM admin_operator_roles operator_role
              JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
              JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='developer_note.read'
               WHERE operator_role.operator_id=operator.id
            )
          )
        LIMIT 1`,
      [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;

    const idempotencyKey = input.eventId.length <= 191
      ? input.eventId
      : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
    return withDeadlockRetry(() => this.database.withTransaction(async (transaction) => {
      const previous = (await transaction.query<Array<{ result_json: string | DeveloperNoteReadResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='developer_note.read' AND idempotency_key=? FOR UPDATE",
        [idempotencyKey]
      ))[0];
      if (previous?.result_json != null) {
        return typeof previous.result_json === "string" ? JSON.parse(previous.result_json) : previous.result_json;
      }

      const operation = await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'developer_note.read',?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), idempotencyKey, operator.id]
      );
      const rows = await transaction.query<Array<{
        entry_id: bigint;
        version: string;
        released_on: string;
        change_index: number | null;
        change_text: string | null;
      }>>(
        `SELECT entry.id entry_id,entry.version,DATE_FORMAT(entry.released_on,'%Y-%m-%d') released_on,
                change_row.change_index,change_row.change_text
           FROM (
             SELECT id,version,released_on,entry_order
               FROM developer_note_entries
              WHERE active=TRUE
              ORDER BY entry_order ASC,id ASC
              LIMIT 10
           ) entry
           LEFT JOIN developer_note_changes change_row ON change_row.entry_id=entry.id
          ORDER BY entry.entry_order ASC,entry.id ASC,change_row.change_index ASC`
      );
      const entries: DeveloperNoteEntry[] = [];
      let currentId: string | undefined;
      for (const row of rows) {
        const rowId = row.entry_id.toString();
        if (rowId !== currentId) {
          entries.push({ version: row.version, releasedOn: row.released_on, changes: [] });
          currentId = rowId;
        }
        if (row.change_text !== null) entries.at(-1)!.changes.push(row.change_text);
      }
      const data = formatDeveloperNotes(entries);
      const outbox = await transaction.execute(
        "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [operation.insertId, input.destinationId, JSON.stringify({ data })]
      );
      await transaction.execute(
        "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'ADMIN_DEVELOPER_NOTE_READ',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
        [input.eventId, operation.insertId]
      );
      const summary = {
        readOnly: true,
        entryCount: entries.length,
        firstVersion: entries[0]?.version ?? null,
        lastVersion: entries.at(-1)?.version ?? null
      };
      await transaction.execute(
        "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'developer_note_catalog',NULL,'developer_note.read',?,'Iris /개발자노트',?,UTC_TIMESTAMP(3))",
        [operation.insertId, operator.id, entries.length === 0 ? "empty" : "success", JSON.stringify(summary)]
      );
      const result: DeveloperNoteReadResult = {
        data,
        outboxId: outbox.insertId.toString(),
        entryCount: entries.length,
        firstVersion: entries[0]?.version ?? null,
        lastVersion: entries.at(-1)?.version ?? null
      };
      await transaction.execute(
        "UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    }));
  }
}

// 서로 다른 event gap lock이 교차할 때 발생하는 MariaDB deadlock만 제한적으로 재시도합니다.
async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      const databaseError = error as { code?: unknown; errno?: unknown };
      if (attempt === 2 || (databaseError.code !== "ER_LOCK_DEADLOCK" && databaseError.errno !== 1213)) throw error;
    }
  }
  throw new Error("Developer note read deadlock retry exhausted.");
}
