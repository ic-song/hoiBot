import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";

const UINT64_MAX = 18446744073709551615n;

export type HomeFurnitureCleanCommand = { kind: "usage" } | { kind: "index"; index: bigint };
export interface HomeFurnitureCleanResult {
  status: "cleaned" | "rejected";
  reply: string;
  outboxId: string;
  furnitureInstanceId?: string;
  rewardPoint?: string;
  placedCount?: string;
  placedCharm?: string;
}

type Owner = { identity_id: bigint; player_id: bigint; display_name: string; rank_emoji: string | null };
type Furniture = { id: bigint; display_name: string; charm_snapshot: bigint; grade_display_name: string; version: bigint };

// 인자 없는 안내 또는 숫자 한 개 형식의 집청소 명령만 실행 후보로 봅니다.
export function isHomeFurnitureCleanCandidate(message: string | undefined): boolean {
  return message !== undefined && (message === "/집청소" || /^\/집청소\s+\d+$/.test(message));
}

export function normalizeHomeFurnitureCleanDispatchMessage(message: string): string {
  return isHomeFurnitureCleanCandidate(message) ? "/집청소" : message;
}

export function parseHomeFurnitureCleanCommand(message: string): HomeFurnitureCleanCommand | null {
  if (!isHomeFurnitureCleanCandidate(message)) return null;
  if (message === "/집청소") return { kind: "usage" };
  const match = /^\/집청소\s+(\d+)$/.exec(message);
  if (match === null) return null;
  const index = BigInt(match[1]!);
  return index <= UINT64_MAX ? { kind: "index", index } : null;
}

function eventKey(value: string): string {
  return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stored(value: string | HomeFurnitureCleanResult): HomeFurnitureCleanResult {
  return typeof value === "string" ? JSON.parse(value) as HomeFurnitureCleanResult : value;
}

function whole(value: string): bigint {
  return BigInt(value.split(".")[0]!);
}

function commas(value: bigint): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export function formatHomeFurnitureCleanReply(nickname: string, furnitureName: string, charm: bigint, reward: bigint): string {
  return `🏡[${nickname}]님,\n${furnitureName}(+${commas(charm)}💕) 을(를)\n가구정리센터에 보냈습니다.\n\n🅟${commas(reward)} 를 획득합니다.`;
}

async function complete(transaction: DatabaseTransaction, input: {
  operationId: bigint;
  eventId: string;
  destinationId: string;
  identityId: bigint;
  playerId: bigint;
  furnitureInstanceId: bigint | null;
  resultCode: string;
  reply: string;
  result: Omit<HomeFurnitureCleanResult, "reply" | "outboxId">;
  summary: Record<string, unknown>;
}): Promise<HomeFurnitureCleanResult> {
  const outbox = await transaction.execute(
    "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.operationId, input.destinationId, JSON.stringify({ data: input.reply })]
  );
  await transaction.execute(
    "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'HOME_FURNITURE_CLEAN',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
    [input.eventId, input.operationId, input.resultCode]
  );
  await transaction.execute(
    "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'furniture_inventory',?,'home.furniture_clean',?,'Iris /집청소',?,UTC_TIMESTAMP(3))",
    [input.operationId, input.identityId, input.furnitureInstanceId, input.resultCode, JSON.stringify(input.summary)]
  );
  const result = { ...input.result, reply: input.reply, outboxId: outbox.insertId.toString() } as HomeFurnitureCleanResult;
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), input.operationId]);
  return result;
}

