import { randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND_CODE = "ADMIN_LEGACY_DATA_CLEANUP";
const PERMISSION_CODE = "game.data.cleanup";
const ALLSEE = "\u200b".repeat(500);

export interface LegacyDataCleanupSummary {
  furnitureDisplayRemoved: string;
  furnitureNullRemoved: string;
  itemQuantityMoved: string;
  itemLogs: readonly string[];
  petSkillMoved: string;
  petCharRemoved: string;
  petSkillContainersRemoved: string;
  pointUserCount: string;
  pointRemovedMilli: string;
  pointLogs: readonly string[];
  legacyPassListsRemoved: string;
  userRingRemoved: string;
  ringRewardFlagsRemoved: string;
  ringLogs: readonly string[];
  guildRingGuildCount: string;
  guildRingQuantity: string;
  guildRingLogs: readonly string[];
}

export interface LegacyDataCleanupResult {
  message: string;
  outboxId: string;
  replayed: boolean;
  summary: LegacyDataCleanupSummary;
}

interface OperatorRow { operator_id: bigint }
interface ReplayRow { result_json: string }
interface MappingRow {
  mapping_order: number;
  source_display_name: string;
  target_display_name: string;
  target_item_id: bigint;
}
interface ItemStackRow {
  player_id: bigint;
  source_item_id: bigint;
  quantity: bigint;
  display_name: string;
}
interface PointRow {
  player_id: bigint;
  display_name: string;
  balance_before: string;
  balance_after: string;
  removed_fraction: string;
}
interface RingRow { player_id: bigint; display_name: string }
interface GuildRingRow {
  guild_id: bigint;
  item_id: bigint;
  quantity: bigint;
  display_name: string;
  guild_code: string;
}

// 관리자 권한과 재실행 키를 확인한 뒤 일곱 레거시 정리 단계를 하나의 DB 트랜잭션으로 실행합니다.
export class LegacyDataCleanupService {
  public constructor(private readonly database: DatabaseClient) {}

  public async execute(input: {
    eventId: string;
    externalUserId: string;
    destinationId: string;
  }): Promise<LegacyDataCleanupResult> {
    const operator = await this.findOperator(input.externalUserId);
    const existing = await this.database.query<ReplayRow[]>(
      "SELECT result_json FROM legacy_data_cleanup_runs WHERE request_key=?",
      [input.eventId],
    );
    if (existing[0]) {
      return { ...(JSON.parse(existing[0].result_json) as LegacyDataCleanupResult), replayed: true };
    }

    return this.database.withTransaction(async (transaction) => {
      const replay = await transaction.query<ReplayRow[]>(
        "SELECT result_json FROM legacy_data_cleanup_runs WHERE request_key=? FOR UPDATE",
        [input.eventId],
      );
      if (replay[0]) return { ...(JSON.parse(replay[0].result_json) as LegacyDataCleanupResult), replayed: true };

      const operation = await transaction.execute(
        `INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status)
         VALUES (?,'admin.legacy_data_cleanup',?,'admin_operator',?,'iris','processing')`,
        [randomUUID(), input.eventId, operator.operator_id],
      );
      const operationId = operation.insertId;
      const item = await this.cleanupItemNames(transaction, operationId);
      const point = await this.cleanupPointFractions(transaction, operationId);
      const ring = await this.cleanupLegacyPlayerRings(transaction, operationId);
      const guildRing = await this.cleanupLegacyGuildRings(transaction, operationId);
      const summary: LegacyDataCleanupSummary = {
        furnitureDisplayRemoved: "0",
        furnitureNullRemoved: "0",
        itemQuantityMoved: item.quantity.toString(),
        itemLogs: item.logs,
        petSkillMoved: "0",
        petCharRemoved: "0",
        petSkillContainersRemoved: "0",
        pointUserCount: point.userCount.toString(),
        pointRemovedMilli: point.removedMilli.toString(),
        pointLogs: point.logs,
        legacyPassListsRemoved: "0",
        userRingRemoved: ring.userCount.toString(),
        ringRewardFlagsRemoved: "0",
        ringLogs: ring.logs,
        guildRingGuildCount: guildRing.guildCount.toString(),
        guildRingQuantity: guildRing.quantity.toString(),
        guildRingLogs: guildRing.logs,
      };
      const message = buildLegacyDataCleanupMessage(summary);
      const outbox = await transaction.execute(
        `INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status)
         VALUES (?,'iris',?,'text',?,'pending')`,
        [operationId, input.destinationId, JSON.stringify({ room: input.destinationId, data: message })],
      );
      const result: LegacyDataCleanupResult = {
        message,
        outboxId: outbox.insertId.toString(),
        replayed: false,
        summary,
      };
      await transaction.execute(
        `INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,completed_at)
         VALUES (?,?,?,'completed','success',UTC_TIMESTAMP(3))`,
        [input.eventId, COMMAND_CODE, operationId],
      );
      await transaction.execute(
        `INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,change_summary_json)
         VALUES (?,'admin_operator',?,'legacy_dataset',NULL,?,'success',?)`,
        [operationId, operator.operator_id, COMMAND_CODE, JSON.stringify(summary)],
      );
      await transaction.execute(
        `INSERT INTO legacy_data_cleanup_runs(
           request_key,operation_id,operator_id,item_quantity_moved,point_user_count,point_removed,
           user_ring_removed,guild_ring_guild_count,guild_ring_quantity,result_json
         ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [input.eventId, operationId, operator.operator_id, item.quantity, point.userCount,
          formatMilliAsFixed(point.removedMilli), ring.userCount, guildRing.guildCount, guildRing.quantity,
          JSON.stringify(result)],
      );
      await transaction.execute(
        "UPDATE operations SET status='committed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",
        [JSON.stringify(result), operationId],
      );
      return result;
    });
  }

  // 연결된 Kakao identity와 RBAC 권한을 함께 확인해 레거시 Admin/Master 범위를 대체합니다.
  private async findOperator(externalUserId: string): Promise<OperatorRow> {
    const operators = await this.database.query<OperatorRow[]>(
      `SELECT mapping.operator_id
       FROM external_identities identity
       JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
       JOIN admin_operators operator ON operator.id=mapping.operator_id
       JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
       JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id
       WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
         AND operator.status='active' AND permission.permission_code=?
       ORDER BY mapping.operator_id LIMIT 1`,
      [externalUserId, PERMISSION_CODE],
    );
    if (!operators[0]) throw new ApplicationError("FORBIDDEN", "데이터 정리 권한이 없습니다.", 403);
    return operators[0];
  }

  // 구형 캐슬 아이템 스택을 영지 아이템으로 합치고 양쪽 수량 원장을 남깁니다.
  private async cleanupItemNames(transaction: DatabaseTransaction, operationId: bigint): Promise<{ quantity: bigint; logs: string[] }> {
    const mappings = await transaction.query<MappingRow[]>(
      `SELECT mapping.mapping_order,mapping.source_display_name,mapping.target_display_name,target.id AS target_item_id
       FROM legacy_data_cleanup_item_mappings mapping
       JOIN item_definitions target ON target.id=(
         SELECT MIN(candidate.id) FROM item_definitions candidate
         WHERE candidate.display_name=mapping.target_display_name AND candidate.active=TRUE
       )
       ORDER BY mapping.mapping_order FOR UPDATE`,
    );
    let quantity = 0n;
    let ledgerSequence = 0;
    let detailSequence = 0;
    const logs: string[] = [];
    for (const mapping of mappings) {
      const stacks = await transaction.query<ItemStackRow[]>(
        `SELECT stack.player_id,stack.item_id AS source_item_id,stack.quantity,profile.current_display_name AS display_name
         FROM inventory_stacks stack
         JOIN item_definitions source ON source.id=stack.item_id
         JOIN player_profiles profile ON profile.player_id=stack.player_id
         WHERE source.display_name=? AND stack.item_id<>?
         ORDER BY stack.player_id,stack.item_id FOR UPDATE`,
        [mapping.source_display_name, mapping.target_item_id],
      );
      for (const stack of stacks) {
        const targets = await transaction.query<Array<{ quantity: bigint }>>(
          "SELECT quantity FROM inventory_stacks WHERE player_id=? AND item_id=? FOR UPDATE",
          [stack.player_id, mapping.target_item_id],
        );
        if (targets[0]) {
          await transaction.execute(
            "UPDATE inventory_stacks SET quantity=quantity+?,version=version+1 WHERE player_id=? AND item_id=?",
            [stack.quantity, stack.player_id, mapping.target_item_id],
          );
        } else {
          await transaction.execute(
            "INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1)",
            [stack.player_id, mapping.target_item_id, stack.quantity],
          );
        }
        await transaction.execute(
          "DELETE FROM inventory_stacks WHERE player_id=? AND item_id=?",
          [stack.player_id, stack.source_item_id],
        );
        ledgerSequence += 1;
        await transaction.execute(
          `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)
           VALUES (?,?,?,?,?,'LEGACY_DATA_CLEANUP_SOURCE')`,
          [operationId, ledgerSequence, stack.player_id, stack.source_item_id, -stack.quantity],
        );
        ledgerSequence += 1;
        await transaction.execute(
          `INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code)
           VALUES (?,?,?,?,?,'LEGACY_DATA_CLEANUP_TARGET')`,
          [operationId, ledgerSequence, stack.player_id, mapping.target_item_id, stack.quantity],
        );
        detailSequence += 1;
        await transaction.execute(
          `INSERT INTO legacy_data_cleanup_item_changes(
             operation_id,sequence_no,player_id,source_item_id,target_item_id,quantity
           ) VALUES (?,?,?,?,?,?)`,
          [operationId, detailSequence, stack.player_id, stack.source_item_id, mapping.target_item_id, stack.quantity],
        );
        quantity += stack.quantity;
        logs.push(`${stack.display_name} : ${mapping.source_display_name} → ${mapping.target_display_name} x${formatInteger(stack.quantity)}`);
      }
    }
    return { quantity, logs };
  }

  // point 통화의 소수 부분을 SQL FLOOR 기준으로 제거하고 정확한 DECIMAL 원장을 기록합니다.
  private async cleanupPointFractions(transaction: DatabaseTransaction, operationId: bigint): Promise<{ userCount: bigint; removedMilli: bigint; logs: string[] }> {
    const rows = await transaction.query<PointRow[]>(
      `SELECT account.player_id,profile.current_display_name AS display_name,
              CAST(account.balance AS CHAR) AS balance_before,
              CAST(FLOOR(account.balance) AS CHAR) AS balance_after,
              CAST(account.balance-FLOOR(account.balance) AS CHAR) AS removed_fraction
       FROM currency_accounts account
       JOIN player_profiles profile ON profile.player_id=account.player_id
       WHERE account.currency_code='point' AND account.balance<>FLOOR(account.balance)
       ORDER BY account.player_id FOR UPDATE`,
    );
    let removedMilli = 0n;
    let sequence = 0;
    const logs: string[] = [];
    for (const row of rows) {
      await transaction.execute(
        `UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3)
         WHERE player_id=? AND currency_code='point'`,
        [row.balance_after, row.player_id],
      );
      sequence += 1;
      await transaction.execute(
        `INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code)
         VALUES (?,?,?,'point',-CAST(? AS DECIMAL(30,3)),?,'LEGACY_DATA_CLEANUP_POINT_FLOOR')`,
        [operationId, sequence, row.player_id, row.removed_fraction, row.balance_after],
      );
      await transaction.execute(
        `INSERT INTO legacy_data_cleanup_point_changes(
           operation_id,sequence_no,player_id,balance_before,balance_after,removed_fraction
         ) VALUES (?,?,?,?,?,?)`,
        [operationId, sequence, row.player_id, row.balance_before, row.balance_after, row.removed_fraction],
      );
      removedMilli += parseDecimalToMilli(row.removed_fraction);
      logs.push(`${row.display_name} : ${formatDecimalText(row.balance_before)} → ${formatDecimalText(row.balance_after)}`);
    }
    return { userCount: BigInt(rows.length), removedMilli, logs };
  }

  // 보상 snapshot은 보존하면서 레거시 반지 실재 여부만 제거 상태로 전환합니다.
  private async cleanupLegacyPlayerRings(transaction: DatabaseTransaction, operationId: bigint): Promise<{ userCount: bigint; logs: string[] }> {
    const rows = await transaction.query<RingRow[]>(
      `SELECT snapshot.player_id,profile.current_display_name AS display_name
       FROM player_legacy_ring_reward_snapshots snapshot
       JOIN player_profiles profile ON profile.player_id=snapshot.player_id
       WHERE snapshot.legacy_ring_present=TRUE
       ORDER BY snapshot.player_id FOR UPDATE`,
    );
    let sequence = 0;
    const logs: string[] = [];
    for (const row of rows) {
      await transaction.execute(
        `UPDATE player_legacy_ring_reward_snapshots
         SET legacy_ring_present=FALSE,version=version+1 WHERE player_id=? AND legacy_ring_present=TRUE`,
        [row.player_id],
      );
      sequence += 1;
      await transaction.execute(
        "INSERT INTO legacy_data_cleanup_ring_changes(operation_id,sequence_no,player_id) VALUES (?,?,?)",
        [operationId, sequence, row.player_id],
      );
      logs.push(`${row.display_name} : 반지 삭제`);
    }
    return { userCount: BigInt(rows.length), logs };
  }

  // 전용 레거시 길드 반지 스택을 삭제하고 펜던트로 이전하지 않은 음수 원장을 남깁니다.
  private async cleanupLegacyGuildRings(transaction: DatabaseTransaction, operationId: bigint): Promise<{ guildCount: bigint; quantity: bigint; logs: string[] }> {
    const rows = await transaction.query<GuildRingRow[]>(
      `SELECT stack.guild_id,stack.item_id,stack.quantity,guild.display_name,guild.code AS guild_code
       FROM guild_warehouse_stacks stack
       JOIN item_definitions item ON item.id=stack.item_id AND item.code='ITEM-LEGACY-GUILD-RING'
       JOIN guilds guild ON guild.id=stack.guild_id
       WHERE stack.quantity>0 ORDER BY stack.guild_id FOR UPDATE`,
    );
    let quantity = 0n;
    let sequence = 0;
    const logs: string[] = [];
    for (const row of rows) {
      await transaction.execute(
        "DELETE FROM guild_warehouse_stacks WHERE guild_id=? AND item_id=?",
        [row.guild_id, row.item_id],
      );
      sequence += 1;
      await transaction.execute(
        `INSERT INTO guild_warehouse_ledger(
           operation_id,sequence_no,guild_id,item_id,quantity_delta,quantity_after,reason_code
         ) VALUES (?,?,?,?,?,0,'LEGACY_DATA_CLEANUP_RING_DELETE')`,
        [operationId, sequence, row.guild_id, row.item_id, -row.quantity],
      );
      await transaction.execute(
        `INSERT INTO legacy_data_cleanup_guild_ring_changes(
           operation_id,sequence_no,guild_id,item_id,quantity
         ) VALUES (?,?,?,?,?)`,
        [operationId, sequence, row.guild_id, row.item_id, row.quantity],
      );
      quantity += row.quantity;
      logs.push(`${row.display_name}(${row.guild_code}) : 💍x${formatInteger(row.quantity)} 삭제`);
    }
    return { guildCount: BigInt(rows.length), quantity, logs };
  }
}

// 레거시 UI의 일곱 단계와 유저별 증거 로그를 동일한 순서로 구성합니다.
export function buildLegacyDataCleanupMessage(summary: LegacyDataCleanupSummary): string {
  const lines = ["🧹 /데이터정리 완료", ALLSEE, "[1] 펫홈 데이터 정리",
    `display 삭제 : ${formatInteger(summary.furnitureDisplayRemoved)}개`,
    `null 제거 : ${formatInteger(summary.furnitureNullRemoved)}개`,
    "", "정규화된 가구 인스턴스에는 display/null 필드가 없어 정리할 데이터 없음",
    "", "[2] 아이템 명칭 변경", `변경된 아이템 수량 : ${formatInteger(summary.itemQuantityMoved)}개`,
    ...(summary.itemLogs.length > 0 ? ["", "[아이템 변경 유저]", ...summary.itemLogs] : ["", "변경할 아이템 없음"]),
    "", "[3] 펫스킬 데이터 이동", `이동된 펫스킬 수량 : ${formatInteger(summary.petSkillMoved)}개`,
    `삭제된 petData.petchar 유저 : ${formatInteger(summary.petCharRemoved)}명`,
    `petData.petSkills 삭제 유저 : ${formatInteger(summary.petSkillContainersRemoved)}명`,
    "", "정규화된 펫·펫스킬 테이블로 이미 분리됨",
    "", "[4] 포인트 소수점 정리", `정리된 유저 : ${formatInteger(summary.pointUserCount)}명`,
    `제거된 소수점 포인트 총합 : 🅟${formatMilli(summary.pointRemovedMilli)}`,
    ...(summary.pointLogs.length > 0 ? ["[포인트 정리 유저]", ...summary.pointLogs] : ["소수점 포인트 없음"]),
    "", "[5] 레거시 패스 명단 데이터 제거",
    Number(summary.legacyPassListsRemoved) > 0 ? `제거된 레거시 패스 명단 : ${formatInteger(summary.legacyPassListsRemoved)}개` : "제거할 레거시 패스 명단 없음",
    "", "[6] 유저 기존 반지 데이터 삭제", `반지 삭제 유저 : ${formatInteger(summary.userRingRemoved)}명`,
    `보상 플래그 삭제 유저 : ${formatInteger(summary.ringRewardFlagsRemoved)}명`,
    ...(summary.ringLogs.length > 0 ? ["", "[삭제된 유저 반지 데이터]", ...summary.ringLogs] : ["", "삭제할 유저 반지 데이터 없음"]),
    "", "[7] 길드창고 기존 반지 데이터 삭제", `삭제 길드 : ${formatInteger(summary.guildRingGuildCount)}개`,
    `삭제 수량 : 💍x${formatInteger(summary.guildRingQuantity)}`, "※ 펜던트 강화석📿 수량으로 이전하지 않습니다.",
    ...(summary.guildRingLogs.length > 0 ? ["", "[삭제된 길드창고 반지 데이터]", ...summary.guildRingLogs] : ["", "삭제할 길드창고 반지 데이터 없음"]),
  ];
  return lines.join("\n");
}

// DECIMAL(30,3) 문자열을 손실 없는 천분율 정수로 변환합니다.
export function parseDecimalToMilli(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,3}))?$/.exec(value);
  if (!match) throw new Error(`Invalid DECIMAL(30,3): ${value}`);
  const absolute = BigInt(match[2]!) * 1000n + BigInt((match[3] ?? "").padEnd(3, "0") || "0");
  return match[1] === "-" ? -absolute : absolute;
}

// 천분율 정수를 레거시 포인트 표시에 맞춰 불필요한 0 없이 출력합니다.
export function formatMilli(value: string | bigint): string {
  const milli = typeof value === "bigint" ? value : BigInt(value);
  const sign = milli < 0n ? "-" : "";
  const absolute = milli < 0n ? -milli : milli;
  const fraction = (absolute % 1000n).toString().padStart(3, "0").replace(/0+$/, "");
  return `${sign}${absolute / 1000n}${fraction ? `.${fraction}` : ""}`;
}

// DB DECIMAL 입력용으로 천분율 값을 항상 세 자리 소수로 출력합니다.
function formatMilliAsFixed(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 1000n}.${(absolute % 1000n).toString().padStart(3, "0")}`;
}

// 정수형 수량을 세 자리 구분 기호로 출력합니다.
function formatInteger(value: string | bigint): string {
  return BigInt(value).toLocaleString("en-US");
}

// MariaDB DECIMAL 문자열의 불필요한 소수점 0을 제거합니다.
function formatDecimalText(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}
