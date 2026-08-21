import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/고생하셨습니다";
const COMMAND_CODE = "admin_reward_package_open";
const CONSUMER = {
  code: "deputy_reward_package_3",
  displayName: "부방상여패키지3(/고생하셨습니다)",
  quantity: -1n
} as const;
const REWARDS = [
  { code: "pet_sweet_home_interior_shop", displayName: "펫스윗홈인테리어샵🖼️(/샵오픈)", quantity: 20000n },
  { code: "exploration_probability_up_20", displayName: "탐험확률UP🗻(20%)", quantity: 20n },
  { code: "guild_contribution_medal", displayName: "길드공헌훈장🌟(/길드공헌 숫자)", quantity: 30n },
  { code: "guild_warehouse_package", displayName: "길드창고패키지🧳(/길드창고패키지오픈", quantity: 1n },
  { code: "loudspeaker_notice", displayName: "확성기📢(/알림 내용 30자)", quantity: 5n }
] as const;

export interface RewardPackageOpenCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface RewardPackageOpenResult {
  status: "opened" | "package_required";
  playerId?: string;
  packageBefore?: string;
  packageAfter?: string;
  rewards?: Array<{ code: string; quantity: string; after: string }>;
  data: string;
  outboxId?: string;
  auditId?: string;
  duplicate?: boolean;
}

interface ActorRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
}

interface ItemRow {
  item_id: bigint;
  code: string;
  display_name: string;
  active: number | boolean;
  stackable: number | boolean;
  quantity: bigint | null;
  version: bigint | null;
}

// 정확한 무인자 명령만 신규 runtime dispatch 대상으로 허용합니다.
export function isRewardPackageOpenCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// 레거시 보상 순서와 줄바꿈을 그대로 유지한 성공 응답을 만듭니다.
export function buildRewardPackageOpenReply(displayName: string): string {
  const itemDetails = REWARDS.map((item) => item.displayName + " x " + item.quantity).join("\n");
  return displayName + " 님의 부방상여패키지🤫이 성공적으로 오픈되었습니다.\n"
    + "방을 위한 노고와 기여에 감사드립니다.\n\n획득한 아이템 목록:\n" + itemDetails;
}

// 긴 event ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// MariaDB JSON 결과를 중복 실행 결과로 복원합니다.
function stored(value: string | RewardPackageOpenResult): RewardPackageOpenResult {
  const result = typeof value === "string" ? JSON.parse(value) as RewardPackageOpenResult : value;
  return { ...result, duplicate: true };
}

// operation·실행·감사·outbox를 같은 transaction에 기록합니다.
async function persistResult(
  tx: DatabaseTransaction,
  input: RewardPackageOpenCommand,
  actor: ActorRow,
  operationId: bigint,
  result: RewardPackageOpenResult,
  resultCode: "opened" | "package_required"
): Promise<RewardPackageOpenResult> {
  const outbox = await tx.execute(
    "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [operationId, input.channelId, JSON.stringify({ data: result.data })]
  );
  await tx.execute(
    "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, ?, ?, 'completed', ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
    [input.eventId, COMMAND_CODE, operationId, resultCode]
  );
  const audit = await tx.execute(
    "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'inventory.reward_package_open', ?, 'Iris /고생하셨습니다', ?, UTC_TIMESTAMP(3))",
    [operationId, actor.identity_id, actor.player_id, resultCode, JSON.stringify({
      packageBefore: result.packageBefore ?? "0",
      packageAfter: result.packageAfter ?? "0",
      rewards: result.rewards ?? []
    })]
  );
  const completed = { ...result, outboxId: outbox.insertId.toString(), auditId: audit.insertId.toString() };
  await tx.execute(
    "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
    [JSON.stringify(completed), operationId]
  );
  return completed;
}

