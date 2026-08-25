import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export interface MiniPetOwnedSaleCommand {
  externalUserId: string;
  channelId: string;
  eventId: string;
  message: string;
  environmentCode: "prod" | "dev";
}

export interface MiniPetOwnedSaleResult {
  status: "sold" | "invalid_command" | "ignored_missing_member" | "snapshot_required" | "sale_blocked";
  data?: string;
  playerId?: string;
  stableOwnedId?: string;
  ownedMiniPetId?: string;
  pointDelta?: string;
  pointBalance?: string;
  outboxId?: string;
  replayed?: boolean;
}

interface TargetRow {
  identity_id: bigint; player_id: bigint; owned_mini_pet_id: bigint; mini_pet_definition_id: bigint;
  stable_owned_id: string; sort_index: number; state_code: string | null; lifecycle_version: bigint | null;
  protected: number; locked: number; bound: number; listed: number; equipped: number;
  title_count: bigint; display_name: string; point_price: string | null; sellable: number | null;
}

// 명령 후보는 정확한 기본형 또는 양의 가방번호 한 개만 허용합니다.
export function isMiniPetOwnedSaleCommand(message: string | undefined): boolean {
  return message === "/미니펫판매" || (message !== undefined && /^\/미니펫판매\s+[1-9][0-9]*$/.test(message));
}

// 판매 명령에서 양의 가방번호를 분리합니다.
export function parseMiniPetOwnedSaleCommand(message: string): number | null {
  const match = /^\/미니펫판매\s+([1-9][0-9]*)$/.exec(message);
  return match === null ? null : Number(match[1]);
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | MiniPetOwnedSaleResult): MiniPetOwnedSaleResult {
  return typeof value === "string" ? JSON.parse(value) as MiniPetOwnedSaleResult : value;
}

export class MiniPetOwnedSaleService {
  constructor(private readonly database: DatabaseClient) {}

