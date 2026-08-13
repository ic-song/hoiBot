import type { DatabaseClient } from "../database.js";
import { recordOutboxDelivery } from "./event-processing-service.js";

interface ClaimedOutbox {
  id: bigint;
  destination_id: string;
  payload_json: string | { data?: unknown };
}

export type IrisTextDelivery = (message: { room: string; data: string }) => Promise<void>;

// 재시작 후에도 남은 Iris text outbox를 제한된 batch로 재전송합니다.
export class OutboxWorker {
  constructor(
    private readonly database: DatabaseClient,
    private readonly deliverIrisText: IrisTextDelivery
  ) {}

  async runOnce(limit = 20): Promise<number> {
    const claimed = await this.database.withTransaction(async (transaction) => {
      const rows = await transaction.query<ClaimedOutbox[]>(
        `SELECT id, destination_id, payload_json FROM outbox_messages
         WHERE provider_code = 'iris' AND message_type = 'text'
           AND status IN ('pending', 'failed') AND available_at <= UTC_TIMESTAMP(3)
         ORDER BY id LIMIT ? FOR UPDATE SKIP LOCKED`,
        [limit]
      );
      for (const row of rows) {
        await transaction.execute("UPDATE outbox_messages SET status = 'sending' WHERE id = ?", [row.id]);
      }
      return rows;
    });

    for (const row of claimed) {
      try {
        const payload = typeof row.payload_json === "string" ? JSON.parse(row.payload_json) as { data?: unknown } : row.payload_json;
        if (typeof payload.data !== "string") throw new Error("Outbox text payload is invalid.");
        await this.deliverIrisText({ room: row.destination_id, data: payload.data });
        await recordOutboxDelivery(this.database, row.id.toString(), { ok: true });
      } catch {
        await recordOutboxDelivery(this.database, row.id.toString(), { ok: false, errorCode: "IRIS_REPLY_FAILED" });
      }
    }
    return claimed.length;
  }
}
