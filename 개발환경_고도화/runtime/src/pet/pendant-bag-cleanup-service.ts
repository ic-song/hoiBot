import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { sortPendantBagEntries, type PendantBagEntry } from "./pendant-bag-service.js";

const PRICE = 100000000n;
export interface PendantCleanupCommand { start: bigint; end: bigint; }
export interface PendantCleanupResult { status: "cleaned" | "usage" | "invalid_range" | "silent"; data?: string; outboxId?: string; removedCount: number; pointGranted: string; }

// 레거시 outer guard와 전체 숫자 범위 형식을 분리합니다.
export function isPendantBagCleanupCommandCandidate(message: string | undefined): boolean {
  return message === "/펜던트가방정리" || (message !== undefined && /^\/펜던트가방정리\s+.+$/.test(message));
}

// 인자 포함 후보를 command_registry의 정확한 대표 별칭으로 정규화합니다.
export function normalizePendantBagCleanupDispatchMessage(message: string): string {
  return isPendantBagCleanupCommandCandidate(message) ? "/펜던트가방정리" : message;
}

// 시작번호와 끝번호를 오름차순으로 정규화합니다.
export function parsePendantBagCleanupCommand(message: string): PendantCleanupCommand | null {
  const match = message.match(/^\/펜던트가방정리\s+(\d+)~(\d+)$/);
  if (match === null) return null;
  const first = BigInt(match[1]!); const second = BigInt(match[2]!);
  return first <= second ? { start: first, end: second } : { start: second, end: first };
}

// 정수를 세 자리 쉼표 형식으로 표시합니다.
function comma(value: bigint): string { return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

// 긴 이벤트 ID를 operations 멱등 키 길이에 맞게 정규화합니다.
function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }

// MariaDB JSON 결과를 멱등 재실행 응답으로 복원합니다.
function stored(value: string | PendantCleanupResult): PendantCleanupResult { return typeof value === "string" ? JSON.parse(value) as PendantCleanupResult : value; }

