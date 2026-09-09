import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

const COMMAND = "/경매초기화";
const COMMAND_CODE = "ADMIN_AUCTION_RESET";
const SCOPE = "admin.auction.reset";
type Numeric = bigint | number | string;

interface OperatorRow { operator_id: Numeric; }
interface ListingRow {
  id: Numeric; item_name: string; highest_bidder_player_id: Numeric | null; highest_bid: string;
  ends_at: Date | string; legacy_timeout_key: string | null; legacy_original_index: Numeric | null;
  status: "active" | "expired"; version: Numeric;
}

export interface AdminAuctionResetResult {
  status: "reset";
  data: string;
  outboxId: string;
  resetRunId: string;
  resetListingCount: number;
  resetListingIds: string[];
  bidderPointsChanged: false;
  replayed: boolean;
}

// 인자와 별칭이 없는 정확한 경매 초기화 명령만 실행 후보로 허용합니다.
export function isAdminAuctionResetCommand(message: string | undefined): boolean {
  return message === COMMAND;
}

// 레거시 완료 문구를 유지하면서 초기화 건수는 감사 결과에만 보존합니다.
export function formatAdminAuctionResetReply(): string {
  return "호이상점이 초기화가 되었습니다";
}

// 경매 잠금·스냅샷·상태 초기화·감사·응답을 하나의 transaction으로 처리합니다.
export class AdminAuctionResetService {
  constructor(private readonly database: DatabaseClient) {}

  async handle(input: { externalUserId: string; channelId: string; message: string; eventId: string }): Promise<AdminAuctionResetResult | null> {
    if (!isAdminAuctionResetCommand(input.message)) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.database.withTransaction((transaction) => this.execute(transaction, input));
      } catch (error) {
        if (!isRetryable(error) || attempt === 2) throw error;
      }
    }
    throw new ApplicationError("AUCTION_RESET_RETRY_EXHAUSTED", "경매 초기화를 다시 시도해 주세요.", 409);
  }

  private async execute(transaction: DatabaseTransaction, input: { externalUserId: string; channelId: string; eventId: string }): Promise<AdminAuctionResetResult | null> {
    const operator = (await transaction.query<OperatorRow[]>(
      `SELECT operator.id AS operator_id
         FROM external_identities identity
         JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
         JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
         JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
         JOIN admin_roles role ON role.id=operator_role.role_id AND role.active=TRUE
         JOIN admin_role_permissions permission ON permission.role_id=role.id AND permission.permission_code='admin.auction.reset'
        WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
        ORDER BY operator.id LIMIT 1 FOR UPDATE`, [input.externalUserId]
    ))[0];
    if (operator === undefined) return null;

    const key = eventKey(input.eventId);
    const reservation = await transaction.execute(
      "INSERT IGNORE INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES(?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3))",
      [randomUUID(), SCOPE, key, operator.operator_id]
    );
    if (reservation.affectedRows === 0n) {
      const prior = (await transaction.query<Array<{ result_json: string | AdminAuctionResetResult | null }>>(
        "SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [SCOPE, key]
      ))[0];
      if (prior?.result_json !== null && prior?.result_json !== undefined) return { ...stored(prior.result_json), replayed: true };
      throw new ApplicationError("AUCTION_RESET_IN_PROGRESS", "경매 초기화가 처리 중입니다.", 409);
    }

    await transaction.query("SELECT lock_code FROM admin_global_locks WHERE lock_code='auction_reset' FOR UPDATE");
    const listings = await transaction.query<ListingRow[]>(
      "SELECT id,item_name,highest_bidder_player_id,CAST(highest_bid AS CHAR) highest_bid,ends_at,legacy_timeout_key,legacy_original_index,status,version FROM auction_listings WHERE status IN ('active','expired') ORDER BY id FOR UPDATE"
    );
    const run = await transaction.execute(
      "INSERT INTO auction_reset_runs(operation_id,actor_operator_id,reset_listing_count) VALUES(?,?,?)",
      [reservation.insertId, operator.operator_id, listings.length]
    );
    const resetListingIds: string[] = [];
    for (let index = 0; index < listings.length; index++) {
      const listing = listings[index]!;
      resetListingIds.push(String(listing.id));
      await transaction.execute(
        "INSERT INTO auction_reset_lines(reset_run_id,sequence_no,listing_id,previous_status,previous_version,item_name,highest_bidder_player_id,highest_bid,ends_at,legacy_timeout_key,legacy_original_index) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        [run.insertId, index + 1, listing.id, listing.status, listing.version, listing.item_name, listing.highest_bidder_player_id, listing.highest_bid, listing.ends_at, listing.legacy_timeout_key, listing.legacy_original_index]
      );
      const changed = await transaction.execute(
        "UPDATE auction_listings SET status='reset',version=version+1,closed_at=UTC_TIMESTAMP(3),updated_at=UTC_TIMESTAMP(3) WHERE id=? AND status=? AND version=?",
        [listing.id, listing.status, listing.version]
      );
      if (changed.affectedRows !== 1n) throw new ApplicationError("AUCTION_LISTING_VERSION_CONFLICT", "경매 정보가 먼저 변경되었습니다.", 409);
    }

    const data = formatAdminAuctionResetReply();
    const outbox = await transaction.execute(
      "INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES(?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [reservation.insertId, input.channelId, JSON.stringify({ data })]
    );
    await transaction.execute(
      "INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES(?,?,?,'completed','reset',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",
      [input.eventId, COMMAND_CODE, reservation.insertId]
    );
    await transaction.execute(
      "INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES(?,'admin_operator',?,'auction_listing',NULL,?,'reset','Iris /경매초기화',?,UTC_TIMESTAMP(3))",
      [reservation.insertId, operator.operator_id, SCOPE, JSON.stringify({ resetListingCount: listings.length, resetListingIds, bidderPointsChanged: false, deletionPolicy: "status_reset_with_snapshot" })]
    );
    const result: AdminAuctionResetResult = { status: "reset", data, outboxId: outbox.insertId.toString(), resetRunId: run.insertId.toString(), resetListingCount: listings.length, resetListingIds, bidderPointsChanged: false, replayed: false };
    await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), reservation.insertId]);
    return result;
  }
}

function eventKey(value: string): string { return value.length <= 191 ? value : `sha256:${createHash("sha256").update(value).digest("hex")}`; }
function stored(value: string | AdminAuctionResetResult): AdminAuctionResetResult { return typeof value === "string" ? JSON.parse(value) : value; }
function isRetryable(error: unknown): boolean { const code = (error as { code?: string }).code; return code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT"; }