// 배치된 가구 한 인스턴스를 stable 순번으로 판매하고 포인트 지급과 증빙을 원자 처리합니다.
export class HomeFurnitureCleanService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<HomeFurnitureCleanResult> {
    const command = parseHomeFurnitureCleanCommand(input.message);
    return this.database.withTransaction(async transaction => {
      const owner = (await transaction.query<Owner[]>(
        "SELECT identity.id identity_id,identity.player_id,profile.current_display_name display_name,rank.rank_emoji FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active' AND player.deleted_at IS NULL JOIN player_profiles profile ON profile.player_id=player.id LEFT JOIN player_legacy_rank_profiles rank ON rank.player_id=player.id WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' ORDER BY identity.player_id LIMIT 1 FOR UPDATE",
        [input.externalUserId]
      ))[0];
      if (owner === undefined) throw new Error("가입된 사용자 정보를 찾을 수 없습니다.");

      const prior = (await transaction.query<Array<{ result_json: string | HomeFurnitureCleanResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope='home.furniture.clean' AND idempotency_key=? FOR UPDATE",
        [eventKey(input.eventId)]
      ))[0];
      if (prior?.result_json != null) return stored(prior.result_json);

      const operationId = (await transaction.execute(
        "INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'home.furniture.clean',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",
        [randomUUID(), eventKey(input.eventId), owner.identity_id]
      )).insertId;
      const reject = (code: string, reply: string, summary: Record<string, unknown> = {}) => complete(transaction, {
        operationId,
        eventId: input.eventId,
        destinationId: input.destinationId,
        identityId: owner.identity_id,
        playerId: owner.player_id,
        furnitureInstanceId: null,
        resultCode: code,
        reply,
        result: { status: "rejected" },
        summary: { mutation: false, ...summary }
      });

      const placed = await transaction.query<Furniture[]>(
        "SELECT instance.id,definition.display_name,instance.charm_snapshot,instance.grade_display_name,instance.version FROM furniture_inventory_instances instance JOIN furniture_definitions definition ON definition.id=instance.furniture_definition_id WHERE instance.player_id=? AND instance.status='placed' ORDER BY instance.charm_snapshot DESC,definition.display_name COLLATE utf8mb4_unicode_ci,instance.id FOR UPDATE",
        [owner.player_id]
      );
      const nickname = `${owner.rank_emoji ?? ""}${owner.display_name}`;
      if (placed.length === 0) return reject("empty", `🏡[${nickname}]님, 현재 집에 배치된 가구가 없습니다.`);
      if (command === null || command.kind === "usage") {
        return reject("usage", `❌ 정리할 가구 번호를 입력해주세요.\n예) /집청소 1\n현재 배치된 가구 수: ${placed.length}개`, { placedCount: placed.length });
      }
      if (command.index < 1n || command.index > BigInt(placed.length)) {
        return reject("invalid_index", `❌[${nickname}]님, 잘못된 번호입니다.\n예) /집청소 1`, { requestedIndex: command.index.toString(), placedCount: placed.length });
      }

      const selected = placed[Number(command.index - 1n)]!;
      const policy = (await transaction.query<Array<{ reward_point: string }>>(
        "SELECT CAST(reward_point AS CHAR) reward_point FROM home_furniture_clean_policy WHERE policy_key='default' FOR UPDATE"
      ))[0];
      if (policy === undefined) throw new Error("집청소 보상 정책을 찾을 수 없습니다.");
      const reward = whole(policy.reward_point);
      await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)", [owner.player_id]);
      const account = (await transaction.query<Array<{ balance: string; version: bigint }>>(
        "SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",
        [owner.player_id]
      ))[0]!;
      const pointBefore = whole(account.balance);
      const pointAfter = pointBefore + reward;

      const changed = await transaction.execute(
        "UPDATE furniture_inventory_instances SET status='sold',version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE id=? AND player_id=? AND status='placed' AND version=?",
        [selected.id, owner.player_id, selected.version]
      );
      if (changed.affectedRows !== 1n) throw new Error("배치 가구가 먼저 변경되었습니다.");
      const pointWrite = await transaction.execute(
        "UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",
        [pointAfter.toString(), owner.player_id, account.version]
      );
      if (pointWrite.affectedRows !== 1n) throw new Error("포인트 정보가 먼저 변경되었습니다.");
      await transaction.execute(
        "INSERT INTO furniture_inventory_ledger(operation_id,sequence_no,player_id,furniture_instance_id,status_before,status_after,reason_code) VALUES (?,1,?,?,'placed','sold','HOME_FURNITURE_CLEAN')",
        [operationId, owner.player_id, selected.id]
      );
      await transaction.execute(
        "INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'HOME_FURNITURE_CLEAN_REWARD')",
        [operationId, owner.player_id, reward.toString(), pointAfter.toString()]
      );

      const projection = (await transaction.query<Array<{ placed_count: bigint; placed_charm: bigint }>>(
        "SELECT COUNT(*) placed_count,COALESCE(SUM(charm_snapshot),0) placed_charm FROM furniture_inventory_instances WHERE player_id=? AND status='placed' FOR UPDATE",
        [owner.player_id]
      ))[0]!;
      const gradeRows = await transaction.query<Array<{ grade_display_name: string; count_value: bigint }>>(
        "SELECT grade_display_name,COUNT(*) count_value FROM furniture_inventory_instances WHERE player_id=? AND status='placed' GROUP BY grade_display_name ORDER BY grade_display_name COLLATE utf8mb4_unicode_ci",
        [owner.player_id]
      );
      const gradeCounts: Record<string, string> = {};
      for (const row of gradeRows) gradeCounts[row.grade_display_name || "등급없음"] = row.count_value.toString();
      await transaction.execute(
        "INSERT INTO home_furniture_clean_operations(operation_id,player_id,furniture_instance_id,requested_index,placed_count_before,placed_count_after,placed_charm_after,grade_counts_after_json,furniture_name_snapshot,charm_snapshot,grade_display_name_snapshot,instance_version_before,reward_point,point_before,point_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [operationId, owner.player_id, selected.id, command.index.toString(), placed.length, projection.placed_count, projection.placed_charm, JSON.stringify(gradeCounts), selected.display_name, selected.charm_snapshot, selected.grade_display_name, selected.version, reward.toString(), pointBefore.toString(), pointAfter.toString()]
      );
      const reply = formatHomeFurnitureCleanReply(nickname, selected.display_name, BigInt(selected.charm_snapshot), reward);
      return complete(transaction, {
        operationId,
        eventId: input.eventId,
        destinationId: input.destinationId,
        identityId: owner.identity_id,
        playerId: owner.player_id,
        furnitureInstanceId: selected.id,
        resultCode: "cleaned",
        reply,
        result: { status: "cleaned", furnitureInstanceId: selected.id.toString(), rewardPoint: reward.toString(), placedCount: projection.placed_count.toString(), placedCharm: projection.placed_charm.toString() },
        summary: { mutation: true, requestedIndex: command.index.toString(), furnitureInstanceId: selected.id.toString(), statusBefore: "placed", statusAfter: "sold", rewardPoint: reward.toString(), pointBefore: pointBefore.toString(), pointAfter: pointAfter.toString(), placedCountBefore: placed.length, placedCountAfter: projection.placed_count.toString(), placedCharmAfter: projection.placed_charm.toString(), gradeCountsAfter: gradeCounts }
      });
    });
  }
}