// 패키지 차감과 5종 보상 지급을 단일 DB transaction과 event 멱등 키로 처리합니다.
export class RewardPackageOpenService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: RewardPackageOpenCommand): Promise<RewardPackageOpenResult> {
    if (!isRewardPackageOpenCommand(input.message)) {
      throw new ApplicationError("INVALID_REWARD_PACKAGE_OPEN_COMMAND", "정확한 /고생하셨습니다 명령을 입력해주세요.", 422);
    }
    return this.database.withTransaction(async (tx) => {
      const actors = await tx.query<ActorRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name
           FROM external_identities identity
           JOIN player_profiles profile ON profile.player_id = identity.player_id
          WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
            AND identity.status = 'linked' AND identity.player_id IS NOT NULL FOR UPDATE`,
        [input.externalUserId]
      );
      const actor = actors[0];
      if (actor === undefined) {
        return { status: "package_required", data: "부방상여패키지를 소지하고 있지 않습니다." };
      }
      const scope = `inventory.reward-package-open:${actor.identity_id}`;
      const key = eventKey(input.eventId);
      const prior = await tx.query<Array<{ result_json: string | RewardPackageOpenResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, key]
      );
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);

      const definitions = [CONSUMER, ...REWARDS];
      const rows = await tx.query<ItemRow[]>(
        `SELECT item.id AS item_id, item.code, item.display_name, item.active, item.stackable,
                stack.quantity, stack.version
           FROM item_definitions item
           LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
          WHERE item.code IN (${definitions.map(() => "?").join(", ")})
          ORDER BY item.code FOR UPDATE`,
        [actor.player_id, ...definitions.map((item) => item.code)]
      );
      const byCode = new Map(rows.map((row) => [row.code, row]));
      for (const definition of definitions) {
        const row = byCode.get(definition.code);
        if (row === undefined || row.display_name !== definition.displayName || !Boolean(row.active) || !Boolean(row.stackable)) {
          throw new ApplicationError("REWARD_PACKAGE_ITEM_DEFINITION_INVALID", "부방상여패키지 아이템 설정이 올바르지 않습니다.", 409);
        }
      }

      const operation = await tx.execute(
        "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
        [randomUUID(), scope, key, actor.identity_id]
      );
      const consumer = byCode.get(CONSUMER.code)!;
      if (consumer.quantity === null || consumer.version === null || consumer.quantity < 1n) {
        return persistResult(tx, input, actor, operation.insertId, {
          status: "package_required",
          playerId: actor.player_id.toString(),
          packageBefore: "0",
          packageAfter: "0",
          rewards: [],
          data: "부방상여패키지를 소지하고 있지 않습니다."
        }, "package_required");
      }

      const packageAfter = consumer.quantity - 1n;
      const consumeWrite = packageAfter === 0n
        ? await tx.execute(
          "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
          [actor.player_id, consumer.item_id, consumer.version]
        )
        : await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [packageAfter, actor.player_id, consumer.item_id, consumer.version]
        );
      if (consumeWrite.affectedRows !== 1n) {
        throw new ApplicationError("REWARD_PACKAGE_INVENTORY_CONFLICT", "부방상여패키지 수량이 먼저 변경되었습니다.", 409);
      }
      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, -1, 'reward_package_consume')",
        [operation.insertId, actor.player_id, consumer.item_id]
      );

      const granted: Array<{ code: string; quantity: string; after: string }> = [];
      let sequence = 2;
      for (const reward of REWARDS) {
        const state = byCode.get(reward.code)!;
        const after = (state.quantity ?? 0n) + reward.quantity;
        if (state.quantity === null || state.version === null) {
          await tx.execute(
            "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
            [actor.player_id, state.item_id, after]
          );
        } else {
          const write = await tx.execute(
            "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
            [after, actor.player_id, state.item_id, state.version]
          );
          if (write.affectedRows !== 1n) {
            throw new ApplicationError("REWARD_PACKAGE_INVENTORY_CONFLICT", "보상 아이템 수량이 먼저 변경되었습니다.", 409);
          }
        }
        await tx.execute(
          "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, ?, ?, ?, ?, 'reward_package_grant')",
          [operation.insertId, sequence++, actor.player_id, state.item_id, reward.quantity]
        );
        granted.push({ code: reward.code, quantity: reward.quantity.toString(), after: after.toString() });
      }

      return persistResult(tx, input, actor, operation.insertId, {
        status: "opened",
        playerId: actor.player_id.toString(),
        packageBefore: consumer.quantity.toString(),
        packageAfter: packageAfter.toString(),
        rewards: granted,
        data: buildRewardPackageOpenReply(actor.current_display_name)
      }, "opened");
    });
  }
}
