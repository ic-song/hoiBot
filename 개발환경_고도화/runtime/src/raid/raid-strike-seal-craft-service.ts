import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { createRequestReuseEnvelope, type RequestReuseEnvelope } from "../shared/request-reuse-contract.js";
import { RaidStrikeSealCanonicalOwnershipProvider, RAID_STRIKE_SEAL_SOURCE_LOCATOR } from "./raid-strike-seal-canonical-ownership-provider.js";

const JUNK_ITEM_CODE = "legacy-junk-item";
const JUNK_PER_SEAL = 1000n;
const POINT_PER_SEAL = 1000000000n;

export interface RaidStrikeSealCraftCommand {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface RaidStrikeSealCraftResult {
  status: "crafted" | "blocked_by_castle_siege";
  playerId?: string;
  craftQuantity?: string;
  junkQuantity?: string;
  pointBalance?: string;
  sealQuantity?: string;
  outboxId?: string;
  data?: string;
  auditId?: string;
  requestReuse?: RequestReuseEnvelope;
}

interface CraftOwnerRow {
  identity_id: bigint;
  player_id: bigint;
  canonical_player_id: string;
  current_display_name: string;
  tier_code: string | null;
}

// 인자 없는 명령과 숫자 수량 하나만 허용합니다.
export function isRaidStrikeSealCraftCommand(message: string | undefined): boolean {
  return message === "/레이드인장조합" || (message !== undefined && /^\/레이드인장조합\s+\d+$/.test(message));
}

// legacy 최소 수량 1을 보존하면서 안전한 bigint 수량으로 변환합니다.
function parseCraftQuantity(message: string): bigint {
  if (message === "/레이드인장조합") return 1n;
  const raw = message.trim().split(/\s+/)[1];
  if (raw === undefined) throw new ApplicationError("INVALID_RAID_STRIKE_SEAL_CRAFT_COMMAND", "정확한 /레이드인장조합 [수량]을 입력해주세요.", 422);
  const parsed = BigInt(raw);
  const quantity = parsed < 1n ? 1n : parsed;
  if (quantity > 1000000n) throw new ApplicationError("RAID_STRIKE_SEAL_CRAFT_LIMIT", "한 번에 조합할 수 있는 수량을 초과했습니다.", 422);
  return quantity;
}

// 긴 event ID를 operations idempotency 길이에 맞게 정규화합니다.
function normalizeEventKey(eventId: string): string {
  return eventId.length <= 191 ? eventId : `sha256:${createHash("sha256").update(eventId).digest("hex")}`;
}

// 공용 canonical inventory의 191자 request key 한계를 source event 전체 해시로 고정합니다.
function canonicalInventoryRequestKey(eventId: string): string {
  return `raid-strike-seal:${createHash("sha256").update(eventId).digest("hex")}`;
}

// MariaDB JSON 컬럼에서 재시도 결과를 복원합니다.
function parseStoredResult(value: string | RaidStrikeSealCraftResult): RaidStrikeSealCraftResult {
  return typeof value === "string" ? JSON.parse(value) as RaidStrikeSealCraftResult : value;
}

// 합성 fixture의 신규 등급 표시와 기존 일반 표시를 구분합니다.
function rankedName(owner: CraftOwnerRow): string {
  return `${owner.tier_code === "seedling" || owner.tier_code === "starter" ? "🌱" : ""}${owner.current_display_name}`;
}

// 정수 DECIMAL 문자열을 손실 없는 bigint로 변환합니다.
function decimalInteger(value: string): bigint {
  const match = /^(-?\d+)(?:\.0+)?$/.exec(value);
  if (match === null) throw new ApplicationError("NON_INTEGER_POINT_BALANCE", "포인트 금액을 정수로 확인할 수 없습니다.", 409);
  return BigInt(match[1]!);
}

// bigint 금액을 legacy 천 단위 쉼표 형식으로 표시합니다.
function withCommas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// 잡템·포인트 차감과 레이드 인장 지급을 양쪽 원장과 함께 저장합니다.
export class RaidStrikeSealCraftService {
  constructor(private readonly database: DatabaseClient,private readonly sealOwnership=new RaidStrikeSealCanonicalOwnershipProvider()) {}

