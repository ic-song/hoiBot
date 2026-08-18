import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import {
  PACKAGE_ADMIN_GRANT_COMMAND_CODE,
  PACKAGE_ADMIN_GRANT_ERRORS,
  buildPackageAdminGrantReply,
  type ParsedPackageAdminGrant
} from "./package-admin-grant-policy.js";
import type {
  PackageAdminGrantCommand,
  PackageAdminGrantDomainResult,
  PackageAdminGrantRepository,
  PackageAdminGrantStoredResult,
  PackageAdminGrantTransaction
} from "./package-admin-grant-repository.js";

const MAX_UNSIGNED_BIGINT = 18446744073709551615n;

interface CatalogEntry {
  listNumber: number;
  packageCode: string;
  bagItemCode: string;
}

function parseStored(value: string | PackageAdminGrantStoredResult): PackageAdminGrantStoredResult {
  return typeof value === "string" ? JSON.parse(value) as PackageAdminGrantStoredResult : value;
}

function parseJson(value: string | Record<string, unknown> | unknown[] | null): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function readCatalogEntries(value: unknown): CatalogEntry[] {
  if (!Array.isArray(value)) throw new ApplicationError("PACKAGE_CATALOG_INVALID", "패키지 카탈로그 설정이 올바르지 않습니다.", 409);
  const entries = value.map((entry) => {
    if (typeof entry !== "object" || entry === null) {
      throw new ApplicationError("PACKAGE_CATALOG_INVALID", "패키지 카탈로그 설정이 올바르지 않습니다.", 409);
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.listNumber !== "number" || !Number.isSafeInteger(row.listNumber) || row.listNumber < 1
      || typeof row.packageCode !== "string" || row.packageCode === ""
      || typeof row.bagItemCode !== "string" || row.bagItemCode === "") {
      throw new ApplicationError("PACKAGE_CATALOG_INVALID", "패키지 카탈로그 설정이 올바르지 않습니다.", 409);
    }
    return { listNumber: row.listNumber as number, packageCode: row.packageCode, bagItemCode: row.bagItemCode };
  });
  if (new Set(entries.map(({ listNumber }) => listNumber)).size !== entries.length) {
    throw new ApplicationError("PACKAGE_CATALOG_INVALID", "패키지 카탈로그 설정이 올바르지 않습니다.", 409);
  }
  return entries;
}

class MariaPackageAdminGrantTransaction implements PackageAdminGrantTransaction {
  constructor(private readonly transaction: DatabaseTransaction) {}

