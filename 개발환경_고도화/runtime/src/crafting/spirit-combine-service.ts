import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const FRAGMENT_CODE = "bag_9b3e69dbd2e91260";
const STONE_CODE = "bag_55b34cbde0088b29";
const FRAGMENTS_PER_STONE = 10n;

export interface SpiritCombineCommand { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface SpiritCombineResult {
  status: "crafted" | "blocked_by_castle_siege"; playerId?: string; craftQuantity?: string;
  fragmentQuantity?: string; stoneQuantity?: string; outboxId?: string; data?: string; auditId?: string;
}
interface OwnerRow { identity_id: bigint; player_id: bigint; current_display_name: string; tier_code: string | null; }
interface ItemRow { item_id: bigint; code: string; quantity: bigint | null; version: bigint | null; }

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isSpiritCombineCommand(message: string | undefined): boolean {
  return message === "/정령조합" || (message !== undefined && /^\/정령조합\s+\d+$/.test(message));
}

// legacy 기본 수량과 0개 조합 호환을 유지하고 과도한 단일 요청만 제한합니다.
function combineQuantity(message: string): bigint {
  if (message === "/정령조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_SPIRIT_COMBINE_COMMAND", "정확한 /정령조합 [수량]을 입력해주세요.", 422);
  const value = BigInt(raw);
  if (value > 1000000n) throw new ApplicationError("SPIRIT_COMBINE_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return value;
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 재시도 응답으로 복원합니다.
function stored(value: string | SpiritCombineResult): SpiritCombineResult {
  return typeof value === "string" ? JSON.parse(value) as SpiritCombineResult : value;
}

// 신규 등급의 씨앗 이모지와 일반 표시 이름을 만듭니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 정령조각 차감과 정령 강화석 지급을 원장·감사·응답과 한 트랜잭션에 저장합니다.
export class SpiritCombineService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: SpiritCombineCommand): Promise<SpiritCombineResult> {
    if (!isSpiritCombineCommand(command.message)) {
      throw new ApplicationError("INVALID_SPIRIT_COMBINE_COMMAND", "정확한 /정령조합 [수량]을 입력해주세요.", 422);
    }
    const count = combineQuantity(command.message);
    const requiredFragments = FRAGMENTS_PER_STONE * count;
    return this.database.withTransaction(async (tx) => {
      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `craft.spirit-combine:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<Array<{ result_json: string | SpiritCombineResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE", [scope, key]
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
      if (fragment === undefined || fragment.quantity === null || fragment.version === null || fragment.quantity === 0n || fragment.quantity < requiredFragments) {
        throw new ApplicationError("SPIRIT_FRAGMENT_REQUIRED", `정령조각🥀 ${requiredFragments}개가 필요해요!`, 409);
      }
      if (stone === undefined) throw new ApplicationError("SPIRIT_STONE_ITEM_REQUIRED", "정령 강화석🥀 설정을 찾을 수 없습니다.", 409);

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, owner.identity_id]
      );
      const fragmentAfter = fragment.quantity - requiredFragments;
      const stoneAfter = (stone.quantity ?? 0n) + count;
      const fragmentWrite = await tx.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [fragmentAfter, owner.player_id, fragment.item_id, fragment.version]
      );
      const stoneWrite = stone.quantity === null || stone.version === null
        ? await tx.execute("INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)", [owner.player_id, stone.item_id, stoneAfter])
        : await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [stoneAfter, owner.player_id, stone.item_id, stone.version]
        );
      if (fragmentWrite.affectedRows !== 1n || stoneWrite.affectedRows !== 1n) {
        throw new ApplicationError("SPIRIT_COMBINE_CONFLICT", "정령 재료 정보가 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, ?, 'spirit_combine_material'), (?, 2, ?, ?, ?, 'spirit_stone_crafted')",
        [operation.insertId, owner.player_id, fragment.item_id, (-requiredFragments).toString(), operation.insertId, owner.player_id, stone.item_id, count.toString()]
      );
      const data = `${count}개를 조합합니다\n[${ranked(owner)}] 님\n정령 강화석🥀 조합 ${count}개 완성`;
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'spirit_combine', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operation.insertId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'craft.spirit_combine', 'success', 'Iris /정령조합', ?, UTC_TIMESTAMP(3))",
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({ count: count.toString(), fragmentAfter: fragmentAfter.toString(), stoneAfter: stoneAfter.toString() })]
      );
      const result: SpiritCombineResult = {
        status: "crafted", playerId: owner.player_id.toString(), craftQuantity: count.toString(),
        fragmentQuantity: fragmentAfter.toString(), stoneQuantity: stoneAfter.toString(),
        outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString()
      };
      await tx.execute("UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
