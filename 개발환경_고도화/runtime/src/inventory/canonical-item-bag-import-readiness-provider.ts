import type { PlayerContext } from "../account-platform/player-context-provider.js";
import { calculateItemBagCompletenessFingerprint } from "../data-migration/object-domain-importer.js";
import {
  assertItemBagImportContinuation,
  calculateItemBagLedgerEntryFingerprint,
  calculateItemBagLedgerBaselineSetFingerprint,
  calculateItemBagStackBaselineSetFingerprint,
  type ItemBagBaselineStack,
  type ItemBagCurrentStack,
  type ItemBagLedgerEntry
} from "../data-migration/item-bag-import-completeness-readiness.js";
import type { AppWiringReadParticipant } from "../dispatch/app-wiring-operation-provider.js";

interface ProjectionRow {
  player_item_bag_import_completeness_projection_id: string;
  object_domain_import_run_id: string;
  projection_version: string;
  profile_semantic_sha256: string;
  import_contract_sha256: string;
  common_staging_record_id: string;
  source_locator_sha256: string;
  source_payload_fingerprint: string;
  expected_source_key_count: number;
  projected_stack_count: number;
  quarantined_source_key_count: number;
  ignored_source_key_count: number;
  stack_set_fingerprint: string;
  item_ledger_entry_count: string;
  baseline_ledger_head_sequence: string;
  item_ledger_set_fingerprint: string;
  completeness_fingerprint: string;
  revision: string;
  active_flag: boolean | number | bigint;
  run_status: string;
  run_import_contract_sha256: string;
  run_catalog_version: string;
  catalog_run_status: string;
  staging_run_status: string;
  witness_source_namespace: string;
  witness_record_domain: string;
  witness_record_kind: string;
  witness_projection_status: string;
  witness_quarantine_reason: string | null;
  witness_source_locator_sha256: string;
  witness_payload_fingerprint: string;
  witness_owner_locator_sha256: string | null;
  witness_decision_status: string;
  witness_decision_reason: string | null;
  witness_decision_projected_row_count: number;
  witness_decision_source_locator_sha256: string;
  witness_decision_payload_fingerprint: string;
  player_source_system: string;
  player_source_identifier: string;
}

interface StackBaselineRow {
  player_id: string; item_id: string; owned_item_stack_id: string; baseline_quantity: string; stack_entry_fingerprint: string;
}

interface LedgerBaselineRow {
  player_id: string; item_inventory_ledger_entry_id: string; item_inventory_operation_id: string; ledger_sequence: string;
  item_id: string; owned_item_stack_id: string | null; owned_item_id: string | null; quantity_delta: string; reason_type: string; ledger_entry_fingerprint: string;
}

type CurrentLedgerRow = Omit<LedgerBaselineRow, "ledger_entry_fingerprint">;
interface CurrentStackRow { player_id: string; item_id: string; owned_item_stack_id: string; quantity: string; }
interface HeadRow { last_ledger_sequence: string; }

const HASH = /^[0-9a-f]{64}$/;
const POSITIVE_INTEGER = /^[1-9][0-9]*$/;

// These constants are contract identities, not merely hash-shaped inputs. The contract test binds them to the checked-in V3 documents.
export const APPROVED_ITEM_BAG_V3_PROFILE_SEMANTIC_SHA256 = "c9170ea6ed780a755918e776520a17cc3accbdf8dfec9865289c5b251232e27e";
export const APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256 = "0ba25d6e0f6e12d068c1f2757747de75b1b6642dcb8189b1c4b9f6bb89bb186b";

function baselineStack(row: StackBaselineRow): ItemBagBaselineStack {
  return { playerId: row.player_id, itemId: row.item_id, ownedItemStackId: row.owned_item_stack_id, baselineQuantity: String(row.baseline_quantity), stackEntryFingerprint: row.stack_entry_fingerprint };
}

function ledger(row: LedgerBaselineRow): ItemBagLedgerEntry {
  return {
    playerId: row.player_id,
    itemInventoryLedgerEntryId: row.item_inventory_ledger_entry_id,
    itemInventoryOperationId: row.item_inventory_operation_id,
    ledgerSequence: String(row.ledger_sequence),
    itemId: row.item_id,
    ownedItemStackId: row.owned_item_stack_id,
    ownedItemId: row.owned_item_id,
    quantityDelta: String(row.quantity_delta),
    reasonType: row.reason_type,
    ledgerEntryFingerprint: row.ledger_entry_fingerprint
  };
}

function currentStack(row: CurrentStackRow): ItemBagCurrentStack {
  return { playerId: row.player_id, itemId: row.item_id, ownedItemStackId: row.owned_item_stack_id, quantity: String(row.quantity) };
}

