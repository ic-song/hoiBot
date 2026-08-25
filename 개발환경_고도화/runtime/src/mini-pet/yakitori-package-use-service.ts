import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const PACKAGE_CODE = "bag_yakitori_package_10";
const TICKET_CODE = "bag_3241894752b82f7a";
const PACKAGE_NAME = "태초야키토리 10세트🥩(/이랏싸이마쎄)";
const TICKET_NAME = "미니펫뽑기🐹(/미니펫오픈)";
const TICKET_REWARD = 1500n;
const MINI_PET_BAG_CAPACITY = 100n;
const YAKITORI_REWARD_VERSION = "yakitori-eccd437-v1";
const YAKITORI_DEFINITION_CODES = [
  "mini_pet_yakitori_01", "mini_pet_yakitori_02", "mini_pet_yakitori_03", "mini_pet_yakitori_04", "mini_pet_yakitori_05",
  "mini_pet_yakitori_06", "mini_pet_yakitori_07", "mini_pet_yakitori_08", "mini_pet_yakitori_09", "mini_pet_yakitori_10"
] as const;

export interface YakitoriPackageUseCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
  environmentCode: "prod" | "dev";
}

export interface YakitoriPackageUseResult {
  status: "opened" | "blocked_by_castle_siege" | "ignored_missing_member";
  playerId?: string;
  packageQuantity?: string;
  ticketQuantity?: string;
  ownedMiniPetIds?: string[];
  stableOwnedIds?: string[];
  outboxId?: string;
  auditId?: string;
  data?: string;
  replayed?: boolean;
}

interface OwnerRow {
  identity_id: bigint;
  player_id: bigint;
  current_display_name: string;
  tier_code: string | null;
}

interface ItemRow {
  item_id: bigint;
  code: string;
  quantity: bigint | null;
  version: bigint | null;
}

interface DefinitionRow {
  id: bigint;
  code: string;
  display_name: string;
}

interface OperationRow {
  id: bigint;
  status: string;
  result_json: string | YakitoriPackageUseResult | null;
  request_hash: string | null;
  stale_processing: number;
}

// 인자나 접미사 없는 야키토리 패키지 사용 명령만 허용합니다.
export function isYakitoriPackageUseCommand(message: string | undefined): boolean {
  return message === "/이랏싸이마쎄";
}

// event ID를 operations key 길이에 맞게 정규화합니다.
function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

// 동일 event의 의미가 바뀌었는지 확인할 canonical request hash를 만듭니다.
function requestHash(command: YakitoriPackageUseCommand): string {
  return createHash("sha256").update(JSON.stringify([
    command.environmentCode, command.externalUserId, command.channelId, command.message
  ])).digest("hex");
}

// MariaDB JSON 결과를 완료 replay 응답으로 복원합니다.
function stored(value: string | YakitoriPackageUseResult): YakitoriPackageUseResult {
  return typeof value === "string" ? JSON.parse(value) as YakitoriPackageUseResult : value;
}

// MariaDB unique 충돌만 기존 operation 재조회 경로로 전환합니다.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === "object" && error !== null
    && (("errno" in error && error.errno === 1062) || ("code" in error && error.code === "ER_DUP_ENTRY"));
}

