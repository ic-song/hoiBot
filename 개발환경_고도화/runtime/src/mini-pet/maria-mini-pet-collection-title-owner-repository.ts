import {
  MiniPetCollectionLegacyTitle,
  MiniPetCollectionTitleCompatibilityRow,
  MiniPetCollectionTitleOwnerInput,
  MiniPetCollectionTitleOwnerRepository,
  MiniPetCollectionTitleOwnerResult,
  MiniPetCollectionTitleTransaction,
  miniPetCollectionTitleStableCode,
} from "./mini-pet-collection-title-owner-provider.js";

interface DefinitionRow {
  title_id: string | number;
  catalog_id: string | number;
  display_name: string;
}

interface SourceRow {
  id: string | number;
  source_row: number;
  legacy_list_index: number;
  legacy_name: string;
  legacy_in_date: string;
  legacy_price_json: string;
  title_id: string | number;
  canonical_instance_id: string | number | bigint;
  lifecycle_code: "OWNED" | "REMOVED";
  selected: number;
  version: string | number | bigint;
}

interface IdRow { id: string | number }

export class MariaMiniPetCollectionTitleOwnerRepository implements MiniPetCollectionTitleOwnerRepository {
  async execute(
    transaction: MiniPetCollectionTitleTransaction,
    operationId: string,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult> {
    if (input.action === "grant") {
      return this.grant(transaction, operationId, input);
    }
    const owned = await this.lockOwned(transaction, input.playerId);
    const source = owned[Number(input.listIndex) - 1];
    if (!source) {
      throw new Error("MINI_PET_COLLECTION_TITLE_NOT_FOUND");
    }
    this.assertVersion(source, input.expectedVersion);
    return input.action === "select"
      ? this.select(transaction, source, input)
      : this.remove(transaction, source, input);
  }

  async readCompatibility(
    transaction: MiniPetCollectionTitleTransaction,
    playerId: string,
    legacyTitles: readonly MiniPetCollectionLegacyTitle[],
  ): Promise<MiniPetCollectionTitleCompatibilityRow[]> {
    const canonical = await transaction.query<SourceRow[]>(
      "SELECT source_row, legacy_list_index, legacy_name, legacy_in_date, legacy_price_json, title_id, canonical_instance_id, lifecycle_code, selected, version FROM player_mini_pet_collection_title_sources WHERE player_id = ? ORDER BY legacy_list_index, id",
      [playerId],
    );
    const bySourceRow = new Map(canonical.map((row) => [Number(row.source_row), row]));
    const merged: MiniPetCollectionTitleCompatibilityRow[] = legacyTitles.map((legacy) => {
      const row = bySourceRow.get(legacy.sourceRow);
      if (!row) {
        return { ...legacy, source: "legacy", lifecycle: "OWNED", selected: false };
      }
      bySourceRow.delete(legacy.sourceRow);
      return this.compatibilityRow(row);
    });
    for (const row of bySourceRow.values()) {
      merged.push(this.compatibilityRow(row));
    }
    return merged.sort((left, right) => left.listIndex - right.listIndex || left.sourceRow - right.sourceRow);
  }

  private async grant(
    transaction: MiniPetCollectionTitleTransaction,
    operationId: string,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult> {
    const legacy = input.legacy as MiniPetCollectionLegacyTitle;
    const definition = await this.resolveDefinition(transaction, legacy.sourceRow, legacy.name);
    const existingRows = await transaction.query<SourceRow[]>(
      "SELECT * FROM player_mini_pet_collection_title_sources WHERE player_id = ? AND source_scope = 'MINI_PET_COLLECTION' AND source_row = ? FOR UPDATE",
      [input.playerId, legacy.sourceRow],
    );
    const existing = existingRows[0];
    if (existing?.lifecycle_code === "OWNED") {
      return this.result("repeated", input.playerId, existing, false);
    }
    if (existing) {
      this.assertVersion(existing, input.expectedVersion);
    }

    const owned = await this.lockOwned(transaction, input.playerId);
    const selected = owned.every((row) => !row.selected);
    const orderRows = await transaction.query<Array<{ next_order: number | bigint }>>(
      "SELECT COALESCE(MAX(display_order), 0) + 1 AS next_order FROM player_title_instances WHERE player_id = ? FOR UPDATE",
      [input.playerId],
    );
    const displayOrder = Number(orderRows[0]?.next_order || 1);
    if (selected) {
      await this.clearEquippedProjection(transaction, input.playerId);
    }
    const insertResult = await transaction.execute(
      "INSERT INTO player_title_instances (instance_key, player_id, title_id, title_catalog_entry_id, source_operation_id, source_sequence_no, price_value, display_order, status, equipped, acquired_at, version, snapshot_name, legacy_price_json) VALUES (UUID(), ?, ?, ?, ?, 1, ?, ?, 'owned', ?, STR_TO_DATE(REPLACE(REPLACE(?, 'T', ' '), 'Z', ''), '%Y-%m-%d %H:%i:%s.%f'), 1, ?, ?)",
      [input.playerId, definition.title_id, definition.catalog_id, operationId, legacy.price, displayOrder, selected ? 1 : 0, legacy.inDate, legacy.name, legacy.price],
    );
    let instanceId = String(insertResult.insertId || "");
    if (!instanceId) {
      const ids = await transaction.query<IdRow[]>(
        "SELECT id FROM player_title_instances WHERE source_operation_id = ? AND source_sequence_no = 1",
        [operationId],
      );
      instanceId = String(ids[0]!.id);
    }
    await transaction.execute(
      "INSERT INTO player_titles (player_id, title_id, acquired_at, equipped, display_order, acquisition_price) VALUES (?, ?, STR_TO_DATE(REPLACE(REPLACE(?, 'T', ' '), 'Z', ''), '%Y-%m-%d %H:%i:%s.%f'), ?, ?, ?) ON DUPLICATE KEY UPDATE equipped = VALUES(equipped), display_order = LEAST(display_order, VALUES(display_order)), acquisition_price = VALUES(acquisition_price)",
      [input.playerId, definition.title_id, legacy.inDate, selected ? 1 : 0, displayOrder, legacy.price],
    );
    if (existing) {
      await transaction.execute(
        "UPDATE player_mini_pet_collection_title_sources SET legacy_list_index = ?, legacy_name = ?, legacy_in_date = ?, legacy_price_json = ?, title_id = ?, title_catalog_entry_id = ?, canonical_instance_id = ?, lifecycle_code = 'OWNED', selected = ?, version = version + 1, source_operation_id = ? WHERE id = ?",
        [legacy.listIndex, legacy.name, legacy.inDate, legacy.price, definition.title_id, definition.catalog_id, instanceId, selected ? 1 : 0, operationId, existing.id],
      );
    } else {
      await transaction.execute(
        "INSERT INTO player_mini_pet_collection_title_sources (player_id, source_row, legacy_list_index, legacy_name, legacy_in_date, legacy_price_json, title_id, title_catalog_entry_id, canonical_instance_id, lifecycle_code, selected, version, source_operation_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWNED', ?, 1, ?)",
        [input.playerId, legacy.sourceRow, legacy.listIndex, legacy.name, legacy.inDate, legacy.price, definition.title_id, definition.catalog_id, instanceId, selected ? 1 : 0, operationId],
      );
    }
    const rows = await transaction.query<SourceRow[]>(
      "SELECT * FROM player_mini_pet_collection_title_sources WHERE player_id = ? AND source_row = ?",
      [input.playerId, legacy.sourceRow],
    );
    return this.result("granted", input.playerId, rows[0]!, false);
  }

  private async select(
    transaction: MiniPetCollectionTitleTransaction,
    source: SourceRow,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult> {
    await this.clearEquippedProjection(transaction, input.playerId);
    await transaction.execute(
      "UPDATE player_mini_pet_collection_title_sources SET selected = 0 WHERE player_id = ? AND lifecycle_code = 'OWNED'",
      [input.playerId],
    );
    await transaction.execute(
      "UPDATE player_mini_pet_collection_title_sources SET selected = 1, version = version + 1 WHERE id = ? AND version = ?",
      [source.id, source.version],
    );
    await transaction.execute(
      "UPDATE player_title_instances SET equipped = 1, version = version + 1 WHERE id = ? AND status = 'owned'",
      [source.canonical_instance_id],
    );
    await transaction.execute(
      "UPDATE player_titles SET equipped = 1 WHERE player_id = ? AND title_id = ?",
      [input.playerId, source.title_id],
    );
    return this.result("selected", input.playerId, { ...source, selected: 1, version: BigInt(source.version) + 1n }, false);
  }

  private async remove(
    transaction: MiniPetCollectionTitleTransaction,
    source: SourceRow,
    input: MiniPetCollectionTitleOwnerInput,
  ): Promise<MiniPetCollectionTitleOwnerResult> {
    await transaction.execute(
      "UPDATE player_mini_pet_collection_title_sources SET lifecycle_code = 'REMOVED', selected = 0, version = version + 1 WHERE id = ? AND version = ?",
      [source.id, source.version],
    );
    await transaction.execute(
      "UPDATE player_title_instances SET status = 'removed', equipped = 0, version = version + 1 WHERE id = ? AND status = 'owned'",
      [source.canonical_instance_id],
    );
    await transaction.execute(
      "DELETE FROM player_titles WHERE player_id = ? AND title_id = ? AND NOT EXISTS (SELECT 1 FROM player_title_instances WHERE player_id = ? AND title_id = ? AND status = 'owned')",
      [input.playerId, source.title_id, input.playerId, source.title_id],
    );
    await transaction.query(
      "UPDATE player_title_instances AS target JOIN (SELECT id, ROW_NUMBER() OVER (ORDER BY display_order, id) AS compact_order FROM player_title_instances WHERE player_id = ? AND status = 'owned') AS ordered ON ordered.id = target.id SET target.display_order = ordered.compact_order",
      [input.playerId],
    );
    await transaction.query(
      "UPDATE player_titles AS projection JOIN (SELECT player_id, title_id, MIN(display_order) AS compact_order FROM player_title_instances WHERE player_id = ? AND status = 'owned' GROUP BY player_id, title_id) AS representative ON representative.player_id = projection.player_id AND representative.title_id = projection.title_id SET projection.display_order = representative.compact_order",
      [input.playerId],
    );
    return this.result("removed", input.playerId, { ...source, lifecycle_code: "REMOVED", selected: 0, version: BigInt(source.version) + 1n }, false);
  }

  private async resolveDefinition(
    transaction: MiniPetCollectionTitleTransaction,
    sourceRow: number,
    expectedName: string,
  ): Promise<DefinitionRow> {
    const rows = await transaction.query<DefinitionRow[]>(
      "SELECT definition.id AS title_id, catalog.id AS catalog_id, definition.display_name FROM title_definition_catalog_entries AS catalog JOIN title_definitions AS definition ON definition.id = catalog.legacy_title_definition_id WHERE catalog.source_scope = 'MINI_PET_COLLECTION' AND catalog.stable_code = ? AND catalog.definition_version = 1 AND catalog.lifecycle_code = 'ACTIVE' AND BINARY definition.display_name = BINARY ?",
      [miniPetCollectionTitleStableCode(sourceRow), expectedName],
    );
    if (rows.length !== 1) {
      throw new Error("MINI_PET_COLLECTION_DEFINITION_NOT_FOUND");
    }
    return rows[0]!;
  }

  private lockOwned(transaction: MiniPetCollectionTitleTransaction, playerId: string): Promise<SourceRow[]> {
    return transaction.query<SourceRow[]>(
      "SELECT * FROM player_mini_pet_collection_title_sources WHERE player_id = ? AND lifecycle_code = 'OWNED' ORDER BY legacy_list_index, id FOR UPDATE",
      [playerId],
    );
  }

  private assertVersion(source: SourceRow, expectedVersion?: string): void {
    if (expectedVersion !== undefined && String(source.version) !== expectedVersion) {
      throw new Error("MINI_PET_COLLECTION_TITLE_VERSION_CONFLICT");
    }
  }

  private clearEquippedProjection(transaction: MiniPetCollectionTitleTransaction, playerId: string): Promise<void> {
    return Promise.all([
      transaction.execute("UPDATE player_title_instances SET equipped = 0 WHERE player_id = ? AND status = 'owned'", [playerId]),
      transaction.execute("UPDATE player_titles SET equipped = 0 WHERE player_id = ?", [playerId]),
    ]).then(() => undefined);
  }

  private result(
    status: MiniPetCollectionTitleOwnerResult["status"],
    playerId: string,
    source: SourceRow,
    replayed: boolean,
  ): MiniPetCollectionTitleOwnerResult {
    return {
      status,
      playerId,
      sourceRow: Number(source.source_row),
      listIndex: Number(source.legacy_list_index),
      titleId: String(source.title_id),
      instanceId: String(source.canonical_instance_id),
      version: String(source.version),
      replayed,
    };
  }

  private compatibilityRow(row: SourceRow): MiniPetCollectionTitleCompatibilityRow {
    return {
      sourceRow: Number(row.source_row),
      listIndex: Number(row.legacy_list_index),
      name: row.legacy_name,
      inDate: row.legacy_in_date,
      price: row.legacy_price_json,
      source: "canonical",
      titleId: String(row.title_id),
      instanceId: String(row.canonical_instance_id),
      lifecycle: row.lifecycle_code,
      selected: Boolean(row.selected),
      version: String(row.version),
    };
  }
}
