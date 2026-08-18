import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { OPEN_ALL_GUILD_WAREHOUSE_ITEM_CODES, OPEN_ALL_ITEMS, type OpenAllGuildState, type OpenAllPlan, type OpenAllState } from "./open-all-policy.js";
import type { OpenAllActor, OpenAllCommandRecord, OpenAllRepository, OpenAllRepositoryTransaction, OpenAllStoredResult } from "./open-all-repository.js";

interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }
interface GuildRow { guild_id: bigint; display_name: string; mark: string | null; level: number; max_members: number; version: bigint; }
interface GuildAccountRow { currency_code: string; balance: string; version: bigint; }
interface GuildWarehouseRow { code: string; item_id: bigint; quantity: bigint; version: bigint; }
interface MemberFoodRow { player_id: bigint; quantity: bigint; version: bigint; }

class MariaOpenAllTransaction implements OpenAllRepositoryTransaction {
  private items = new Map<string, ItemRow>();
  private pointBalance = 0n;
  private pointVersion = 0n;
  private guild: GuildRow | null = null;
  private guildAccounts = new Map<string, GuildAccountRow>();
  private guildWarehouse = new Map<string, GuildWarehouseRow>();
  private guildMemberIds: string[] = [];
  private memberFood = new Map<string, MemberFoodRow>();

  constructor(private readonly transaction: DatabaseTransaction) {}

  async isCastleSiegeActive(): Promise<boolean> {
    const rows = await this.transaction.query<Array<{ active_count: bigint }>>(
      "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
    );
    return (rows[0]?.active_count ?? 0n) > 0n;
  }

  async findActor(externalUserId: string): Promise<OpenAllActor | null> {
    const rows = await this.transaction.query<Array<{ identity_id: bigint; player_id: bigint; rank_label: string }>>(
      `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name AS rank_label
       FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
       WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
         AND identity.player_id IS NOT NULL FOR UPDATE`, [externalUserId]
    );
    const row = rows[0];
    return row === undefined ? null : { identityId: row.identity_id.toString(), playerId: row.player_id.toString(), rankLabel: row.rank_label };
  }

  async findStoredResult(scope: string, key: string): Promise<OpenAllStoredResult | null> {
    const rows = await this.transaction.query<Array<{ result_json: string | OpenAllStoredResult | null }>>(
      "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
    );
    const value = rows[0]?.result_json;
    if (value === undefined || value === null) return null;
    return typeof value === "string" ? JSON.parse(value) as OpenAllStoredResult : value;
  }