// 기존 등급 표시의 씨앗 이모지와 회원명을 결합합니다.
function ranked(owner: OwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 야키토리 패키지 1개를 소비하고 티켓과 미니펫 10종을 원자적으로 지급합니다.
export class YakitoriPackageUseService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(command: YakitoriPackageUseCommand): Promise<YakitoriPackageUseResult> {
    if (!isYakitoriPackageUseCommand(command.message)) {
      throw new ApplicationError("INVALID_YAKITORI_PACKAGE_USE_COMMAND", "정확한 /이랏싸이마쎄를 입력해주세요.", 422);
    }
    const hash = requestHash(command);
    try {
      return await this.runTransaction(command, hash, false);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      return this.runTransaction(command, hash, true);
    }
  }

  private async runTransaction(
    command: YakitoriPackageUseCommand,
    hash: string,
    collisionReplay: boolean
  ): Promise<YakitoriPackageUseResult> {
    return this.database.withTransaction(async (tx) => {
      const environment = await tx.query<Array<{ environment_code: string }>>(
        "SELECT environment_code FROM mini_pet_projection_environment_identity WHERE singleton_id = 1 FOR UPDATE"
      );
      if (environment[0]?.environment_code !== command.environmentCode) {
        throw new ApplicationError("YAKITORI_ENVIRONMENT_MISMATCH", "요청 환경과 DB 환경이 일치하지 않습니다.", 409);
      }

      const siege = await tx.query<Array<{ active_count: bigint }>>(
        "SELECT COUNT(*) AS active_count FROM castle_battle_seasons WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3)) AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))"
      );
      if ((siege[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await tx.query<OwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, profile.current_display_name, profile.tier_code
         FROM external_identities identity JOIN player_profiles profile ON profile.player_id = identity.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ? AND identity.status = 'linked'
           AND identity.player_id IS NOT NULL FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) return { status: "ignored_missing_member" };

      const scope = `mini-pet.yakitori-package-use:${command.environmentCode}:${owner.identity_id}`;
      const key = eventKey(command.eventId);
      const prior = await tx.query<OperationRow[]>(
        `SELECT operation.id, operation.status, operation.result_json, execution.request_hash,
          CASE WHEN operation.status = 'processing' AND operation.created_at < UTC_TIMESTAMP(3) - INTERVAL 5 MINUTE THEN 1 ELSE 0 END AS stale_processing
         FROM operations operation
         LEFT JOIN yakitori_package_use_executions execution ON execution.operation_id = operation.id
         WHERE operation.idempotency_scope = ? AND operation.idempotency_key = ? FOR UPDATE`,
        [scope, key]
      );
      const replay = prior[0];
      if (replay?.result_json !== null && replay?.result_json !== undefined) {
        if (replay.request_hash !== hash) {
          throw new ApplicationError("YAKITORI_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
        }
        return { ...stored(replay.result_json), replayed: true };
      }
      if (replay !== undefined && replay.request_hash !== hash) {
        throw new ApplicationError("YAKITORI_REPLAY_MISMATCH", "동일 event의 요청 내용이 다릅니다.", 409);
      }
      if (replay !== undefined && replay.stale_processing !== 1) {
        throw new ApplicationError("YAKITORI_REPLAY_NOT_READY", "이전 패키지 사용 요청이 처리 중입니다.", 409);
      }
      if (collisionReplay && replay === undefined) {
        throw new ApplicationError("YAKITORI_REPLAY_EXECUTION_MISSING", "unique 충돌 후 기존 요청을 찾을 수 없습니다.", 409);
      }

      const operationId = replay?.id ?? await this.createOperation(tx, scope, key, owner.identity_id, command.environmentCode, hash);
      if (replay !== undefined) {
        const residual = await tx.query<Array<{ reward_count: bigint }>>(
          "SELECT COUNT(*) AS reward_count FROM yakitori_package_owned_rewards WHERE operation_id = ? FOR UPDATE",
          [operationId]
        );
        if ((residual[0]?.reward_count ?? 0n) !== 0n) {
          throw new ApplicationError("YAKITORI_STALE_PARTIAL_STATE", "부분 지급 흔적이 있어 자동 재시작하지 않았습니다.", 409);
        }
        await tx.execute(
          "UPDATE operations SET status = 'processing', result_json = NULL, created_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE id = ?",
          [operationId]
        );
        await tx.execute(
          "UPDATE yakitori_package_use_executions SET status = 'processing', started_at = UTC_TIMESTAMP(3), completed_at = NULL WHERE operation_id = ?",
          [operationId]
        );
      }

      const bagCounts = await tx.query<Array<{ bag_count: bigint }>>(
        "SELECT COUNT(*) AS bag_count FROM owned_mini_pets WHERE player_id = ? FOR UPDATE",
        [owner.player_id]
      );
      const currentCount = bagCounts[0]?.bag_count ?? 0n;
      if (currentCount + 10n > MINI_PET_BAG_CAPACITY) {
        throw new ApplicationError(
          "MINI_PET_BAG_CAPACITY_REQUIRED",
          `[${ranked(owner)}] 님의\n미니펫 가방 공간이 부족합니다.\n현재 보유: ${currentCount}마리\n필요 공간: 10칸\n[최대 100개 소지가능]`,
          409
        );
      }

      const items = await tx.query<ItemRow[]>(
        `SELECT item.id AS item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item
         LEFT JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code IN (?, ?) AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, PACKAGE_CODE, TICKET_CODE]
      );
      const packageItem = items.find((row) => row.code === PACKAGE_CODE);
      const ticketItem = items.find((row) => row.code === TICKET_CODE);
      const packageQuantity = packageItem?.quantity ?? 0n;
      if (packageItem === undefined || packageItem.version === null || packageQuantity < 1n) {
        throw new ApplicationError(
          "YAKITORI_PACKAGE_REQUIRED",
          `❌ [${ranked(owner)}] 님\n[${PACKAGE_NAME}] 아이템이 없습니다.\n(보유: ${packageQuantity}개)`,
          409
        );
      }
      if (ticketItem === undefined) {
        throw new ApplicationError("MINI_PET_TICKET_DEFINITION_REQUIRED", `${TICKET_NAME} 설정을 찾을 수 없습니다.`, 409);
      }

      const definitions = await tx.query<DefinitionRow[]>(
        `SELECT definition.id, definition.code, definition.display_name
           FROM mini_pet_catalog_entries entry
           JOIN mini_pet_definitions definition ON definition.id = entry.mini_pet_definition_id
          WHERE entry.environment_code = ? AND entry.pool_version = ?
            AND entry.allowed = TRUE AND definition.active = TRUE
          ORDER BY entry.source_order FOR UPDATE`,
        [command.environmentCode, YAKITORI_REWARD_VERSION]
      );
      if (definitions.length !== 10 || definitions.some((definition, index) => definition.code !== YAKITORI_DEFINITION_CODES[index])) {
        throw new ApplicationError("YAKITORI_MINI_PET_DEFINITIONS_REQUIRED", "야키토리 미니펫 10종 설정이 완전하지 않습니다.", 409);
      }
      const orderedDefinitions = definitions;

      const packageAfter = packageQuantity - 1n;
      const packageWrite = packageAfter === 0n
        ? await tx.execute(
          "DELETE FROM inventory_stacks WHERE player_id = ? AND item_id = ? AND version = ?",
          [owner.player_id, packageItem.item_id, packageItem.version]
        )
        : await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [packageAfter, owner.player_id, packageItem.item_id, packageItem.version]
        );
      if (packageWrite.affectedRows !== 1n) {
        throw new ApplicationError("YAKITORI_PACKAGE_USE_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      const ticketAfter = (ticketItem.quantity ?? 0n) + TICKET_REWARD;
      if (ticketItem.version === null) {
        const ticketWrite = await tx.execute(
          "INSERT INTO inventory_stacks (player_id, item_id, quantity, version) VALUES (?, ?, ?, 1)",
          [owner.player_id, ticketItem.item_id, ticketAfter]
        );
        if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("YAKITORI_PACKAGE_USE_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      } else {
        const ticketWrite = await tx.execute(
          "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
          [ticketAfter, owner.player_id, ticketItem.item_id, ticketItem.version]
        );
        if (ticketWrite.affectedRows !== 1n) throw new ApplicationError("YAKITORI_PACKAGE_USE_CONFLICT", "아이템 정보가 먼저 변경되었습니다.", 409);
      }

      const ownedMiniPetIds: string[] = [];
      const stableOwnedIds: string[] = [];
      for (let index = 0; index < orderedDefinitions.length; index += 1) {
        const definition = orderedDefinitions[index]!;
        const owned = await tx.execute(
          `INSERT INTO owned_mini_pets
            (player_id, mini_pet_definition_id, custom_name, progress, enhancement_level,
             battle_experience, castle_experience, raid_experience, equipped)
           VALUES (?, ?, ?, 0, 0, 1, 0, 0, FALSE)`,
          [owner.player_id, definition.id, definition.display_name]
        );
        const stableOwnedId = randomUUID();
        await tx.execute(
          "INSERT INTO yakitori_package_owned_rewards (operation_id, reward_ordinal, owned_mini_pet_id, stable_owned_id) VALUES (?, ?, ?, ?)",
          [operationId, index + 1, owned.insertId, stableOwnedId]
        );
        ownedMiniPetIds.push(owned.insertId.toString());
        stableOwnedIds.push(stableOwnedId);
      }

      await tx.execute(
        "INSERT INTO inventory_ledger (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code) VALUES (?, 1, ?, ?, -1, 'yakitori_package_use'), (?, 2, ?, ?, ?, 'yakitori_ticket_reward')",
        [operationId, owner.player_id, packageItem.item_id, operationId, owner.player_id, ticketItem.item_id, TICKET_REWARD]
      );

      const data = "🥩 태초야키토리 10세트 오픈 완료!\nhttps://ibb.co/vxStBNRt\n\n🎁 지급 미니펫 (태초 / 매력+1💕)\n🍢 태초꼬치\n🔥 태초야키\n♨️ 태초숯불꼬치\n🥢 태초한판꼬치\n🏮 태초꼬치집\n🐔 태초닭꼬치\n🔥 태초불향꼬치\n🍶 태초한잔꼬치\n🍻 태초꼬치포차\n🔥 태초직화꼬치\n\n🎟️ 추가지급: 미니펫뽑기🐹(/미니펫오픈) 1500개\n\n👉 /미니펫가방 으로 확인해주세요.";
      const outbox = await tx.execute(
        "INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [operationId, command.channelId, JSON.stringify({ data })]
      );
      await tx.execute(
        "INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, 'yakitori_package_use', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))",
        [command.eventId, operationId]
      );
      const audit = await tx.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'external_identity', ?, 'player', ?, 'mini_pet.yakitori_package_use', 'success', 'Iris /이랏싸이마쎄', ?, UTC_TIMESTAMP(3))",
        [operationId, owner.identity_id, owner.player_id, JSON.stringify({
          environmentCode: command.environmentCode,
          packageAfter: packageAfter.toString(),
          ticketReward: TICKET_REWARD.toString(),
          ticketAfter: ticketAfter.toString(),
          ownedMiniPetIds,
          stableOwnedIds
        })]
      );
      const result: YakitoriPackageUseResult = {
        status: "opened",
        playerId: owner.player_id.toString(),
        packageQuantity: packageAfter.toString(),
        ticketQuantity: ticketAfter.toString(),
        ownedMiniPetIds,
        stableOwnedIds,
        outboxId: outbox.insertId.toString(),
        auditId: audit.insertId.toString(),
        data
      };
      await tx.execute(
        "UPDATE yakitori_package_use_executions SET status = 'completed', completed_at = UTC_TIMESTAMP(3) WHERE operation_id = ?",
        [operationId]
      );
      await tx.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operationId]
      );
      return result;
    });
  }

  private async createOperation(
    tx: DatabaseTransaction,
    scope: string,
    key: string,
    identityId: bigint,
    environmentCode: "prod" | "dev",
    hash: string
  ): Promise<bigint> {
    const operation = await tx.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))",
      [randomUUID(), scope, key, identityId]
    );
    await tx.execute(
      "INSERT INTO yakitori_package_use_executions (operation_id, request_hash, environment_code) VALUES (?, ?, ?)",
      [operation.insertId, hash, environmentCode]
    );
    return operation.insertId;
  }
}
