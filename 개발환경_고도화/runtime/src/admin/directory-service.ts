import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export class AdminDirectoryService {
  constructor(private readonly database: DatabaseClient) {}

  async listGameServers(): Promise<Array<{ id: string; code: string; displayName: string; active: boolean; version: string }>> {
    const rows = await this.database.query<Array<{ id: bigint; code: string; display_name: string; active: number; version: bigint }>>(
      "SELECT id, code, display_name, active, version FROM game_servers ORDER BY id"
    );
    return rows.map((row) => ({ id: row.id.toString(), code: row.code, displayName: row.display_name, active: Boolean(row.active), version: row.version.toString() }));
  }

  async listExternalIdentities(status: string | undefined, limit: number, offset: number): Promise<{ items: Array<{ id: string; providerCode: string; externalUserId: string; displayName: string | null; playerId: string | null; status: string }>; total: number }> {
    const where = status === undefined || status === "" ? "" : " WHERE status = ?";
    const values: unknown[] = status === undefined || status === "" ? [] : [status];
    const rows = await this.database.query<Array<{ id: bigint; provider_code: string; external_user_id: string; display_name: string | null; player_id: bigint | null; status: string }>>(
      `SELECT id, provider_code, external_user_id, display_name, player_id, status
       FROM external_identities${where} ORDER BY id LIMIT ? OFFSET ?`, [...values, limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>(`SELECT COUNT(*) AS total FROM external_identities${where}`, values);
    return { items: rows.map((row) => ({ id: row.id.toString(), providerCode: row.provider_code, externalUserId: row.external_user_id, displayName: row.display_name, playerId: row.player_id?.toString() ?? null, status: row.status })), total: Number(counts[0]?.total ?? 0n) };
  }

  async approveIdentity(input: { identityId: string; playerId: string; actorId: string; reason: string; idempotencyKey: string }): Promise<{ identityId: string; playerId: string; auditId: string }> {
    return this.database.withTransaction(async (transaction) => {
      const scope = `identity.approve:${input.identityId}`;
      const previous = await transaction.query<Array<{ result_json: string | Record<string, string> }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, input.idempotencyKey]
      );
      if (previous[0]?.result_json !== undefined) {
        return typeof previous[0].result_json === "string" ? JSON.parse(previous[0].result_json) : previous[0].result_json as { identityId: string; playerId: string; auditId: string };
      }
      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'admin_operator', ?, 'admin_api', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, input.idempotencyKey, input.actorId]
      );
      const update = await transaction.execute(
        `UPDATE external_identities SET player_id = ?, status = 'linked', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'candidate'`,
        [input.playerId, input.identityId]
      );
      if (update.affectedRows !== 1n) throw new ApplicationError("IDENTITY_CANDIDATE_NOT_FOUND", "승인할 identity 후보가 없습니다.", 404);
      await transaction.execute(
        `UPDATE legacy_identity_map SET candidate_external_identity_id = ?, resolution_status = 'approved',
          approved_by = ?, approved_at = UTC_TIMESTAMP(3)
         WHERE player_id = ? AND resolution_status = 'unresolved'`,
        [input.identityId, input.actorId, input.playerId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, created_at)
         VALUES (?, 'admin_operator', ?, 'external_identity', ?, 'identity.approve', 'success', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, input.actorId, input.identityId, input.reason]
      );
      const result = { identityId: input.identityId, playerId: input.playerId, auditId: audit.insertId.toString() };
      await transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }

  async listAudit(limit: number, offset: number): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    const rows = await this.database.query<Array<{ id: bigint; operation_id: bigint; actor_type: string; actor_id: bigint | null; target_type: string | null; target_id: bigint | null; action_code: string; result_code: string; reason: string | null; created_at: Date }>>(
      `SELECT id, operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, created_at
       FROM command_audit ORDER BY id DESC LIMIT ? OFFSET ?`,
      [limit, offset]
    );
    const counts = await this.database.query<Array<{ total: bigint }>>("SELECT COUNT(*) AS total FROM command_audit");
    return { items: rows.map((row) => ({ id: row.id.toString(), operationId: row.operation_id.toString(), actorType: row.actor_type, actorId: row.actor_id?.toString() ?? null, targetType: row.target_type, targetId: row.target_id?.toString() ?? null, actionCode: row.action_code, resultCode: row.result_code, reason: row.reason, createdAt: row.created_at.toISOString() })), total: Number(counts[0]?.total ?? 0n) };
  }
}