  async lockState(actor: OpenAllActor): Promise<OpenAllState> {
    const codes = [...new Set(OPEN_ALL_ITEMS.map((entry) => entry.code))].sort();
    const placeholders = codes.map(() => "?").join(", ");
    const rows = await this.transaction.query<ItemRow[]>(
      `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
       FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
       WHERE item.code IN (${placeholders}) AND item.active = TRUE AND item.stackable = TRUE
       ORDER BY item.code FOR UPDATE`, [actor.playerId, ...codes]
    );
    this.items = new Map(rows.map((row) => [row.code, row]));
    const missing = codes.filter((code) => !this.items.has(code));
    if (missing.length > 0) throw new ApplicationError("OPEN_ALL_CATALOG_REQUIRED", `전체오픈 아이템 설정을 찾을 수 없습니다: ${missing.join(", ")}`, 409);

    await this.transaction.execute("INSERT IGNORE INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)", [actor.playerId]);
    const pointRows = await this.transaction.query<Array<{ balance: string; version: bigint }>>(
      "SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE", [actor.playerId]
    );
    const point = pointRows[0];
    if (point === undefined) throw new ApplicationError("OPEN_ALL_POINT_ACCOUNT_REQUIRED", "포인트 계정을 찾을 수 없습니다.", 409);
    this.pointBalance = BigInt(point.balance.split(".")[0] ?? "0"); this.pointVersion = point.version;
    const guildRows = await this.transaction.query<GuildRow[]>(
      `SELECT guild.id AS guild_id, guild.display_name, guild.mark, guild.level, guild.max_members, guild.version
       FROM guild_members member JOIN guilds guild ON guild.id = member.guild_id
       WHERE member.player_id = ? AND guild.status = 'active' FOR UPDATE`, [actor.playerId]
    );
    this.guild = guildRows[0] ?? null;
    let guildState: OpenAllGuildState | null = null;
    if (this.guild !== null) {
      const guildId = this.guild.guild_id.toString();
      await this.transaction.execute(
        "INSERT IGNORE INTO player_counters (player_id, counter_code, period_key, value) VALUES (?, 'guild_contribution', 'lifetime', 0), (?, 'guild_contribution_use_count', 'lifetime', 0)",
        [actor.playerId, actor.playerId]
      );
      await this.transaction.query(
        "SELECT counter_code, value FROM player_counters WHERE player_id = ? AND counter_code IN ('guild_contribution', 'guild_contribution_use_count') AND period_key = 'lifetime' ORDER BY counter_code FOR UPDATE",
        [actor.playerId]
      );
      for (const currencyCode of ["guild_experience", "point"]) {
        await this.transaction.execute("INSERT IGNORE INTO guild_resource_accounts (guild_id, currency_code, balance, version) VALUES (?, ?, 0, 1)", [guildId, currencyCode]);
      }
      const accounts = await this.transaction.query<GuildAccountRow[]>(
        "SELECT currency_code, balance, version FROM guild_resource_accounts WHERE guild_id = ? AND currency_code IN ('guild_experience', 'point') ORDER BY currency_code FOR UPDATE", [guildId]
      );
      this.guildAccounts = new Map(accounts.map((entry) => [entry.currency_code, entry]));
      if (!this.guildAccounts.has("guild_experience") || !this.guildAccounts.has("point")) {
        throw new ApplicationError("OPEN_ALL_GUILD_RESOURCE_REQUIRED", "길드 자원 계정을 준비할 수 없습니다.", 409);
      }

      const warehouseCodes = Object.values(OPEN_ALL_GUILD_WAREHOUSE_ITEM_CODES).sort();
      for (const code of warehouseCodes) {
        await this.transaction.execute("INSERT IGNORE INTO guild_warehouse_stacks (guild_id, item_id, quantity, version) VALUES (?, ?, 0, 1)", [guildId, this.items.get(code)!.item_id]);
      }
      const warehouse = await this.transaction.query<GuildWarehouseRow[]>(
        `SELECT item.code, stack.item_id, stack.quantity, stack.version FROM guild_warehouse_stacks stack
         JOIN item_definitions item ON item.id = stack.item_id WHERE stack.guild_id = ? AND item.code IN (${warehouseCodes.map(() => "?").join(", ")})
         ORDER BY item.code FOR UPDATE`, [guildId, ...warehouseCodes]
      );
      this.guildWarehouse = new Map(warehouse.map((entry) => [entry.code, entry]));

      const members = await this.transaction.query<Array<{ player_id: bigint }>>(
        "SELECT player_id FROM guild_members WHERE guild_id = ? ORDER BY player_id FOR UPDATE", [guildId]
      );
      this.guildMemberIds = members.map((entry) => entry.player_id.toString());
      const petFoodItemId = this.items.get("pet_food")!.item_id;
      const foodRows = await this.transaction.query<MemberFoodRow[]>(
        `SELECT stack.player_id, stack.quantity, stack.version FROM inventory_stacks stack
         WHERE stack.item_id = ? AND stack.player_id IN (${members.map(() => "?").join(", ")}) ORDER BY stack.player_id FOR UPDATE`,
        [petFoodItemId, ...this.guildMemberIds]
      );
      this.memberFood = new Map(foodRows.map((entry) => [entry.player_id.toString(), entry]));
      guildState = { guildId, displayName: this.guild.display_name, mark: this.guild.mark ?? "", level: this.guild.level,
        experience: BigInt(this.guildAccounts.get("guild_experience")!.balance.split(".")[0] ?? "0"), maxMembers: this.guild.max_members,
        memberPlayerIds: this.guildMemberIds };
    }
    return { rankLabel: actor.rankLabel, point: this.pointBalance, guild: guildState,
      quantities: Object.fromEntries(rows.filter((row) => row.quantity !== null).map((row) => [row.code, row.quantity!])) };
  }