  // stable owned ID로 한 미니펫을 판매하고 lifecycle·재화·감사·outbox를 원자 기록합니다.
  async execute(command: MiniPetOwnedSaleCommand): Promise<MiniPetOwnedSaleResult> {
    const sortIndex = parseMiniPetOwnedSaleCommand(command.message);
    if (sortIndex === null) return { status: "invalid_command", data: "사용법: /미니펫판매 [가방번호]" };
    return this.database.withTransaction(async (tx) => {
      const environment = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id = 1 FOR UPDATE"
      );
      if (environment[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("MINIPET_SALE_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }
      const owners = await tx.query<Array<{ identity_id: bigint; player_id: bigint }>>(
        `SELECT id AS identity_id, player_id FROM external_identities
         WHERE provider_code = 'kakao' AND external_user_id = ? AND status = 'linked'
           AND player_id IS NOT NULL LIMIT 1 FOR UPDATE`, [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };
      const scope = `mini_pet.owned_sale:${owner.player_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | MiniPetOwnedSaleResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
      );
      if (prior[0] !== undefined) {
        if (prior[0].result_json === null) throw new ApplicationError("MINIPET_SALE_PROCESSING", "판매 처리가 진행 중입니다.", 409);
        return { ...stored(prior[0].result_json), replayed: true };
      }
      const targets = await tx.query<TargetRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, owned.id AS owned_mini_pet_id,
          owned.mini_pet_definition_id, state.stable_owned_id, state.sort_index,
          lifecycle.state_code, lifecycle.version AS lifecycle_version,
          COALESCE(lifecycle.protected, FALSE) protected, COALESCE(lifecycle.locked, FALSE) locked,
          COALESCE(lifecycle.bound, FALSE) bound, COALESCE(lifecycle.listed, FALSE) listed,
          owned.equipped, COUNT(title.title_id) AS title_count,
          COALESCE(owned.custom_name, definition.display_name) AS display_name,
          policy.point_price, policy.sellable
         FROM external_identities identity
         JOIN mini_pet_inventory_owned_states state ON state.player_id = identity.player_id AND state.sort_index = ?
         JOIN owned_mini_pets owned ON owned.id = state.owned_mini_pet_id AND owned.player_id = identity.player_id
         JOIN mini_pet_definitions definition ON definition.id = owned.mini_pet_definition_id
         LEFT JOIN mini_pet_owned_lifecycle lifecycle ON lifecycle.owned_mini_pet_id = owned.id
         LEFT JOIN mini_pet_sale_policies policy ON policy.mini_pet_definition_id = owned.mini_pet_definition_id
         LEFT JOIN mini_pet_title_assignments title ON title.owned_mini_pet_id = owned.id
         WHERE identity.id = ?
         GROUP BY identity.id, identity.player_id, owned.id, owned.mini_pet_definition_id,
          state.stable_owned_id, state.sort_index, lifecycle.state_code, lifecycle.version,
          lifecycle.protected, lifecycle.locked, lifecycle.bound, lifecycle.listed,
          owned.equipped, owned.custom_name, definition.display_name, policy.point_price, policy.sellable
         FOR UPDATE`, [sortIndex, owner.identity_id]
      );
      const target = targets[0];
      if (target === undefined) return { status: "snapshot_required", data: "미니펫 가방을 다시 확인한 뒤 판매해 주세요." };
      if (target.state_code === "sold" || target.equipped || target.protected || target.locked
        || target.bound || target.listed || target.title_count > 0n || target.sellable !== 1 || target.point_price === null) {
        return { status: "sale_blocked", data: `${target.display_name}은(는) 판매할 수 없습니다.` };
      }
      const accountRows = await tx.query<Array<{ balance: string; version: bigint }>>(
        "SELECT balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
        [owner.player_id]
      );
      if (accountRows[0] === undefined) {
        await tx.execute("INSERT INTO currency_accounts (player_id, currency_code, balance, version) VALUES (?, 'point', 0, 1)", [owner.player_id]);
      }
      const account = accountRows[0] ?? { balance: "0", version: 1n };
      const pointDelta = BigInt(target.point_price.split(".")[0] ?? "0");
      const balance = BigInt(account.balance.split(".")[0] ?? "0") + pointDelta;
      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      await tx.execute(
        `INSERT INTO mini_pet_owned_lifecycle
          (owned_mini_pet_id, player_id, state_code, version) VALUES (?, ?, 'active', 1)
         ON DUPLICATE KEY UPDATE player_id = VALUES(player_id)`, [target.owned_mini_pet_id, owner.player_id]
      );
      const lifecycleWrite = await tx.execute(
        `UPDATE mini_pet_owned_lifecycle SET state_code = 'sold', version = version + 1, updated_at = UTC_TIMESTAMP(3)
         WHERE owned_mini_pet_id = ? AND player_id = ? AND state_code = 'active'
           AND protected = FALSE AND locked = FALSE AND bound = FALSE AND listed = FALSE`,
        [target.owned_mini_pet_id, owner.player_id]
      );
      if (lifecycleWrite.affectedRows !== 1n) throw new ApplicationError("MINIPET_SALE_CONFLICT", "미니펫 상태가 변경되어 판매하지 않았습니다.", 409);
      await tx.execute("UPDATE mini_pet_inventory_owned_states SET sort_index = NULL, version = version + 1 WHERE owned_mini_pet_id = ?", [target.owned_mini_pet_id]);
      await tx.execute("UPDATE mini_pet_inventory_owned_states SET sort_index = sort_index - 1, version = version + 1 WHERE player_id = ? AND sort_index > ? ORDER BY sort_index ASC", [owner.player_id, sortIndex]);
      const currencyWrite = await tx.execute(
        "UPDATE currency_accounts SET balance = ?, version = version + 1, updated_at = UTC_TIMESTAMP(3) WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [balance, owner.player_id, account.version]
      );
      if (currencyWrite.affectedRows !== 1n) throw new Error("Mini-pet sale point version conflict.");
      await tx.execute(
        "INSERT INTO currency_ledger (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code) VALUES (?, 1, ?, 'point', ?, ?, 'mini_pet_owned_sale')",
        [operation.insertId, owner.player_id, pointDelta, balance]
      );
      await tx.execute(
        "INSERT INTO mini_pet_sale_events (operation_id, owned_mini_pet_id, stable_owned_id, player_id, mini_pet_definition_id, point_proceeds) VALUES (?, ?, ?, ?, ?, ?)",
        [operation.insertId, target.owned_mini_pet_id, target.stable_owned_id, owner.player_id, target.mini_pet_definition_id, pointDelta]
      );
      const data = `${target.display_name}을(를) 판매했습니다.\n획득 포인트: ${pointDelta.toLocaleString("ko-KR")}P`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'mini_pet_owned_sale', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'owned_mini_pet', ?, 'mini_pet.owned_sale', 'success', 'Iris /미니펫판매', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, target.owned_mini_pet_id, JSON.stringify({ stableOwnedId: target.stable_owned_id, sortIndex, pointDelta: pointDelta.toString() })]
      );
      const result: MiniPetOwnedSaleResult = { status: "sold", data, playerId: owner.player_id.toString(),
        stableOwnedId: target.stable_owned_id, ownedMiniPetId: target.owned_mini_pet_id.toString(),
        pointDelta: pointDelta.toString(), pointBalance: balance.toString(), outboxId: outbox.insertId.toString(), replayed: false };
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