  async handle(command: RaidStrikeSealCraftCommand): Promise<RaidStrikeSealCraftResult> {
    if (!isRaidStrikeSealCraftCommand(command.message)) {
      throw new ApplicationError("INVALID_RAID_STRIKE_SEAL_CRAFT_COMMAND", "정확한 /레이드인장조합 [수량]을 입력해주세요.", 422);
    }
    const craftQuantity = parseCraftQuantity(command.message);
    const requiredJunk = JUNK_PER_SEAL * craftQuantity;
    const requiredPoint = POINT_PER_SEAL * craftQuantity;

    return this.database.withTransaction(async (transaction) => {
      const activeSieges = await transaction.query<Array<{ active_count: bigint }>>(
        `SELECT COUNT(*) AS active_count FROM castle_battle_seasons
         WHERE status = 'active' AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP(3))
           AND (ends_at IS NULL OR ends_at >= UTC_TIMESTAMP(3))`
      );
      if ((activeSieges[0]?.active_count ?? 0n) > 0n) return { status: "blocked_by_castle_siege" };

      const owners = await transaction.query<CraftOwnerRow[]>(
        `SELECT identity.id AS identity_id, identity.player_id, crosswalk.player_id AS canonical_player_id,
                profile.current_display_name, profile.tier_code
         FROM external_identities identity
         JOIN player_profiles profile ON profile.player_id = identity.player_id
         JOIN canonical_player_identity_crosswalks crosswalk
           ON crosswalk.provider_code=identity.provider_code
          AND crosswalk.external_user_id=identity.external_user_id AND crosswalk.crosswalk_status='LINKED'
         JOIN canonical_players canonical_player ON canonical_player.player_id=crosswalk.player_id
         WHERE identity.provider_code = 'kakao' AND identity.external_user_id = ?
           AND identity.status = 'linked' AND identity.player_id IS NOT NULL
         FOR UPDATE`,
        [command.externalUserId]
      );
      const owner = owners[0];
      if (owner === undefined) throw new ApplicationError("PLAYER_IDENTITY_REQUIRED", "가입된 회원 정보를 찾을 수 없습니다.", 409);

      const scope = `raid.strike-seal.craft:${owner.identity_id}`;
      const eventKey = normalizeEventKey(command.eventId);
      const requestReuse = createRequestReuseEnvelope({
        scope, requestKey: eventKey, sourceEventId: eventKey,
        actor: { actorType: "external_identity", actorId: owner.identity_id.toString(), playerId: owner.canonical_player_id },
        operationKind: "RAID_STRIKE_SEAL_CRAFT", targetType: "ITEM_SOURCE_LOCATOR", targetId: RAID_STRIKE_SEAL_SOURCE_LOCATOR,
        payload: { channelId: command.channelId, message: command.message, craftQuantity: craftQuantity.toString() }
      });
      const prior = await transaction.query<Array<{ result_json: string | RaidStrikeSealCraftResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope = ? AND idempotency_key = ? FOR UPDATE",
        [scope, eventKey]
      );
      if (prior[0]?.result_json !== undefined && prior[0].result_json !== null) {
        const stored = parseStoredResult(prior[0].result_json);
        if (stored.requestReuse === undefined || stored.requestReuse.contractVersion !== requestReuse.contractVersion
          || stored.requestReuse.requestKey !== requestReuse.requestKey
          || stored.requestReuse.identityFingerprint !== requestReuse.identityFingerprint
          || stored.requestReuse.payloadFingerprint !== requestReuse.payloadFingerprint
          || stored.requestReuse.requestFingerprint !== requestReuse.requestFingerprint) {
          throw new ApplicationError("RAID_STRIKE_SEAL_REQUEST_REUSE_CONFLICT", "같은 요청의 조합 정보가 변경되었습니다.", 409);
        }
        return stored;
      }

      let sealDefinition:{itemId:string;raidCharmPerItem:600n};
      try{sealDefinition=await this.sealOwnership.resolve(transaction);}catch{
        throw new ApplicationError("RAID_STRIKE_SEAL_DEFINITION_DRIFT", "레이드타격대인장 설정값을 확인할 수 없습니다.", 409);
      }

      const stacks = await transaction.query<Array<{ item_id: bigint; code: string; quantity: bigint; version: bigint }>>(
        `SELECT stack.item_id, item.code, stack.quantity, stack.version
         FROM item_definitions item
         JOIN inventory_stacks stack ON stack.item_id = item.id AND stack.player_id = ?
         WHERE item.code = ? AND item.active = TRUE AND item.stackable = TRUE
         ORDER BY item.code FOR UPDATE`,
        [owner.player_id, JUNK_ITEM_CODE]
      );
      const junk = stacks.find((row) => row.code === JUNK_ITEM_CODE);
      if (junk === undefined || junk.quantity < requiredJunk) {
        throw new ApplicationError("JUNK_ITEM_REQUIRED", `잡템☠️ ${requiredJunk}개가 필요합니다!`, 409);
      }

      const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT CAST(balance AS CHAR) AS balance, version FROM currency_accounts WHERE player_id = ? AND currency_code = 'point' FOR UPDATE",
        [owner.player_id]
      );
      const account = accounts[0];
      const pointBalance = account === undefined ? 0n : decimalInteger(account.balance);
      if (account === undefined || pointBalance < requiredPoint) {
        throw new ApplicationError("POINT_REQUIRED", `🅟${withCommas(requiredPoint)} 포인트가 필요합니다!`, 409);
      }

      const operation = await transaction.execute(
        `INSERT INTO operations
          (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at)
         VALUES (?, ?, ?, 'external_identity', ?, 'iris', 'processing', UTC_TIMESTAMP(3))`,
        [randomUUID(), scope, eventKey, owner.identity_id]
      );
      const junkQuantity = junk.quantity - requiredJunk;
      const remainingPoint = pointBalance - requiredPoint;
      const junkUpdate = await transaction.execute(
        "UPDATE inventory_stacks SET quantity = ?, version = version + 1 WHERE player_id = ? AND item_id = ? AND version = ?",
        [junkQuantity, owner.player_id, junk.item_id, junk.version]
      );
      const pointUpdate = await transaction.execute(
        "UPDATE currency_accounts SET balance = ?, version = version + 1 WHERE player_id = ? AND currency_code = 'point' AND version = ?",
        [remainingPoint.toString(), owner.player_id, account.version]
      );
      if (junkUpdate.affectedRows !== 1n || pointUpdate.affectedRows !== 1n) {
        throw new ApplicationError("RAID_STRIKE_SEAL_CRAFT_CONFLICT", "재화 정보가 먼저 변경되었습니다.", 409);
      }
      const sealResult = await this.sealOwnership.changeResolved(transaction,{
        actor: "raid-strike-seal-craft",
        playerId: owner.canonical_player_id,itemId:sealDefinition.itemId,
        requestKey: canonicalInventoryRequestKey(command.eventId),
        quantityDelta: craftQuantity,
        reasonType: "RAID_STRIKE_SEAL_CRAFTED"
      });
      const sealQuantity = sealResult.quantity;
      await transaction.execute(
        `INSERT INTO inventory_ledger
          (operation_id, sequence_no, player_id, item_id, quantity_delta, reason_code)
         VALUES (?, 1, ?, ?, ?, 'raid_strike_seal_craft_material')`,
        [operation.insertId, owner.player_id, junk.item_id, (-requiredJunk).toString()]
      );
      await transaction.execute(
        `INSERT INTO currency_ledger
          (operation_id, sequence_no, player_id, currency_code, delta, balance_after, reason_code)
         VALUES (?, 1, ?, 'point', ?, ?, 'raid_strike_seal_craft_cost')`,
        [operation.insertId, owner.player_id, (-requiredPoint).toString(), remainingPoint.toString()]
      );

      const data = `[${rankedName(owner)}] 님\n레이드타격대인장👑(+600👾) ${craftQuantity}개 조합 완료!\n(레이드매력+/펫공격에 적용됩니다.)`;
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages
          (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at)
         VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [operation.insertId, command.channelId, JSON.stringify({ data })]
      );
      await transaction.execute(
        `INSERT INTO command_executions
          (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at)
         VALUES (?, 'raid_strike_seal_craft', ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [command.eventId, operation.insertId]
      );
      const audit = await transaction.execute(
        `INSERT INTO command_audit
          (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at)
         VALUES (?, 'external_identity', ?, 'player', ?, 'raid.strike_seal.craft', 'success', 'Iris /레이드인장조합', ?, UTC_TIMESTAMP(3))`,
        [operation.insertId, owner.identity_id, owner.player_id, JSON.stringify({
          craftQuantity: craftQuantity.toString(), junkQuantity: junkQuantity.toString(),
          pointBalance: remainingPoint.toString(), sealQuantity: sealQuantity.toString()
        })]
      );
      const result: RaidStrikeSealCraftResult = {
        status: "crafted", playerId: owner.player_id.toString(), craftQuantity: craftQuantity.toString(),
        junkQuantity: junkQuantity.toString(), pointBalance: remainingPoint.toString(), sealQuantity: sealQuantity.toString(),
        outboxId: outbox.insertId.toString(), data, auditId: audit.insertId.toString(), requestReuse
      };
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.insertId]
      );
      return result;
    });
  }
}