  async persist(actor: OpenAllActor, scope: string, key: string, command: OpenAllCommandRecord, plan: OpenAllPlan): Promise<OpenAllStoredResult> {
    const operation = await this.transaction.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, result_json, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', ?, UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key, actor.identityId, JSON.stringify({ randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes })]
    );
    let inventorySequence = 0;
    for (const code of Object.keys(plan.deltas).sort()) {
      const row = this.items.get(code)!; const after = plan.quantities[code] ?? 0n; const change = plan.deltas[code]!;
      if (row.quantity === null || row.version === null) {
        if (after > 0n) await this.transaction.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [actor.playerId, row.item_id, after]);
      } else if (after === 0n) {
        const write = await this.transaction.execute("DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?", [actor.playerId, row.item_id, row.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      } else {
        const write = await this.transaction.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?", [after, actor.playerId, row.item_id, row.version]);
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_INVENTORY_CONFLICT", "가방 정보가 먼저 변경되었습니다.", 409);
      }
      inventorySequence++;
      await this.transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'open_all')",
        [operation.insertId, inventorySequence, actor.playerId, row.item_id, change]);
    }

    if (plan.pointDelta !== 0n) {
      const balance = this.pointBalance + plan.pointDelta;
      const write = await this.transaction.execute("UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [balance, actor.playerId, this.pointVersion]);
      if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_POINT_CONFLICT", "포인트 정보가 먼저 변경되었습니다.", 409);
      await this.transaction.execute("INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'open_all')",
        [operation.insertId, actor.playerId, plan.pointDelta, balance]);
    }

    if (plan.guildMutation !== null) {
      if (this.guild === null || this.guild.guild_id.toString() !== plan.guildMutation.guildId) {
        throw new ApplicationError("OPEN_ALL_GUILD_CONFLICT", "길드 정보가 먼저 변경되었습니다.", 409);
      }
      await this.transaction.execute(
        "UPDATE player_counters SET value = value + ?, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND counter_code = 'guild_contribution' AND period_key = 'lifetime'",
        [plan.guildMutation.contributionDelta, actor.playerId]
      );
      await this.transaction.execute(
        "UPDATE player_counters SET value = value + ?, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND counter_code = 'guild_contribution_use_count' AND period_key = 'lifetime'",
        [plan.guildMutation.contributionUseCountDelta, actor.playerId]
      );

      let resourceSequence = 0;
      const resourceDeltas: Record<string, bigint> = {
        ...plan.guildMutation.resourceDeltas,
        guild_experience: plan.guildMutation.experienceDelta
      };
      for (const code of Object.keys(resourceDeltas).sort()) {
        const change = resourceDeltas[code]!; if (change === 0n) continue;
        const account = this.guildAccounts.get(code)!; const balance = BigInt(account.balance.split(".")[0] ?? "0") + change;
        const write = await this.transaction.execute(
          "UPDATE guild_resource_accounts SET balance = ?, version = version + 1 WHERE guild_id = ? AND currency_code = ? AND version = ?",
          [balance, this.guild.guild_id, code, account.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_GUILD_RESOURCE_CONFLICT", "길드 자원이 먼저 변경되었습니다.", 409);
        resourceSequence++;
        await this.transaction.execute(
          "INSERT INTO guild_resource_ledger (operation_id, sequence_no, guild_id, currency_code, delta, balance_after, reason_code) VALUES (?, ?, ?, ?, ?, ?, 'open_all')",
          [operation.insertId, resourceSequence, this.guild.guild_id, code, change, balance]
        );
      }

      if (plan.guildMutation.levelAfter !== this.guild.level || plan.guildMutation.maxMembersDelta !== 0) {
        const write = await this.transaction.execute(
          "UPDATE guilds SET level = ?, max_members = max_members + ?, version = version + 1 WHERE id = ? AND version = ?",
          [plan.guildMutation.levelAfter, plan.guildMutation.maxMembersDelta, this.guild.guild_id, this.guild.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_GUILD_CONFLICT", "길드 정보가 먼저 변경되었습니다.", 409);
      }

      let warehouseSequence = 0;
      for (const code of Object.keys(plan.guildMutation.warehouseDeltas).sort()) {
        const change = plan.guildMutation.warehouseDeltas[code]!; if (change === 0n) continue;
        const stack = this.guildWarehouse.get(code)!; const quantity = stack.quantity + change;
        const write = await this.transaction.execute(
          "UPDATE guild_warehouse_stacks SET quantity = ?, version = version + 1 WHERE guild_id = ? AND item_id = ? AND version = ?",
          [quantity, this.guild.guild_id, stack.item_id, stack.version]
        );
        if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_GUILD_WAREHOUSE_CONFLICT", "길드 창고가 먼저 변경되었습니다.", 409);
        warehouseSequence++;
        await this.transaction.execute(
          "INSERT INTO guild_warehouse_ledger (operation_id, sequence_no, guild_id, item_id, quantity_delta, quantity_after, reason_code) VALUES (?, ?, ?, ?, ?, ?, 'open_all')",
          [operation.insertId, warehouseSequence, this.guild.guild_id, stack.item_id, change, quantity]
        );
      }

      if (plan.guildMutation.memberPetFoodDelta > 0n) {
        const petFood = this.items.get("pet_food")!;
        for (const playerId of this.guildMemberIds) {
          if (playerId === actor.playerId) continue;
          const existing = this.memberFood.get(playerId);
          let after: bigint;
          if (existing === undefined) {
            after = plan.guildMutation.memberPetFoodDelta;
            await this.transaction.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [playerId, petFood.item_id, after]);
          } else {
            after = existing.quantity + plan.guildMutation.memberPetFoodDelta;
            const write = await this.transaction.execute("UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
              [after, playerId, petFood.item_id, existing.version]);
            if (write.affectedRows !== 1n) throw new ApplicationError("OPEN_ALL_GUILD_MEMBER_INVENTORY_CONFLICT", "길드원 가방이 먼저 변경되었습니다.", 409);
          }
          inventorySequence++;
          await this.transaction.execute("INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'open_all_guild_level')",
            [operation.insertId, inventorySequence, playerId, petFood.item_id, plan.guildMutation.memberPetFoodDelta]);
        }
      }
    }

    const outbox = await this.transaction.execute(
      "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [operation.insertId, command.channelId, JSON.stringify({ data: plan.reply, sequence: 1 })]
    );
    await this.transaction.execute(
      "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'open_all', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
      [command.eventId, operation.insertId]
    );
    const audit = await this.transaction.execute(
      "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.open_all', 'success', 'Iris /전체오픈', ?, UTC_TIMESTAMP(3))",
      [operation.insertId, actor.identityId, actor.playerId, JSON.stringify({ deltas: Object.fromEntries(Object.entries(plan.deltas).map(([code, value]) => [code, value.toString()])), pointDelta: plan.pointDelta.toString(), randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes, deferredGuildItems: plan.deferredGuildItems,
        guildMutation: plan.guildMutation === null ? null : { ...plan.guildMutation, contributionDelta: plan.guildMutation.contributionDelta.toString(), contributionUseCountDelta: plan.guildMutation.contributionUseCountDelta.toString(), experienceDelta: plan.guildMutation.experienceDelta.toString(), memberPetFoodDelta: plan.guildMutation.memberPetFoodDelta.toString(), resourceDeltas: Object.fromEntries(Object.entries(plan.guildMutation.resourceDeltas).map(([code, value]) => [code, value.toString()])), warehouseDeltas: Object.fromEntries(Object.entries(plan.guildMutation.warehouseDeltas).map(([code, value]) => [code, value.toString()])) } })]
    );
    const result: OpenAllStoredResult = { status: "opened", playerId: actor.playerId, data: plan.reply,
      outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString(), pointDelta: plan.pointDelta.toString(),
      randomTrace: plan.randomTrace, openedBoxes: plan.openedBoxes, deferredGuildItems: plan.deferredGuildItems };
    await this.transaction.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
    return result;
  }
}

export class MariaOpenAllRepository implements OpenAllRepository {
  constructor(private readonly database: DatabaseClient) {}
  async withTransaction<T>(work: (transaction: OpenAllRepositoryTransaction) => Promise<T>): Promise<T> {
    return this.database.withTransaction((transaction) => work(new MariaOpenAllTransaction(transaction)));
  }
}
