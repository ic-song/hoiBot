import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { formatDecimal3, parseDecimal3 } from "../shared/numeric-policy.js";
import { TransactionalOperationRunner, type OperationActor } from "../shared/transactional-operation.js";

interface GuildCommandBase { guildId: string; actorPlayerId: string; reason: string; reasonCode: string; idempotencyKey: string; actor: OperationActor; sourceCode: "admin_api" | "iris" | "discord" | "external_api" | "system"; }

// 길드 자원·창고·게시판 변경을 길드 회원 검증과 원장 기록을 포함해 처리합니다.
export class GuildService {
  private readonly operations: TransactionalOperationRunner;
  constructor(database: DatabaseClient) { this.operations = new TransactionalOperationRunner(database); }

  async adjustResource(command: GuildCommandBase & { currencyCode: string; delta: string; expectedVersion: string }): Promise<{ balance: string; version: string; auditId: string }> {
    const delta = parseDecimal3(command.delta, "delta"); if (delta === 0n) throw new ApplicationError("ZERO_GUILD_DELTA", "길드 자원 변경량은 0일 수 없습니다.", 422);
    return this.operations.run({ scope: `guild.resource:${command.guildId}:${command.currencyCode}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "guild.resource.adjust", targetType: "guild", targetId: command.guildId, reason: command.reason,
      outboxType: "guild.resource.changed" }, async (transaction, operationId) => {
      await this.requireMember(transaction, command.guildId, command.actorPlayerId);
      await transaction.execute("INSERT IGNORE INTO guild_resource_accounts (guild_id, currency_code, balance, version) VALUES (?, ?, 0, 0)", [command.guildId, command.currencyCode]);
      const rows = await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT balance, version FROM guild_resource_accounts WHERE guild_id = ? AND currency_code = ? FOR UPDATE", [command.guildId, command.currencyCode]);
      const account = rows[0]; if (account === undefined) throw new ApplicationError("GUILD_RESOURCE_NOT_FOUND", "길드 자원 계정을 만들 수 없습니다.", 404);
      if (account.version.toString() !== command.expectedVersion) throw new ApplicationError("GUILD_VERSION_CONFLICT", "길드 자원이 먼저 변경되었습니다.", 409);
      const balance = parseDecimal3(account.balance, "balance") + delta; if (balance < 0n) throw new ApplicationError("INSUFFICIENT_GUILD_RESOURCE", "길드 자원이 부족합니다.", 409);
      const version = account.version + 1n;
      await transaction.execute("UPDATE guild_resource_accounts SET balance = ?, version = ? WHERE guild_id = ? AND currency_code = ? AND version = ?", [formatDecimal3(balance), version, command.guildId, command.currencyCode, account.version]);
      await transaction.execute("INSERT INTO guild_resource_ledger (operation_id, sequence_no, guild_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, ?, ?, ?, ?)", [operationId, command.guildId, command.currencyCode, formatDecimal3(delta), formatDecimal3(balance), command.reasonCode]);
      return { result: { balance: formatDecimal3(balance), version: version.toString() }, changeSummary: { currencyCode: command.currencyCode, delta: formatDecimal3(delta), balance: formatDecimal3(balance) } };
    });
  }

  async changeWarehouseStack(command: GuildCommandBase & { itemCode: string; quantityDelta: string; expectedVersion: string }): Promise<{ quantity: string; version: string; auditId: string }> {
    if (!/^-?\d+$/.test(command.quantityDelta) || BigInt(command.quantityDelta) === 0n) throw new ApplicationError("INVALID_QUANTITY_DELTA", "수량 변경값은 0이 아닌 정수여야 합니다.", 422);
    const delta = BigInt(command.quantityDelta);
    return this.operations.run({ scope: `guild.warehouse:${command.guildId}:${command.itemCode}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "guild.warehouse.change", targetType: "guild", targetId: command.guildId, reason: command.reason,
      outboxType: "guild.warehouse.changed" }, async (transaction, operationId) => {
      await this.requireMember(transaction, command.guildId, command.actorPlayerId);
      const items = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM item_definitions WHERE code = ? AND active = TRUE AND stackable = TRUE", [command.itemCode]);
      if (items[0] === undefined) throw new ApplicationError("STACKABLE_ITEM_NOT_FOUND", "사용 가능한 stack 아이템을 찾을 수 없습니다.", 404);
      await transaction.execute("INSERT IGNORE INTO guild_warehouse_stacks (guild_id, item_id, quantity, version) VALUES (?, ?, 0, 0)", [command.guildId, items[0].id]);
      const rows = await transaction.query<Array<{ quantity: bigint; version: bigint }>>("SELECT quantity, version FROM guild_warehouse_stacks WHERE guild_id = ? AND item_id = ? FOR UPDATE", [command.guildId, items[0].id]);
      const stack = rows[0]!; if (stack.version.toString() !== command.expectedVersion) throw new ApplicationError("GUILD_VERSION_CONFLICT", "길드 창고가 먼저 변경되었습니다.", 409);
      const quantity = stack.quantity + delta; if (quantity < 0n) throw new ApplicationError("INSUFFICIENT_GUILD_ITEM", "길드 창고 수량이 부족합니다.", 409);
      const version = stack.version + 1n;
      await transaction.execute("UPDATE guild_warehouse_stacks SET quantity = ?, version = ? WHERE guild_id = ? AND item_id = ? AND version = ?", [quantity, version, command.guildId, items[0].id, stack.version]);
      await transaction.execute("INSERT INTO guild_warehouse_ledger (operation_id, sequence_no, guild_id, item_id, quantity_delta, quantity_after, reason_code) VALUES (?, 1, ?, ?, ?, ?, ?)", [operationId, command.guildId, items[0].id, delta, quantity, command.reasonCode]);
      return { result: { quantity: quantity.toString(), version: version.toString() }, changeSummary: { itemCode: command.itemCode, quantityDelta: delta.toString(), quantity: quantity.toString() } };
    });
  }