// 펜던트 범위 정리를 stable instance 상태·포인트·원장과 함께 원자 처리합니다.
export class PendantBagCleanupService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<PendantCleanupResult> {
    if (!isPendantBagCleanupCommandCandidate(input.message)) return { status: "silent", removedCount: 0, pointGranted: "0" };
    const command = parsePendantBagCleanupCommand(input.message);
    return this.database.withTransaction(async (transaction) => {
      const actors = await transaction.query<Array<{ identity_id: bigint; player_id: bigint; rank_display: string }>>(`SELECT identity.id identity_id,profile.player_id,CONCAT(COALESCE(rank_profile.rank_emoji,''),profile.current_display_name) rank_display
        FROM external_identities identity JOIN players player ON player.id=identity.player_id AND player.status='active'
        JOIN player_profiles profile ON profile.player_id=player.id
        LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=player.id
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked' LIMIT 1 FOR UPDATE`, [input.externalUserId]);
      const actor = actors[0];
      if (actor === undefined) return { status: "silent", removedCount: 0, pointGranted: "0" };
      const key = eventKey(input.eventId);
      const prior = await transaction.query<Array<{ result_json: string | PendantCleanupResult | null }>>("SELECT result_json FROM operations WHERE idempotency_scope='pendant.bag_cleanup' AND idempotency_key=? FOR UPDATE", [key]);
      if (prior[0]?.result_json != null) return stored(prior[0].result_json);
      const operation = await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,'pendant.bag_cleanup',?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))", [randomUUID(), key, actor.identity_id]);
      let status: PendantCleanupResult["status"] = "usage";
      let data = "예) /펜던트가방정리 [시작번호~끝번호]";
      let removedCount = 0;
      let pointGranted = 0n;
      const selectedIds: string[] = [];
      if (command !== null) {
        const rows = await transaction.query<Array<{ instance_id: bigint; item_id: bigint; version: bigint; item_name: string; name_value: string | null; icon_value: string | null; grade_value: string | null; durability_value: string | null; max_durability_value: string | null; upgrade_value: string | null }>>(`SELECT instance.id instance_id,instance.item_id,instance.version,item.display_name item_name,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.name')) name_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.icon')) icon_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.grade')) grade_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.durability')) durability_value,
            JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.maxDurability')) max_durability_value,JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.upgrade')) upgrade_value
          FROM inventory_instances instance JOIN item_definitions item ON item.id=instance.item_id AND item.active=TRUE
          WHERE instance.player_id=? AND instance.status='owned'
            AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(instance.attributes_json,'$.objectType')),JSON_UNQUOTE(JSON_EXTRACT(item.metadata_json,'$.objectType')))='pendant'
          FOR UPDATE`, [actor.player_id]);
        const entryById = new Map(rows.map((row) => [row.instance_id.toString(), row]));
        const entries: PendantBagEntry[] = rows.map((row) => ({ instanceId: row.instance_id.toString(), name: row.name_value ?? row.item_name, icon: row.icon_value ?? "", grade: row.grade_value ?? "",
          durability: BigInt(row.durability_value ?? "5"), maxDurability: BigInt(row.max_durability_value ?? "5"), upgrade: BigInt(row.upgrade_value ?? "0") }));
        const sorted = sortPendantBagEntries(entries);
        if (command.start < 1n || command.end > BigInt(sorted.length)) {
          status = "invalid_range"; data = "정리 범위가 올바르지 않습니다.";
        } else {
          const selected = sorted.slice(Number(command.start - 1n), Number(command.end));
          removedCount = selected.length; pointGranted = BigInt(removedCount) * PRICE;
          await transaction.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,1) ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)", [actor.player_id]);
          const accounts = await transaction.query<Array<{ balance: string; version: bigint }>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE", [actor.player_id]);
          const before = BigInt(accounts[0]!.balance.split(".")[0] ?? "0"); const after = before + pointGranted;
          const accountUpdate = await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?", [`${after}.000`, actor.player_id, accounts[0]!.version]);
          if (accountUpdate.affectedRows !== 1n) throw new Error("Pendant cleanup currency version conflict.");
          let sequence = 1;
          for (const entry of selected) {
            const row = entryById.get(entry.instanceId)!;
            const update = await transaction.execute("UPDATE inventory_instances SET status='consumed',version=version+1 WHERE id=? AND player_id=? AND status='owned' AND version=?", [row.instance_id, actor.player_id, row.version]);
            if (update.affectedRows !== 1n) throw new Error("Pendant cleanup instance version conflict.");
            await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,instance_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,-1,'PENDANT_BAG_CLEANUP')", [operation.insertId, sequence++, actor.player_id, row.item_id, row.instance_id]);
            selectedIds.push(entry.instanceId);
          }
          await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'PENDANT_BAG_CLEANUP')", [operation.insertId, actor.player_id, `${pointGranted}.000`, `${after}.000`]);
          status = "cleaned";
          data = `[${actor.rank_display}] 님\n펜던트 ${removedCount}개를 정리했습니다.\n획득 포인트💸: 🅟${comma(pointGranted)}`;
        }
      }
      const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operation.insertId, input.destinationId, JSON.stringify({ data })]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PENDANT_BAG_CLEANUP',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, operation.insertId, status]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pendant.bag_cleanup',?,'Iris /펜던트가방정리',?,UTC_TIMESTAMP(3))", [operation.insertId, actor.identity_id, actor.player_id, status, JSON.stringify({ removedCount, pointGranted: pointGranted.toString(), selectedInstanceIds: selectedIds })]);
      const result: PendantCleanupResult = { status, data, outboxId: outbox.insertId.toString(), removedCount, pointGranted: pointGranted.toString() };
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operation.insertId]);
      return result;
    });
  }
}
