import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const FRAGMENT_CODE = "bag_9b3e69dbd2e91260";
const STONE_CODE = "bag_55b34cbde0088b29";
const FRAGMENTS_PER_STONE = 10n;

export type CombineAllVariant = "primary" | "secondary";
export interface CombineAllCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface CombineAllResult {
  status: "crafted" | "blocked_by_castle_siege" | "ignored_unregistered";
  variant: CombineAllVariant;
  playerId?: string;
  craftQuantity?: string;
  fragmentQuantity?: string;
  stoneQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
}
interface OwnerRow { identity_id: bigint; player_id: bigint; }
interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

// 두 legacy 전체조합 명령을 exact guard로 구분합니다.
export function readCombineAllVariant(message: string | undefined): CombineAllVariant | null {
  if (message === "/전체조합") return "primary";
  if (message === "/전체조합2") return "secondary";
  return null;
}

// 긴 provider event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | CombineAllResult): CombineAllResult {
  return typeof value === "string" ? JSON.parse(value) as CombineAllResult : value;
}

// 두 legacy 진입점의 서로 다른 guard를 보존하면서 최대 수량을 한 트랜잭션으로 조합합니다.
export class CombineAllService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: CombineAllCommand): Promise<CombineAllResult> {
    const variant = readCombineAllVariant(command.message);
    if (variant === null) {
      throw new ApplicationError("INVALID_COMBINE_ALL_COMMAND", "정확한 /전체조합 또는 /전체조합2를 입력해주세요.", 422);
    }

    return this.database.withTransaction(async (tx) => {
      if (variant === "primary") {
        const siege = await tx.query<Array<{ active_count: bigint }>>(
          "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
        );
        if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege", variant };
      }

      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id
         FROM external_identities identity
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_unregistered", variant };

      const scope = `craft.combine-all.${variant}:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | CombineAllResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) return stored(prior[0].result_json);

      const items = await tx.query<ItemRow[]>(
        `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE ORDER BY item.code FOR UPDATE`,
        [owner.player_id, FRAGMENT_CODE, STONE_CODE]
      );
      const fragment = items.find((row) => row.code === FRAGMENT_CODE);
      const stone = items.find((row) => row.code === STONE_CODE);
      if (fragment === undefined || fragment.quantity === null || fragment.version === null) {
        throw new ApplicationError("NO_COMBINABLE_SPIRIT_FRAGMENTS", "❌ 조합 가능한 재료가 없습니다.", 409);
      }
      const craftQuantity = fragment.quantity / FRAGMENTS_PER_STONE;
      if (craftQuantity === 0n) {
        throw new ApplicationError("NO_COMBINABLE_SPIRIT_FRAGMENTS", "❌ 조합 가능한 재료가 없습니다.", 409);
      }
      if (stone === undefined) {
        throw new ApplicationError("COMBINE_ALL_CATALOG_REQUIRED", "정령 조합 아이템 설정을 찾을 수 없습니다.", 409);
      }

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const requiredFragments = craftQuantity * FRAGMENTS_PER_STONE;
      const fragmentAfter = fragment.quantity - requiredFragments;
      const stoneAfter = (stone.quantity ?? 0n) + craftQuantity;
      const fragmentWrite = fragmentAfter === 0n
        ? await tx.execute(
          "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
          [owner.player_id, fragment.item_id, fragment.version]
        )
        : await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [fragmentAfter, owner.player_id, fragment.item_id, fragment.version]
        );
      const stoneWrite = stone.quantity === null || stone.version === null
        ? await tx.execute(
          "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
          [owner.player_id, stone.item_id, stoneAfter]
        )
        : await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [stoneAfter, owner.player_id, stone.item_id, stone.version]
        );
      if (fragmentWrite.affectedRows !== 1n || stoneWrite.affectedRows !== 1n) {
        throw new ApplicationError("COMBINE_ALL_CONFLICT", "정령 재료 정보가 먼저 변경되었습니다.", 409);
      }

      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'combine_all_material'), (?, 2, ?, ?, ?, 'combine_all_stone')",
        [operation.insertId, owner.player_id, fragment.item_id, (-requiredFragments).toString(), operation.insertId, owner.player_id, stone.item_id, craftQuantity.toString()]
      );
      const data = `🛠️ 전체 조합 결과\n- 정령 강화석🥀 x ${craftQuantity}`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      const commandCode = variant === "primary" ? "combine_all" : "combine_all_2";
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, commandCode, operation.insertId]
      );
      const actionCode = variant === "primary" ? "craft.combine_all" : "craft.combine_all_2";
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, ?, 'success', ?, ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, actionCode, `Iris ${command.message}`, JSON.stringify({ variant, craftQuantity: craftQuantity.toString(), fragmentAfter: fragmentAfter.toString(), stoneAfter: stoneAfter.toString() })]
      );
      const result: CombineAllResult = {
        status: "crafted", variant, playerId: owner.player_id.toString(), craftQuantity: craftQuantity.toString(),
        fragmentQuantity: fragmentAfter.toString(), stoneQuantity: stoneAfter.toString(),
        outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString()
      };
      await tx.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