// V3 projection and typed children prove the import baseline; monotonic ordering proves only post-baseline continuation.
export class CanonicalItemBagImportReadinessProvider {
  async inspect(database: AppWiringReadParticipant, context: PlayerContext): Promise<boolean> {
    try {
      const projections = await database.query<ProjectionRow[]>(
        "SELECT projection.player_item_bag_import_completeness_projection_id,projection.object_domain_import_run_id,projection.common_staging_record_id,projection.projection_version,projection.profile_semantic_sha256,projection.import_contract_sha256,projection.source_locator_sha256,projection.source_payload_fingerprint,projection.expected_source_key_count,projection.projected_stack_count,projection.quarantined_source_key_count,projection.ignored_source_key_count,projection.stack_set_fingerprint,CAST(projection.item_ledger_entry_count AS CHAR) item_ledger_entry_count,CAST(projection.baseline_ledger_head_sequence AS CHAR) baseline_ledger_head_sequence,projection.item_ledger_set_fingerprint,projection.completeness_fingerprint,CAST(projection.revision AS CHAR) revision,projection.active_flag,run.run_status,run.import_contract_sha256 run_import_contract_sha256,run.catalog_version run_catalog_version,catalog.run_status catalog_run_status,staging_run.run_status staging_run_status,witness.source_namespace witness_source_namespace,witness.record_domain witness_record_domain,witness.record_kind witness_record_kind,witness.projection_status witness_projection_status,witness.quarantine_reason witness_quarantine_reason,witness.source_locator_sha256 witness_source_locator_sha256,witness.payload_fingerprint witness_payload_fingerprint,witness.owner_locator_sha256 witness_owner_locator_sha256,decision.decision_status witness_decision_status,decision.decision_reason witness_decision_reason,decision.projected_row_count witness_decision_projected_row_count,decision.source_locator_sha256 witness_decision_source_locator_sha256,decision.source_payload_fingerprint witness_decision_payload_fingerprint,player.source_system player_source_system,player.source_identifier player_source_identifier FROM player_item_bag_import_completeness_projections projection JOIN data_migration_object_domain_import_runs run ON run.object_domain_import_run_id=projection.object_domain_import_run_id JOIN data_migration_catalog_projection_runs catalog ON catalog.catalog_projection_run_id=run.catalog_projection_run_id JOIN data_migration_common_staging_runs staging_run ON staging_run.common_staging_run_id=catalog.common_staging_run_id JOIN data_migration_common_staging_records witness ON witness.common_staging_record_id=projection.common_staging_record_id AND witness.common_staging_run_id=staging_run.common_staging_run_id JOIN data_migration_catalog_source_decisions decision ON decision.catalog_projection_run_id=catalog.catalog_projection_run_id AND decision.common_staging_record_id=witness.common_staging_record_id JOIN canonical_players player ON player.player_id=projection.player_id WHERE projection.player_id=? AND projection.active_flag=TRUE",
        [context.canonicalPlayerId]
      );
      if (projections.length !== 1) return false;
      const projection = projections[0]!;
      if (projection.projection_version !== "OBJECT_DOMAIN_IMPORT_RELEVANT_V3" || projection.run_status !== "COMPLETE"
        || projection.profile_semantic_sha256 !== APPROVED_ITEM_BAG_V3_PROFILE_SEMANTIC_SHA256
        || projection.import_contract_sha256 !== APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256
        || projection.run_import_contract_sha256 !== APPROVED_ITEM_BAG_V3_IMPORT_CONTRACT_SHA256
        || projection.run_import_contract_sha256 !== projection.import_contract_sha256
        || projection.run_catalog_version !== "SC-20260902-1" || projection.catalog_run_status !== "COMPLETE" || projection.staging_run_status !== "COMPLETE"
        || projection.witness_source_namespace !== "member.bag" || projection.witness_record_domain !== "item" || projection.witness_record_kind !== "BAG_CONTAINER"
        || projection.witness_projection_status !== "PROJECT" || projection.witness_quarantine_reason !== null
        || projection.witness_source_locator_sha256 !== projection.source_locator_sha256 || projection.witness_payload_fingerprint !== projection.source_payload_fingerprint
        || projection.witness_decision_status !== "IGNORE" || projection.witness_decision_reason !== "NOT_OBJECT_DOMAIN_INPUT" || Number(projection.witness_decision_projected_row_count) !== 0
        || projection.witness_decision_source_locator_sha256 !== projection.source_locator_sha256 || projection.witness_decision_payload_fingerprint !== projection.source_payload_fingerprint
        || projection.player_source_system !== "LEGACY_JSON" || projection.witness_owner_locator_sha256 !== projection.player_source_identifier
        || !HASH.test(projection.source_locator_sha256) || !HASH.test(projection.source_payload_fingerprint) || !HASH.test(projection.completeness_fingerprint)
        || !POSITIVE_INTEGER.test(projection.revision)
        || Number(projection.expected_source_key_count) !== Number(projection.projected_stack_count)
        || Number(projection.quarantined_source_key_count) !== 0 || Number(projection.ignored_source_key_count) !== 0
        || !(projection.active_flag === true || projection.active_flag === 1 || projection.active_flag === 1n)) return false;
      const projectionId = projection.player_item_bag_import_completeness_projection_id;
      const stackRows = await database.query<StackBaselineRow[]>(
        "SELECT player_id,item_id,owned_item_stack_id,CAST(baseline_quantity AS CHAR) baseline_quantity,stack_entry_fingerprint FROM player_item_bag_import_stack_baselines WHERE player_item_bag_import_completeness_projection_id=? ORDER BY owned_item_stack_id",
        [projectionId]
      );
      const ledgerRows = await database.query<LedgerBaselineRow[]>(
        "SELECT player_id,item_inventory_ledger_entry_id,item_inventory_operation_id,CAST(ledger_sequence AS CHAR) ledger_sequence,item_id,owned_item_stack_id,owned_item_id,CAST(quantity_delta AS CHAR) quantity_delta,reason_type,ledger_entry_fingerprint FROM player_item_bag_import_ledger_baselines WHERE player_item_bag_import_completeness_projection_id=? ORDER BY ledger_sequence",
        [projectionId]
      );
      const currentStacks = await database.query<CurrentStackRow[]>(
        "SELECT player_id,item_id,owned_item_stack_id,CAST(quantity AS CHAR) quantity FROM canonical_owned_item_stacks WHERE player_id=? ORDER BY owned_item_stack_id",
        [context.canonicalPlayerId]
      );
      const currentLedgers = await database.query<CurrentLedgerRow[]>(
        "SELECT ledger.player_id,ledger.item_inventory_ledger_entry_id,ledger.item_inventory_operation_id,CAST(ordering.ledger_sequence AS CHAR) ledger_sequence,ledger.item_id,ledger.owned_item_stack_id,ledger.owned_item_id,CAST(ledger.quantity_delta AS CHAR) quantity_delta,ledger.reason_type FROM canonical_item_inventory_ledger_entries ledger LEFT JOIN canonical_item_inventory_ledger_orderings ordering ON ordering.item_inventory_ledger_entry_id=ledger.item_inventory_ledger_entry_id AND ordering.player_id=ledger.player_id WHERE ledger.player_id=? ORDER BY ordering.ledger_sequence,ledger.item_inventory_ledger_entry_id",
        [context.canonicalPlayerId]
      );
      const heads = await database.query<HeadRow[]>(
        "SELECT CAST(last_ledger_sequence AS CHAR) last_ledger_sequence FROM canonical_item_inventory_ledger_heads WHERE player_id=?",
        [context.canonicalPlayerId]
      );
      const baselines = stackRows.map(baselineStack);
      const baselineLedgers = ledgerRows.map(ledger);
      const liveLedgers = currentLedgers.map((row) => {
        const typed = ledger({ ...row, ledger_entry_fingerprint: "" });
        return { ...typed, ledgerEntryFingerprint: calculateItemBagLedgerEntryFingerprint(typed) };
      });
      const canonicalProjection = {
        player_id: context.canonicalPlayerId,
        object_domain_import_run_id: projection.object_domain_import_run_id,
        common_staging_record_id: projection.common_staging_record_id,
        projection_version: projection.projection_version,
        profile_semantic_sha256: projection.profile_semantic_sha256,
        import_contract_sha256: projection.import_contract_sha256,
        source_locator_sha256: projection.source_locator_sha256,
        source_payload_fingerprint: projection.source_payload_fingerprint,
        expected_source_key_count: Number(projection.expected_source_key_count),
        projected_stack_count: Number(projection.projected_stack_count),
        quarantined_source_key_count: Number(projection.quarantined_source_key_count),
        ignored_source_key_count: Number(projection.ignored_source_key_count),
        stack_set_fingerprint: projection.stack_set_fingerprint,
        item_ledger_entry_count: String(projection.item_ledger_entry_count),
        baseline_ledger_head_sequence: String(projection.baseline_ledger_head_sequence),
        item_ledger_set_fingerprint: projection.item_ledger_set_fingerprint,
        revision: String(projection.revision),
        active_flag: true
      };
      if (calculateItemBagCompletenessFingerprint(canonicalProjection) !== projection.completeness_fingerprint
        || baselines.length !== Number(projection.projected_stack_count) || BigInt(baselineLedgers.length) !== BigInt(projection.item_ledger_entry_count)
        || projection.item_ledger_entry_count !== projection.baseline_ledger_head_sequence
        || calculateItemBagStackBaselineSetFingerprint(baselines) !== projection.stack_set_fingerprint
        || calculateItemBagLedgerBaselineSetFingerprint(baselineLedgers) !== projection.item_ledger_set_fingerprint) return false;
      const currentHead = heads.length === 0 ? "0" : heads.length === 1 ? String(heads[0]!.last_ledger_sequence) : "";
      assertItemBagImportContinuation({
        playerId: context.canonicalPlayerId,
        baselineHeadSequence: projection.baseline_ledger_head_sequence,
        baselineStacks: baselines,
        baselineLedgers,
        currentHeadSequence: currentHead,
        currentStacks: currentStacks.map(currentStack),
        currentLedgers: liveLedgers
      });
      return true;
    } catch {
      return false;
    }
  }
}