  async findAuthorizedOperator(externalUserId: string): Promise<{ id: string; name: string } | null> {
    const rows = await this.transaction.query<Array<{ operator_id: bigint; display_name: string }>>(
      `SELECT operator.id AS operator_id, identity.display_name
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id = identity.id
       JOIN admin_operators operator ON operator.id = mapping.operator_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
         AND identity.status = 'linked' AND operator.status = 'active'
         AND (
           EXISTS (
             SELECT 1 FROM admin_operator_roles operator_role
             JOIN admin_role_permissions role_permission ON role_permission.role_id = operator_role.role_id
             WHERE operator_role.operator_id = operator.id AND role_permission.permission_code = 'game.inventory.change'
           ) OR EXISTS (
             SELECT 1 FROM admin_operator_permission_overrides permission_override
             WHERE permission_override.operator_id = operator.id
               AND permission_override.permission_code = 'game.inventory.change' AND permission_override.effect = 'allow'
           )
         )
         AND NOT EXISTS (
           SELECT 1 FROM admin_operator_permission_overrides permission_override
           WHERE permission_override.operator_id = operator.id
             AND permission_override.permission_code = 'game.inventory.change' AND permission_override.effect = 'deny'
         )
       ORDER BY operator.id LIMIT 1 FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : { id: row.operator_id.toString(), name: row.display_name };
  }

  async findStoredResult(scope: string, key: string): Promise<PackageAdminGrantStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | PackageAdminGrantStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    return value === undefined || value === null ? null : parseStored(value);
  }

  async grant(operator: { id: string; name: string }, scope: string, key: string,
    command: PackageAdminGrantCommand, parsed: ParsedPackageAdminGrant): Promise<PackageAdminGrantDomainResult> {
    const catalogs = await this.transaction.query<Array<{
      id: bigint; version: bigint; entries_json: string | unknown[] | null;
    }>>(
      `SELECT config.id, config.version, value.json_value AS entries_json
       FROM configuration_sets config
       JOIN configuration_values value ON value.configuration_set_id = config.id
        AND value.config_key = 'package.catalog.entries' AND value.value_type = 'json'
       WHERE config.set_code = 'package-catalog' AND config.status = 'active'
         AND (config.effective_from IS NULL OR config.effective_from <= UTC_TIMESTAMP(3))
         AND (config.effective_to IS NULL OR config.effective_to > UTC_TIMESTAMP(3))
       ORDER BY config.version DESC LIMIT 1 FOR UPDATE`
    );
    const catalog = catalogs[0];
    if (catalog === undefined) throw new ApplicationError("PACKAGE_CATALOG_REQUIRED", "활성 패키지 카탈로그가 없습니다.", 409);
    const entries = readCatalogEntries(parseJson(catalog.entries_json));
    const entry = entries.find(({ listNumber }) => BigInt(listNumber) === parsed.listNumber);
    if (entry === undefined) return { status: "package_not_found", data: PACKAGE_ADMIN_GRANT_ERRORS.packageNumber };

    const packages = await this.transaction.query<Array<{ id: bigint; code: string; display_name: string; active: number | boolean }>>(
      "SELECT id, code, display_name, active FROM package_definitions WHERE code = ? FOR UPDATE", [entry.packageCode]
    );
    const packageRow = packages[0];
    if (packageRow === undefined) return { status: "package_not_found", data: PACKAGE_ADMIN_GRANT_ERRORS.packageNumber };
    if (!Boolean(packageRow.active)) return { status: "package_disabled", data: PACKAGE_ADMIN_GRANT_ERRORS.packageDisabled };

    const items = await this.transaction.query<Array<{
      id: bigint; code: string; display_name: string; metadata_json: string | Record<string, unknown> | null;
      active: number | boolean; stackable: number | boolean;
    }>>(
      "SELECT id, code, display_name, metadata_json, active, stackable FROM item_definitions WHERE code = ? FOR UPDATE",
      [entry.bagItemCode]
    );
    const item = items[0];
    const itemMetadata = item === undefined ? {} : parseJson(item.metadata_json) as Record<string, unknown>;
    if (item === undefined || !Boolean(item.active) || !Boolean(item.stackable)
      || itemMetadata.packageCode !== packageRow.code || itemMetadata.legacyBagKey !== item.display_name
      || item.display_name === "") {
      return { status: "package_name_invalid", data: PACKAGE_ADMIN_GRANT_ERRORS.packageName };
    }

    const targets = await this.transaction.query<Array<{ player_id: bigint; current_display_name: string }>>(
      "SELECT player_id, current_display_name FROM player_profiles WHERE current_display_name = ? ORDER BY player_id LIMIT 2 FOR UPDATE",
      [parsed.targetName]
    );
    if (targets.length !== 1) {
      return { status: "target_not_found", data: PACKAGE_ADMIN_GRANT_ERRORS.targetMissing(parsed.targetName) };
    }
    const target = targets[0]!;
    await this.transaction.execute(
      "INSERT IGNORE INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, 0, 0)",
      [target.player_id, item.id]
    );
    const stacks = await this.transaction.query<Array<{ quantity: bigint; version: bigint }>>(
      "SELECT quantity, version FROM inventory_stacks WHERE player_id = ? AND item_id = ? FOR UPDATE",
      [target.player_id, item.id]
    );
    const stack = stacks[0]!;
    if (stack.quantity > MAX_UNSIGNED_BIGINT - parsed.count) {
      throw new ApplicationError("PACKAGE_GRANT_QUANTITY_OVERFLOW", "지급 후 보유 수량이 저장 범위를 초과합니다.", 409);
    }
    const quantityAfter = stack.quantity + parsed.count;
    const initial = await this.transaction.execute(
      `INSERT IGNORE INTO operations
         (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at)
       VALUES (?, ?, ?, 'admin_operator', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))`,
      [randomUUID(), scope, key, operator.id, JSON.stringify({
        commandCode: PACKAGE_ADMIN_GRANT_COMMAND_CODE, catalogVersion: catalog.version.toString()
      })]
    );
    if (initial.affectedRows === 0n) {
      const stored = await this.findStoredResult(scope, key);
      if (stored === null) throw new ApplicationError("PACKAGE_GRANT_REPLAY_INCOMPLETE", "기존 지급 결과가 아직 완료되지 않았습니다.", 409);
      return { ...stored, duplicate: true };
    }
    const update = await this.transaction.execute(
      "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
      [quantityAfter, target.player_id, item.id, stack.version]
    );
    if (update.affectedRows !== 1n) throw new ApplicationError("PACKAGE_GRANT_STACK_CONFLICT", "패키지 수량이 먼저 변경되었습니다.", 409);
    await this.transaction.execute(
      `INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
       VALUES (?, 1, ?, ?, ?, 'package_admin_grant')`,
      [initial.insertId, target.player_id, item.id, parsed.count]
    );
    await this.transaction.execute(
      `INSERT INTO command_executions
         (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
       VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [command.eventId, PACKAGE_ADMIN_GRANT_COMMAND_CODE, initial.insertId]
    );
    const audit = await this.transaction.execute(
      `INSERT INTO command_audit
         (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
       VALUES (?, 'admin_operator', ?, 'player', ?, 'package.admin.grant', 'success', 'Iris /패키지지급', ?, UTC_TIMESTAMP(3))`,
      [initial.insertId, operator.id, target.player_id, JSON.stringify({
        commandCode: PACKAGE_ADMIN_GRANT_COMMAND_CODE, catalogVersion: catalog.version.toString(),
        listNumber: parsed.listNumber.toString(), packageCode: packageRow.code, packageName: packageRow.display_name,
        bagItemCode: item.code, targetName: target.current_display_name, count: parsed.count.toString(),
        quantityBefore: stack.quantity.toString(), quantityAfter: quantityAfter.toString()
      })]
    );
    const data = buildPackageAdminGrantReply({
      targetName: target.current_display_name, packageName: packageRow.display_name, count: parsed.count,
      quantityBefore: stack.quantity, quantityAfter, operatorName: operator.name
    });
    const outbox = await this.transaction.execute(
      `INSERT INTO outbox_messages
         (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
       VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [initial.insertId, command.channelId, JSON.stringify({ data, sequence: 1, kind: "package_admin_grant" })]
    );
    const result: PackageAdminGrantStoredResult = {
      status: "granted", operatorId: operator.id, operatorName: operator.name,
      playerId: target.player_id.toString(), targetName: target.current_display_name,
      packageCode: packageRow.code, packageName: packageRow.display_name, bagItemCode: item.code,
      catalogVersion: catalog.version.toString(), listNumber: parsed.listNumber.toString(), count: parsed.count.toString(),
      quantityBefore: stack.quantity.toString(), quantityAfter: quantityAfter.toString(),
      data, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString()
    };
    await this.transaction.execute(
      "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(result), initial.insertId]
    );
    return result;
  }
}

export class MariaPackageAdminGrantRepository implements PackageAdminGrantRepository {
  constructor(private readonly database: DatabaseClient) {}

  async withTransaction<T>(work: (transaction: PackageAdminGrantTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaPackageAdminGrantTransaction(transaction)));
  }
}
