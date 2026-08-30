import {
  MiniPetCollectionLegacyTitle,
  MiniPetCollectionTitleCompatibilityRow,
  MiniPetCollectionTitleDatabase,
  MiniPetCollectionTitleOwnerInput,
  MiniPetCollectionTitleOwnerProvider,
  MiniPetCollectionTitleOwnerResult,
  MiniPetCollectionTitleTransaction,
} from "./mini-pet-collection-title-owner-provider.js";
import { randomUUID } from "node:crypto";

interface OperationRow {
  id: string | number;
  result_json: string | MiniPetCollectionTitleOwnerResult | null;
}

export class MiniPetCollectionTitleOwnerService {
  constructor(
    private readonly database: MiniPetCollectionTitleDatabase,
    private readonly provider: MiniPetCollectionTitleOwnerProvider,
  ) {}

  async execute(input: MiniPetCollectionTitleOwnerInput): Promise<MiniPetCollectionTitleOwnerResult> {
    return this.database.withTransaction(async (transaction) => {
      const operation = await this.claimOperation(transaction, input);
      if (operation.result_json) {
        const replay = typeof operation.result_json === "string" ? JSON.parse(operation.result_json) as MiniPetCollectionTitleOwnerResult : operation.result_json;
        return { ...replay, replayed: true };
      }

      const result = await this.provider.execute(transaction, String(operation.id), input);
      await transaction.execute(
        "INSERT INTO command_audit (operation_id, actor_type, actor_id, target_type, target_id, action_code, result_code, reason, change_summary_json, created_at) VALUES (?, 'player', ?, 'mini_pet_collection_title', ?, ?, ?, 'canonical collection title owner link', ?, UTC_TIMESTAMP(3))",
        [operation.id, input.playerId, String(result.sourceRow), `mini_pet.collection_title.${input.action}`, result.status, JSON.stringify(result)],
      );
      await transaction.execute(
        "UPDATE operations SET status = 'completed', result_json = ?, completed_at = UTC_TIMESTAMP(3) WHERE id = ?",
        [JSON.stringify(result), operation.id],
      );
      return result;
    });
  }

  readCompatibility(
    playerId: string,
    legacyTitles: readonly MiniPetCollectionLegacyTitle[],
  ): Promise<MiniPetCollectionTitleCompatibilityRow[]> {
    return this.database.withTransaction((transaction) =>
      this.provider.readCompatibility(transaction, playerId, legacyTitles),
    );
  }

  private async claimOperation(
    transaction: MiniPetCollectionTitleTransaction,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<OperationRow> {
    const scope = `mini_pet.collection_title.${input.action}:${input.playerId}`;
    const claim = await transaction.execute(
      "INSERT INTO operations (operation_key, idempotency_scope, idempotency_key, actor_type, actor_id, source_code, status, created_at) VALUES (?, ?, ?, 'player', ?, 'runtime_db', 'processing', UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)",
      [randomUUID(), scope, input.eventId, input.playerId],
    );
    const rows = await transaction.query<OperationRow[]>(
      "SELECT id, result_json FROM operations WHERE id = ? FOR UPDATE",
      [claim.insertId],
    );
    if (!rows[0]) {
      throw new Error("MINI_PET_COLLECTION_OPERATION_NOT_FOUND");
    }
    return rows[0];
  }
}
