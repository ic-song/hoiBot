import type { PlayerContext } from "../account-platform/player-context-provider.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";

interface ProvenanceRow {
  owned_item_stack_id: string; stack_run_id: string | null; definition_run_id: string | null;
  stack_run_status: string | null; definition_run_status: string | null; stack_import_sha256: string | null; definition_import_sha256: string | null;
  stack_expected_source_count: number | null; stack_projected_source_count: number | null; stack_quarantined_source_count: number | null; stack_ignored_source_count: number | null;
  stack_expected_row_count: number | null; stack_imported_row_count: number | null; definition_expected_source_count: number | null; definition_projected_source_count: number | null;
  definition_quarantined_source_count: number | null; definition_ignored_source_count: number | null; definition_expected_row_count: number | null; definition_imported_row_count: number | null;
}

function complete(prefix: "stack" | "definition", row: ProvenanceRow): boolean {
  const value = (suffix: string): unknown => row[`${prefix}_${suffix}` as keyof ProvenanceRow];
  const expectedSources = Number(value("expected_source_count")), projectedSources = Number(value("projected_source_count"));
  const quarantined = Number(value("quarantined_source_count")), ignored = Number(value("ignored_source_count"));
  return value("run_id") !== null && value("run_status") === "COMPLETE"
    && typeof value("import_sha256") === "string" && /^[0-9a-f]{64}$/.test(value("import_sha256") as string)
    && Number.isSafeInteger(expectedSources) && expectedSources > 0
    && Number.isSafeInteger(projectedSources) && projectedSources > 0
    && expectedSources === projectedSources + quarantined + ignored
    && quarantined === 0 && ignored === 0
    && Number.isSafeInteger(Number(value("expected_row_count"))) && Number(value("expected_row_count")) > 0
    && Number(value("expected_row_count")) === Number(value("imported_row_count"));
}

// legacy/canonical value parity와 별도로 각 stack·definition의 승인 import receipt를 요구합니다.
export class CanonicalItemBagImportReadinessProvider {
  async inspect(database: AppWiringReadParticipant, context: PlayerContext): Promise<boolean> {
    const rows = await database.query<ProvenanceRow[]>(
      `SELECT stack.owned_item_stack_id,
              stack_receipt.object_domain_import_run_id AS stack_run_id,definition_receipt.object_domain_import_run_id AS definition_run_id,
              stack_run.run_status AS stack_run_status,definition_run.run_status AS definition_run_status,
              stack_run.import_sha256 AS stack_import_sha256,definition_run.import_sha256 AS definition_import_sha256,
              stack_run.expected_source_count AS stack_expected_source_count,stack_run.projected_source_count AS stack_projected_source_count,
              stack_run.quarantined_source_count AS stack_quarantined_source_count,stack_run.ignored_source_count AS stack_ignored_source_count,
              stack_run.expected_row_count AS stack_expected_row_count,stack_run.imported_row_count AS stack_imported_row_count,
              definition_run.expected_source_count AS definition_expected_source_count,definition_run.projected_source_count AS definition_projected_source_count,
              definition_run.quarantined_source_count AS definition_quarantined_source_count,definition_run.ignored_source_count AS definition_ignored_source_count,
              definition_run.expected_row_count AS definition_expected_row_count,definition_run.imported_row_count AS definition_imported_row_count
         FROM canonical_owned_item_stacks stack JOIN canonical_item_definitions definition ON definition.item_id=stack.item_id
         LEFT JOIN data_migration_object_domain_import_records stack_receipt ON stack_receipt.target_table_name='canonical_owned_item_stacks' AND stack_receipt.target_pk_column_name='owned_item_stack_id' AND stack_receipt.target_pk_value=stack.owned_item_stack_id
         LEFT JOIN data_migration_object_domain_import_runs stack_run ON stack_run.object_domain_import_run_id=stack_receipt.object_domain_import_run_id
         LEFT JOIN data_migration_object_domain_import_records definition_receipt ON definition_receipt.target_table_name='canonical_item_definitions' AND definition_receipt.target_pk_column_name='item_id' AND definition_receipt.target_pk_value=definition.item_id
         LEFT JOIN data_migration_object_domain_import_runs definition_run ON definition_run.object_domain_import_run_id=definition_receipt.object_domain_import_run_id
        WHERE stack.player_id=? ORDER BY stack.owned_item_stack_id`, [context.canonicalPlayerId],
    );
    return rows.length > 0 && new Set(rows.map((row) => row.owned_item_stack_id)).size === rows.length
      && rows.every((row) => complete("stack", row) && complete("definition", row));
  }
}