  async publishPost(command: GuildCommandBase & { body: string }): Promise<{ postId: string; auditId: string }> {
    const body = command.body.trim(); if (body === "" || body.length > 2000) throw new ApplicationError("INVALID_GUILD_POST", "게시글은 1~2000자여야 합니다.", 422);
    return this.operations.run({ scope: `guild.post:${command.guildId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "guild.post.publish", targetType: "guild", targetId: command.guildId, reason: command.reason,
      outboxType: "guild.post.published" }, async (transaction) => {
      await this.requireMember(transaction, command.guildId, command.actorPlayerId);
      const post = await transaction.execute("INSERT INTO guild_board_posts (guild_id, author_player_id, body) VALUES (?, ?, ?)", [command.guildId, command.actorPlayerId, body]);
      return { result: { postId: post.insertId.toString() }, changeSummary: { postId: post.insertId.toString() } };
    });
  }

  async assignMemberRole(command: GuildCommandBase & { memberPlayerId: string; roleCode: string; expectedGuildVersion: string }): Promise<{ memberPlayerId: string; roleCode: string; guildVersion: string; auditId: string }> {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(command.roleCode)) throw new ApplicationError("INVALID_GUILD_ROLE", "길드 역할 코드는 영문 소문자 코드여야 합니다.", 422);
    if (command.actor.type === "player") throw new ApplicationError("GUILD_ROLE_PERMISSION_REQUIRED", "관리자 또는 시스템만 역할을 변경할 수 있습니다.", 403);
    return this.operations.run({ scope: `guild.member.role:${command.guildId}:${command.memberPlayerId}`, idempotencyKey: command.idempotencyKey, actor: command.actor,
      sourceCode: command.sourceCode, actionCode: "guild.member.role.assign", targetType: "guild", targetId: command.guildId, reason: command.reason,
      outboxType: "guild.member.role.changed" }, async (transaction) => {
      const guilds = await transaction.query<Array<{ version: bigint }>>("SELECT version FROM guilds WHERE id = ? AND status = 'active' FOR UPDATE", [command.guildId]);
      const current = guilds[0]; if (current === undefined) throw new ApplicationError("GUILD_NOT_FOUND", "활성 길드를 찾을 수 없습니다.", 404);
      if (current.version.toString() !== command.expectedGuildVersion) throw new ApplicationError("GUILD_VERSION_CONFLICT", "길드 정보가 먼저 변경되었습니다.", 409);
      const roles = await transaction.query<Array<{ code: string }>>("SELECT code FROM guild_roles WHERE guild_id = ? AND code = ?", [command.guildId, command.roleCode]);
      if (roles[0] === undefined) throw new ApplicationError("GUILD_ROLE_NOT_FOUND", "길드 역할을 찾을 수 없습니다.", 404);
      const updated = await transaction.execute("UPDATE guild_members SET role_code = ? WHERE guild_id = ? AND player_id = ?", [command.roleCode, command.guildId, command.memberPlayerId]);
      if (updated.affectedRows !== 1n) throw new ApplicationError("GUILD_MEMBER_NOT_FOUND", "길드 회원을 찾을 수 없습니다.", 404);
      const version = current.version + 1n;
      await transaction.execute("UPDATE guilds SET version = ? WHERE id = ? AND version = ?", [version, command.guildId, current.version]);
      return { result: { memberPlayerId: command.memberPlayerId, roleCode: command.roleCode, guildVersion: version.toString() }, changeSummary: { memberPlayerId: command.memberPlayerId, roleCode: command.roleCode } };
    });
  }

  private async requireMember(transaction: import("../database.js").DatabaseTransaction, guildId: string, playerId: string): Promise<void> {
    const rows = await transaction.query<Array<{ player_id: bigint }>>("SELECT player_id FROM guild_members WHERE guild_id = ? AND player_id = ?", [guildId, playerId]);
    if (rows[0] === undefined) throw new ApplicationError("GUILD_MEMBERSHIP_REQUIRED", "길드 회원만 수행할 수 있습니다.", 403);
  }
}
