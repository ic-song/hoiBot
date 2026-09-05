import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

type Column = { name: string; type: string; nullable: boolean; charset?: string; collation?: string };
type ForeignKey = { columns: string[]; referencesTable: string; referencesColumns: string[]; onDelete: string };
type Check = { constraint: string; expression: string };
type Table = {
  table: string;
  kind: string;
  columns: Column[];
  primaryKey: string[];
  uniqueKeys: string[][];
  foreignKeys: ForeignKey[];
  checks?: Check[];
  supportTableBeyondRequiredReceipts?: boolean;
  requiredFor?: string;
  linklessTerminalAllowedFor?: string[];
  boundaryAlignment?: { contract: string; claimOwner: string; storageModel: string; requestKeyFormula: string; requestIdentityFingerprintFormula: string; requestNamespaceFormula: string; requestNamespaceFormulaEnforcement: string; identityFormulaEnforcement: string; identityFormulaLimitation: string; persistBeforeExecution: boolean; replay: string; stateTransitionEnforcement: string; stateTransitionLimitation: string; leaseAndFencing: string; recovery: string; atomicTypedReceipt: string };
  typedAssetReference?: { discriminator: string; referenceColumns: string[]; allowedMappings: Record<string, string>; cardinality: string };
  legacyIdentityResolution?: { legacyBigintColumnStored: boolean; joinPath: string[]; displayNameInference: string };
};
type Plan = {
  format: string;
  status: string;
  migrationFiles: string[];
  amendmentMigrations: Array<{ migration: string; rollback: string; kind: string; alters: string[]; creates: string[]; inputShape: string; resultingShape: string; createOnly: boolean; reentrantDdlRequired: boolean }>;
  ddlExecution: string;
  runtimeBoundaryContract: string;
  requiredAdditiveReceiptTables: string[];
  supportTablesBeyondRequiredReceipts: string[];
  globalPolicies: {
    newPrimaryKey: { generator: string; length: number; sqlType: string; charset: string; collation: string; collisionHandling: string };
    audit: { columns: string[]; timeZone: string; timeFormat: string; kstRegexp: string; databaseChecks: string[]; insertRule: string; insertRuleEnforcement: string; updateRule: string; updateRuleEnforcement: string; databaseDefaults: string; checkLimitation: string };
    replay: { uniqueColumns: string[] };
    definitionOwnership: string;
    identityResolution: string;
  };
  checkConstraintTemplates: Array<{ constraint: string; appliesTo?: string; appliesToKind?: string; expression: string }>;
  multiRoleOperations: Array<{ operationTable: string; actorColumn: string; participantTable: string; participantRoles: string[] }>;
  tables: Table[];
};
type TransitionContract = { requiredAdditiveReceiptTables: string[] };
type TargetSchema = { columns: Array<{ table: string; column: string; sqlType: string }> };
type RuntimeBoundary = {
  claimReplayStore: { table: string; requiredColumns: string[]; requiredKeys: string[] };
  requestIdentity: {
    storageModel: string;
    requestNamespace: { pattern: string; maxLength: number };
    entrypointKinds: string[];
    entrypointKindMaxLength: number;
    externalRequestId: { pattern: string; maxLength: number };
    externalRequestIdRequired: boolean;
    requestKey: { column: string; value: string; maxLength: number };
    requestIdentityFingerprint: { algorithm: string; encoding: string; length: number; canonicalInput: string; formula: string };
  };
  singleWriterClaim: { owner: string; states: string[] };
  routeDecision: { allowedRoutes: string[]; persistBeforeExecution: boolean; persistedFields: string[] };
  environmentContext: { fields: { environmentCode: { allowed: string[] } } };
};

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, "utf8")) as T;
}

const plan = readJson<Plan>(new URL("../../migration-control/contracts/object-db-consumer-additive-schema-plan.v1.json", import.meta.url));
const transition = readJson<TransitionContract>(new URL("../../migration-control/contracts/object-db-consumer-transition.v1.json", import.meta.url));
const targetSchema = readJson<TargetSchema>(new URL("../../migration-control/contracts/object-domain-import-target-schema.v1.json", import.meta.url));
const runtimeBoundary = readJson<RuntimeBoundary>(new URL("../../migration-control/contracts/object-db-transition-runtime-boundary.v1.json", import.meta.url));
const tables = new Map(plan.tables.map((table) => [table.table, table]));
const auditColumns = ["INSERT_USER", "INSERT_TIME", "UPDATE_USER", "UPDATE_TIME"];

function column(table: Table, name: string): Column {
  const found = table.columns.find((candidate) => candidate.name === name);
  assert.ok(found, `${table.table}.${name}`);
  return found;
}

function check(table: Table, constraint: string): Check {
  const found = table.checks?.find((candidate) => candidate.constraint === constraint);
  assert.ok(found, `${table.table}.${constraint}`);
  return found;
}

function quotedValues(expression: string): string[] {
  return Array.from(expression.matchAll(/'([^']+)'/g), (match) => match[1]!).sort();
}

function boundaryColumnDefinition(candidate: Column): string {
  const characterStorage = /^CHAR\(/.test(candidate.type) && candidate.charset !== undefined && candidate.collation !== undefined
    ? ` CHARACTER SET ${candidate.charset} COLLATE ${candidate.collation}`
    : "";
  return `${candidate.name} ${candidate.type}${characterStorage}${candidate.nullable ? " NULL" : ""}`;
}

function externalColumn(table: string, name: string): Column {
  if (table === "external_identities" && name === "provider_code") return { name, type: "VARCHAR(64)", nullable: false, charset: "ascii", collation: "ascii_bin" };
  if (table === "external_identities" && name === "external_user_id") return { name, type: "VARCHAR(191)", nullable: false, charset: "utf8mb4", collation: "utf8mb4_bin" };
  const found = targetSchema.columns.find((candidate) => candidate.table === table && candidate.column === name);
  assert.ok(found, `authoritative target is missing ${table}.${name}`);
  return { name, type: found.sqlType, nullable: false, charset: found.sqlType === "CHAR(8)" ? "ascii" : undefined, collation: found.sqlType === "CHAR(8)" ? "ascii_bin" : undefined };
}

describe("WBS743 Gate 2 additive consumer schema proposal", () => {
  it("keeps runtime integration blocking and covers exactly the eleven missing receipt tables with ordered additive migrations", () => {
    assert.equal(plan.format, "hoibot-object-db-consumer-additive-schema-plan-v1");
    assert.equal(plan.status, "IMPLEMENTED_BLOCKING_RUNTIME_INTEGRATION");
    assert.deepEqual(plan.migrationFiles, [
      "461_object_db_transition_identity_crosswalk.sql",
      "462_object_db_transition_app_wiring_claim.sql",
      "463_object_db_transition_operation_receipts.sql",
      "464_object_db_transition_typed_asset_ledgers.sql",
      "465_object_db_transition_operation_participants.sql"
    ]);
    assert.deepEqual(plan.amendmentMigrations, [{
      migration: "466_object_db_transition_recovery_receipt_links.sql",
      rollback: "466_object_db_transition_recovery_receipt_links.rollback.sql",
      kind: "ADDITIVE_ALTER_AND_RECOVERY_RECEIPT_LINK",
      alters: ["canonical_app_wiring_operations"],
      creates: ["canonical_app_wiring_receipt_links"],
      inputShape: "MIGRATION_462_CLAIM_STORE",
      resultingShape: "MIGRATION_466_BASE_RECEIPT_LINK",
      createOnly: false,
      reentrantDdlRequired: true
    }, {
      migration: "470_pet_explore_event_control_app_wiring.sql",
      rollback: "470_pet_explore_event_control_app_wiring.rollback.sql",
      kind: "ADDITIVE_EVENT_CONTROL_TYPED_RECEIPT_LINK",
      alters: ["canonical_app_wiring_receipt_links"],
      creates: ["canonical_pet_explore_event_control_operations"],
      inputShape: "MIGRATION_466_BASE_RECEIPT_LINK",
      resultingShape: "MIGRATION_470_FINAL_RECEIPT_LINK",
      createOnly: false,
      reentrantDdlRequired: true
    }, {
      migration: "472_pet_title_admin_batch_app_wiring.sql",
      rollback: "472_pet_title_admin_batch_app_wiring.rollback.sql",
      kind: "ADDITIVE_PET_TITLE_ADMIN_BATCH_TYPED_RECEIPT_LINK",
      alters: ["canonical_app_wiring_receipt_links"],
      creates: ["canonical_pet_title_global_locks", "canonical_pet_title_batch_operations", "canonical_pet_title_batch_operation_targets", "canonical_pet_title_batch_operation_participants"],
      inputShape: "MIGRATION_470_FINAL_RECEIPT_LINK",
      resultingShape: "MIGRATION_472_FINAL_RECEIPT_LINK",
      createOnly: false,
      reentrantDdlRequired: true
    }, {
      migration: "474_pet_title_batch_member_key_snapshot.sql",
      rollback: "474_pet_title_batch_member_key_snapshot.rollback.sql",
      kind: "ADDITIVE_PET_TITLE_BATCH_MEMBER_KEY_SNAPSHOT_AND_RESULT_CONTRACT",
      alters: ["canonical_pet_title_batch_operations", "canonical_pet_title_batch_operation_targets"],
      creates: [],
      inputShape: "MIGRATION_472_FINAL_RECEIPT_LINK",
      resultingShape: "MIGRATION_474_REPLAY_SAFE_MEMBER_KEY_SNAPSHOT",
      operationalDataDependency: "SEPARATE_WBS_REQUIRED: import each LEGACY_JSON display value into player_profiles or a linked external identity before migration 474; player_id and source_identifier are never nickname fallbacks",
      createOnly: false,
      reentrantDdlRequired: true
    }]);
    assert.equal(plan.ddlExecution, "NEW_MIGRATIONS_ONLY_TEST_DATABASE_VALIDATION_REQUIRED");
    assert.deepEqual(plan.requiredAdditiveReceiptTables, transition.requiredAdditiveReceiptTables);
    assert.equal(plan.requiredAdditiveReceiptTables.length, 11);
    assert.deepEqual(plan.requiredAdditiveReceiptTables.filter((name) => !tables.has(name)), []);
    assert.ok(!plan.requiredAdditiveReceiptTables.includes("canonical_app_wiring_operations"));
    assert.ok(plan.supportTablesBeyondRequiredReceipts.includes("canonical_app_wiring_operations"));
    assert.ok(plan.supportTablesBeyondRequiredReceipts.includes("canonical_app_wiring_receipt_links"));
    assert.ok(plan.supportTablesBeyondRequiredReceipts.includes("canonical_pet_explore_event_control_operations"));
    assert.deepEqual(plan.supportTablesBeyondRequiredReceipts.filter((name) => !tables.has(name)), []);
    assert.equal(new Set(plan.tables.map(({ table }) => table)).size, plan.tables.length);
  });

  it("uses concrete CUID2 CHAR(8) ascii/ascii_bin primary keys and mandatory KST audit columns on every proposed table", () => {
    assert.deepEqual(plan.globalPolicies.newPrimaryKey, {
      generator: "CUID2", length: 8, sqlType: "CHAR(8)", charset: "ascii", collation: "ascii_bin",
      collisionHandling: "PK_OR_UNIQUE_DETECT_AND_BOUNDED_RETRY_BY_SHARED_PROVIDER"
    });
    assert.deepEqual(plan.globalPolicies.audit.columns, auditColumns);
    assert.equal(plan.globalPolicies.audit.timeZone, "Asia/Seoul");
    assert.equal(plan.globalPolicies.audit.timeFormat, "YYYY-MM-DD HH:MM:SS");
    assert.equal(plan.globalPolicies.audit.kstRegexp, "^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01]) ([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$");
    assert.deepEqual(plan.globalPolicies.audit.databaseChecks, [
      "CHECK (INSERT_TIME REGEXP <kstRegexp>)", "CHECK (UPDATE_TIME REGEXP <kstRegexp>)"
    ]);
    assert.match(plan.globalPolicies.audit.insertRule, /INSERT_USER=UPDATE_USER and INSERT_TIME=UPDATE_TIME/);
    assert.match(plan.globalPolicies.audit.insertRuleEnforcement, /PROVIDER_OR_BEFORE_INSERT_TRIGGER/);
    assert.match(plan.globalPolicies.audit.updateRuleEnforcement, /PROVIDER_OR_BEFORE_UPDATE_TRIGGER/);
    assert.equal(plan.globalPolicies.audit.databaseDefaults, "FORBIDDEN_FOR_AUDIT_ACTOR_AND_CLOCK");
    assert.match(plan.globalPolicies.audit.checkLimitation, /cannot distinguish INSERT from UPDATE or compare OLD and NEW rows/);
    assert.deepEqual(plan.checkConstraintTemplates.map(({ constraint }) => constraint), [
      "audit_insert_time_kst", "audit_update_time_kst", "operation_status_allowed"
    ]);
    assert.equal(plan.checkConstraintTemplates.filter(({ appliesTo }) => appliesTo === "ALL_PROPOSED_TABLES").length, 2);
    assert.equal(plan.checkConstraintTemplates.find(({ constraint }) => constraint === "operation_status_allowed")?.expression,
      "operation_status IN ('COMPLETED','FAILED')");
    for (const table of plan.tables) {
      assert.equal(table.primaryKey.length, 1, `${table.table}: single concrete PK`);
      const pk = column(table, table.primaryKey[0]!);
      assert.doesNotMatch(pk.name, /^(?:id|code)$/i, `${table.table}: generic PK`);
      assert.deepEqual({ type: pk.type, nullable: pk.nullable, charset: pk.charset, collation: pk.collation }, {
        type: "CHAR(8)", nullable: false, charset: "ascii", collation: "ascii_bin"
      }, `${table.table}.${pk.name}`);
      assert.equal(table.columns.some(({ name }) => /^(?:id|code)$/i.test(name)), false, `${table.table}: standalone id/CODE`);
      assert.deepEqual(table.columns.filter(({ name }) => auditColumns.includes(name)).map(({ name }) => name), auditColumns, `${table.table}: audit columns`);
      assert.equal(column(table, "INSERT_USER").type, "VARCHAR(100)");
      assert.equal(column(table, "UPDATE_USER").type, "VARCHAR(100)");
      assert.equal(column(table, "INSERT_TIME").type, "CHAR(19)");
      assert.equal(column(table, "UPDATE_TIME").type, "CHAR(19)");
      for (const name of auditColumns) assert.equal(column(table, name).nullable, false, `${table.table}.${name}: audit NOT NULL`);
    }
  });

  it("keeps every FK name and storage type identical to its referenced key", () => {
    for (const table of plan.tables) {
      for (const fk of table.foreignKeys) {
        assert.equal(fk.columns.length, fk.referencesColumns.length, `${table.table}: FK arity`);
        assert.equal(fk.onDelete, "RESTRICT", `${table.table}: destructive cascade`);
        fk.columns.forEach((name, index) => {
          const referenceName = fk.referencesColumns[index]!;
          assert.equal(name, referenceName, `${table.table}.${name}: FK name mismatch`);
          const local = column(table, name);
          const targetTable = tables.get(fk.referencesTable);
          const referenced = targetTable ? column(targetTable, referenceName) : externalColumn(fk.referencesTable, referenceName);
          assert.deepEqual({ type: local.type, charset: local.charset, collation: local.collation }, {
            type: referenced.type, charset: referenced.charset, collation: referenced.collation
          }, `${table.table}.${name} -> ${fk.referencesTable}.${referenceName}`);
        });
      }
    }
  });

  it("declares actor-scoped replay uniqueness and payload drift evidence on every operation receipt", () => {
    assert.deepEqual(plan.globalPolicies.replay.uniqueColumns, ["replay_namespace", "player_id", "request_key"]);
    const operations = plan.tables.filter(({ kind }) => kind === "OPERATION_RECEIPT");
    assert.equal(operations.length, 9);
    for (const table of operations) {
      assert.ok(table.uniqueKeys.some((key) => JSON.stringify(key) === JSON.stringify(plan.globalPolicies.replay.uniqueColumns)), `${table.table}: replay unique`);
      assert.equal(column(table, "payload_fingerprint").type, "CHAR(64)");
      assert.equal(column(table, "result_fingerprint").type, "CHAR(64)");
      assert.equal(column(table, "player_id").nullable, false);
    }
  });

  it("represents multiple player roles with typed participant rows rather than role-shaped FK names", () => {
    assert.ok(plan.multiRoleOperations.length > 0);
    for (const relation of plan.multiRoleOperations) {
      assert.equal(relation.actorColumn, "player_id", `${relation.operationTable}: sole receipt actor`);
      assert.equal(relation.participantRoles.includes("ACTOR"), false, `${relation.operationTable}: duplicate actor participant`);
      assert.ok(relation.participantRoles.length > 0, `${relation.operationTable}: participant roles`);
      const operation = tables.get(relation.operationTable);
      const participant = tables.get(relation.participantTable);
      assert.ok(operation, relation.operationTable);
      assert.ok(participant, relation.participantTable);
      assert.equal(participant.kind, "OPERATION_PARTICIPANT");
      assert.equal(operation.columns.some(({ name }) => /^(?:seller|buyer|owner|recipient|subject|target|home_owner|actor)_player_id$/.test(name)), false, `${operation.table}: role-shaped player FK`);
      assert.equal(column(participant, "player_id").type, "CHAR(8)");
      assert.equal(column(participant, "participant_role").type, "VARCHAR(32)");
      const roleExpression = participant.checks?.find(({ constraint }) => constraint.endsWith("participant_role_allowed"))?.expression;
      assert.ok(roleExpression, `${participant.table}: role CHECK`);
      assert.deepEqual(quotedValues(roleExpression), relation.participantRoles.slice().sort(), `${participant.table}: exact role set`);
      assert.doesNotMatch(roleExpression, /'ACTOR'/, `${participant.table}: ACTOR must only be the receipt player_id`);
      const operationPk = operation.primaryKey[0]!;
      assert.ok(participant.foreignKeys.some((fk) => fk.columns[0] === operationPk && fk.referencesTable === operation.table), `${participant.table}: operation FK`);
      assert.ok(participant.uniqueKeys.some((key) => key.includes(operationPk) && key.includes("player_id") && key.includes("participant_role")), `${participant.table}: role uniqueness`);
    }
  });

  it("uses exactly-one typed asset references for market transfers and package rewards", () => {
    const ledgers = plan.tables.filter(({ kind }) => kind === "TYPED_ASSET_LEDGER");
    assert.deepEqual(ledgers.map(({ table }) => table).sort(), [
      "canonical_market_transfer_ledger_entries", "canonical_package_use_reward_ledger_entries"
    ]);
    for (const table of ledgers) {
      const typed = table.typedAssetReference;
      assert.ok(typed, table.table);
      assert.equal(typed.cardinality, "EXACTLY_ONE_NON_NULL");
      assert.equal(typed.discriminator, "asset_type");
      assert.ok(typed.referenceColumns.length > 1);
      assert.equal(new Set(typed.referenceColumns).size, typed.referenceColumns.length);
      assert.deepEqual(Object.values(typed.allowedMappings).sort(), typed.referenceColumns.slice().sort(), `${table.table}: asset type mapping closure`);
      for (const name of typed.referenceColumns) {
        assert.equal(column(table, name).nullable, true, `${table.table}.${name}`);
        assert.ok(table.foreignKeys.some((fk) => fk.columns.length === 1 && fk.columns[0] === name), `${table.table}.${name}: typed FK`);
      }
      const allowed = check(table, table.table === "canonical_market_transfer_ledger_entries" ? "market_transfer_asset_type_allowed" : "package_reward_asset_type_allowed");
      const exactlyOne = check(table, table.table === "canonical_market_transfer_ledger_entries" ? "market_transfer_typed_reference_exactly_one" : "package_reward_typed_reference_exactly_one");
      const mapping = check(table, table.table === "canonical_market_transfer_ledger_entries" ? "market_transfer_asset_type_matches_reference" : "package_reward_asset_type_matches_reference");
      assert.deepEqual(quotedValues(allowed.expression), Object.keys(typed.allowedMappings).sort(), `${table.table}: exact allowed asset types`);
      for (const [assetType, referenceColumn] of Object.entries(typed.allowedMappings)) {
        assert.match(allowed.expression, new RegExp(`'${assetType}'`), `${table.table}:${assetType}:allowed`);
        assert.match(exactlyOne.expression, new RegExp(`${referenceColumn} IS NOT NULL`), `${table.table}:${referenceColumn}:one-of`);
        assert.match(mapping.expression, new RegExp(`asset_type='${assetType}' AND ${referenceColumn} IS NOT NULL`), `${table.table}:${assetType}:mapping`);
      }
      assert.match(exactlyOne.expression, /= 1$/);
      assert.equal(table.columns.some(({ name }) => /^(?:asset|object)_id$|(?:asset|object)_code$|display_name$/i.test(name)), false, `${table.table}: generic asset reference`);
    }
    const packageLedger = tables.get("canonical_package_use_reward_ledger_entries");
    const marketLedger = tables.get("canonical_market_transfer_ledger_entries");
    assert.ok(marketLedger);
    assert.ok(packageLedger);
    assert.equal(
      check(marketLedger, "market_transfer_direction_quantity_sign_matches").expression,
      "(transfer_direction='DEBIT' AND quantity_delta < 0) OR (transfer_direction='CREDIT' AND quantity_delta > 0)"
    );
    assert.equal(check(packageLedger, "package_reward_quantity_positive").expression, "quantity_delta > 0");
    assert.ok(packageLedger.typedAssetReference?.referenceColumns.includes("package_id"), "nested package reward FK");
    assert.ok(packageLedger.typedAssetReference?.referenceColumns.includes("pet_id"), "pet reward FK");
  });

  it("uses deterministic per-operation ledger line keys instead of uniques that contain their own PK", () => {
    const market = tables.get("canonical_market_transfer_ledger_entries");
    const rewards = tables.get("canonical_package_use_reward_ledger_entries");
    assert.ok(market);
    assert.ok(rewards);
    assert.ok(market.uniqueKeys.some((key) => JSON.stringify(key) === JSON.stringify(["market_operation_id", "line_key"])));
    assert.ok(rewards.uniqueKeys.some((key) => JSON.stringify(key) === JSON.stringify(["package_use_operation_id", "reward_sequence"])));
    for (const table of [market, rewards]) {
      const primaryKey = table.primaryKey[0]!;
      assert.equal(table.uniqueKeys.some((key) => key.includes(primaryKey)), false, `${table.table}: meaningless PK-bearing unique`);
    }
  });

  it("does not copy definition-owned values into receipts, ledgers, participants or crosswalks", () => {
    assert.match(plan.globalPolicies.definitionOwnership, /remain in definition tables/);
    const forbidden = /^(?:name|display_name|description|grade|price|sale_price|purchase_price|base_charm|charm_per_enhancement|final_charm|common_effect|definition_options)$/i;
    for (const table of plan.tables) {
      assert.deepEqual(table.columns.filter(({ name }) => forbidden.test(name)).map(({ name }) => name), [], table.table);
    }
  });

  it("aligns the shared app-wiring claim and route replay support table to the runtime boundary", () => {
    assert.equal(plan.runtimeBoundaryContract, "object-db-transition-runtime-boundary.v1.json");
    const appWiring = tables.get("canonical_app_wiring_operations");
    assert.ok(appWiring);
    assert.equal(appWiring.kind, "APP_WIRING_CLAIM_RECEIPT");
    assert.equal(appWiring.supportTableBeyondRequiredReceipts, true);
    assert.equal(appWiring.boundaryAlignment?.contract, plan.runtimeBoundaryContract);
    assert.equal(appWiring.boundaryAlignment?.claimOwner, runtimeBoundary.singleWriterClaim.owner);
    assert.equal(appWiring.boundaryAlignment?.persistBeforeExecution, runtimeBoundary.routeDecision.persistBeforeExecution);
    assert.match(appWiring.boundaryAlignment?.storageModel ?? "", /separate columns/);
    assert.match(appWiring.boundaryAlignment?.storageModel ?? "", /ambiguous concatenated identity storage is forbidden/);
    assert.equal(appWiring.boundaryAlignment?.requestKeyFormula, runtimeBoundary.requestIdentity.requestKey.value);
    assert.equal(appWiring.boundaryAlignment?.requestIdentityFingerprintFormula, runtimeBoundary.requestIdentity.requestIdentityFingerprint.formula);
    assert.equal(appWiring.boundaryAlignment?.requestNamespaceFormula, "hoibot:<environment_code>:<database_identity>");
    assert.equal(appWiring.boundaryAlignment?.requestNamespaceFormulaEnforcement, "DATABASE_CHECK_AND_SHARED_APP_WIRING_PROVIDER_BEFORE_INSERT");
    assert.equal(appWiring.boundaryAlignment?.identityFormulaEnforcement, "SHARED_APP_WIRING_PROVIDER_BEFORE_INSERT");
    assert.match(appWiring.boundaryAlignment?.identityFormulaLimitation ?? "", /shared provider must derive request_key and SHA-256/);
    assert.match(appWiring.boundaryAlignment?.stateTransitionEnforcement ?? "", /PROVIDER_OR_DATABASE_PROCEDURE_WITH_ROW_LOCK/);
    assert.match(appWiring.boundaryAlignment?.stateTransitionLimitation ?? "", /CHECK validates the current state only/);
    assert.match(appWiring.boundaryAlignment?.leaseAndFencing ?? "", /stale generations fail closed/);
    assert.match(appWiring.boundaryAlignment?.recovery ?? "", /READ_ONLY routes cannot enter MUTATION_STARTED/);
    assert.match(appWiring.boundaryAlignment?.atomicTypedReceipt ?? "", /Only an effect_mode=MUTATION terminal/);
    assert.match(appWiring.boundaryAlignment?.atomicTypedReceipt ?? "", /READ_ONLY and REJECT terminal outcomes are valid without a link/);
    for (const name of [
      "claim_state", "route", "environment_code", "database_identity", "request_namespace", "entrypoint_kind",
      "external_request_id", "request_key", "request_identity_fingerprint", "payload_fingerprint", "result_json", "error_code", "command_code", "handler_key"
    ]) column(appWiring, name);
    assert.equal(appWiring.columns.some(({ name }) => name === "request_identity_key" || name === "fixed_request_fingerprint"), false);
    assert.deepEqual({ type: column(appWiring, "request_namespace").type, nullable: column(appWiring, "request_namespace").nullable }, { type: `VARCHAR(${runtimeBoundary.requestIdentity.requestNamespace.maxLength})`, nullable: false });
    assert.deepEqual({ type: column(appWiring, "entrypoint_kind").type, nullable: column(appWiring, "entrypoint_kind").nullable }, { type: `VARCHAR(${runtimeBoundary.requestIdentity.entrypointKindMaxLength})`, nullable: false });
    assert.deepEqual({ type: column(appWiring, "external_request_id").type, nullable: column(appWiring, "external_request_id").nullable }, { type: `VARCHAR(${runtimeBoundary.requestIdentity.externalRequestId.maxLength})`, nullable: !runtimeBoundary.requestIdentity.externalRequestIdRequired });
    assert.deepEqual({ type: column(appWiring, "request_key").type, nullable: column(appWiring, "request_key").nullable }, { type: `VARCHAR(${runtimeBoundary.requestIdentity.requestKey.maxLength})`, nullable: false });
    assert.deepEqual({ type: column(appWiring, "request_identity_fingerprint").type, charset: column(appWiring, "request_identity_fingerprint").charset, collation: column(appWiring, "request_identity_fingerprint").collation }, { type: `CHAR(${runtimeBoundary.requestIdentity.requestIdentityFingerprint.length})`, charset: "ascii", collation: "ascii_bin" });
    assert.equal(column(appWiring, "environment_code").type, "VARCHAR(4)");
    assert.equal(column(appWiring, "database_identity").type, "VARCHAR(64)");
    assert.deepEqual({ type: column(appWiring, "reason_code").type, nullable: column(appWiring, "reason_code").nullable }, { type: "VARCHAR(100)", nullable: false });
    assert.deepEqual({ type: column(appWiring, "result_json").type, nullable: column(appWiring, "result_json").nullable }, { type: "LONGTEXT", nullable: true });
    assert.deepEqual({ type: column(appWiring, "error_code").type, nullable: column(appWiring, "error_code").nullable }, { type: "VARCHAR(100)", nullable: true });
    const amendmentColumns = new Set(["effect_mode", "lease_token", "lease_generation", "lease_expires_time", "attempt_count", "recovery_status", "recovery_code"]);
    const legacyCompatibilityNullable = new Set(["effect_mode", "lease_generation", "attempt_count", "recovery_status"]);
    assert.deepEqual(appWiring.columns.map((candidate) => {
      const definition = boundaryColumnDefinition(candidate);
      return legacyCompatibilityNullable.has(candidate.name) ? definition.replace(/ NULL$/, "") : definition;
    }), runtimeBoundary.claimReplayStore.requiredColumns,
    "canonical_app_wiring_operations final columns must match required writer shape while the amendment keeps its legacy all-NULL bundle storage-compatible");
    for (const name of legacyCompatibilityNullable) assert.equal(column(appWiring, name).nullable, true, `${name}: migration 466 legacy compatibility`);
    assert.deepEqual(appWiring.columns.filter(({ name }) => amendmentColumns.has(name)).map(({ name }) => name), [...amendmentColumns]);
    for (const constraint of ["app_wiring_effect_mode_allowed", "app_wiring_lease_pair", "app_wiring_live_lease_generation", "app_wiring_recovery_state"]) check(appWiring, constraint);
    assert.deepEqual([
      `PRIMARY KEY (${appWiring.primaryKey.join(", ")})`,
      ...appWiring.uniqueKeys.map((key) => `UNIQUE KEY (${key.join(", ")})`)
    ], runtimeBoundary.claimReplayStore.requiredKeys);
    assert.ok(appWiring.uniqueKeys.some((key) => JSON.stringify(key) === JSON.stringify(["request_identity_fingerprint"])));
    assert.ok(appWiring.uniqueKeys.some((key) => JSON.stringify(key) === JSON.stringify(["request_namespace", "request_key"])));
    const entrypoints = check(appWiring, "app_wiring_entrypoint_allowed").expression;
    const states = check(appWiring, "app_wiring_claim_state_allowed").expression;
    const routes = check(appWiring, "app_wiring_route_allowed").expression;
    const environments = check(appWiring, "app_wiring_environment_allowed").expression;
    assert.deepEqual(quotedValues(entrypoints), runtimeBoundary.requestIdentity.entrypointKinds.slice().sort());
    assert.deepEqual(quotedValues(states), runtimeBoundary.singleWriterClaim.states.slice().sort());
    assert.deepEqual(quotedValues(routes), runtimeBoundary.routeDecision.allowedRoutes.slice().sort());
    assert.deepEqual(quotedValues(environments), runtimeBoundary.environmentContext.fields.environmentCode.allowed.slice().sort());
    assert.equal(check(appWiring, "app_wiring_request_namespace_shape").expression, `request_namespace REGEXP '${runtimeBoundary.requestIdentity.requestNamespace.pattern}'`);
    assert.equal(check(appWiring, "app_wiring_request_namespace_matches_environment_database").expression,
      "request_namespace = CONCAT('hoibot:', environment_code, ':', database_identity)");
    assert.equal(check(appWiring, "app_wiring_external_request_id_shape").expression, `external_request_id REGEXP '${runtimeBoundary.requestIdentity.externalRequestId.pattern}'`);
    assert.equal(check(appWiring, "app_wiring_request_identity_fingerprint_shape").expression, "request_identity_fingerprint REGEXP '^[0-9a-f]{64}$'");
    assert.equal(check(appWiring, "app_wiring_payload_fingerprint_shape").expression, "payload_fingerprint REGEXP '^[0-9a-f]{64}$'");
    assert.equal(check(appWiring, "app_wiring_command_or_handler_present").expression,
      "route = 'REJECT' OR command_code IS NOT NULL OR handler_key IS NOT NULL");
    assert.doesNotThrow(() => {
      assert.match(check(appWiring, "app_wiring_command_or_handler_present").expression, /route = 'REJECT'/);
    }, "unmatched REJECT may persist with command_code and handler_key both NULL");
    assert.match(appWiring.boundaryAlignment?.replay ?? "", /UNIQUE request_identity_fingerprint/);
    assert.match(appWiring.boundaryAlignment?.replay ?? "", /payload drift fails closed/);
  });

  it("models the app-wiring typed receipt link with one discriminated FK and atomic replay evidence", () => {
    const link = tables.get("canonical_app_wiring_receipt_links");
    assert.ok(link);
    assert.equal(link.kind, "APP_WIRING_TYPED_RECEIPT_LINK");
    assert.equal(link.supportTableBeyondRequiredReceipts, true);
    assert.equal(link.requiredFor, "MUTATION_TERMINAL_ONLY");
    assert.deepEqual(link.linklessTerminalAllowedFor, ["READ_ONLY", "REJECT"]);
    assert.equal(link.columns.length, 19);
    assert.equal(link.uniqueKeys.length, 12);
    assert.equal(link.foreignKeys.length, 12);
    assert.ok(link.foreignKeys.every(({ onDelete }) => onDelete === "RESTRICT"));
    assert.equal(check(link, "app_wiring_receipt_result_fingerprint_shape").expression, "result_fingerprint REGEXP '^[0-9a-f]{64}$'");
    assert.match(check(link, "chk_odbt_472_03_rule_01").expression, /= 1$/);
    for (const kind of ["DAILY_PRAYER", "HOME_AGGREGATE", "MARKET", "MEMBER_TITLE", "MINI_PET_TITLE", "PACKAGE_USE", "PET_EXPLORE", "PET_EXPLORE_EVENT_CONTROL", "PET_TITLE", "PET_TITLE_BATCH", "PLAYER_IDENTITY"]) {
      assert.match(check(link, "chk_odbt_472_03_rule_02").expression, new RegExp(`receipt_kind = '${kind}'`));
    }
  });

  it("bridges external identity by the persisted composite key and canonical player FK without BIGINT or display-name inference", () => {
    const crosswalk = tables.get("canonical_player_identity_crosswalks");
    assert.ok(crosswalk);
    assert.deepEqual(crosswalk.uniqueKeys, [["provider_code", "external_user_id"]]);
    assert.ok(crosswalk.foreignKeys.some((fk) => fk.referencesTable === "external_identities"
      && JSON.stringify(fk.columns) === JSON.stringify(["provider_code", "external_user_id"])
      && JSON.stringify(fk.referencesColumns) === JSON.stringify(["provider_code", "external_user_id"])));
    assert.ok(crosswalk.foreignKeys.some((fk) => fk.referencesTable === "canonical_players"
      && JSON.stringify(fk.columns) === JSON.stringify(["player_id"])));
    assert.equal(crosswalk.columns.some(({ type }) => /BIGINT/i.test(type)), false);
    assert.equal(crosswalk.columns.some(({ name }) => /display_name/i.test(name)), false);
    assert.equal(crosswalk.legacyIdentityResolution?.legacyBigintColumnStored, false);
    assert.deepEqual(crosswalk.legacyIdentityResolution?.joinPath, [
      "external_identities(provider_code,external_user_id)",
      "canonical_player_identity_crosswalks(provider_code,external_user_id)",
      "canonical_players(player_id)"
    ]);
    assert.equal(crosswalk.legacyIdentityResolution?.displayNameInference, "FORBIDDEN");
    assert.equal(check(crosswalk, "crosswalk_status_allowed").expression, "crosswalk_status IN ('LINKED','REVOKED')");
    assert.match(plan.globalPolicies.identityResolution, /Never cast or copy legacy BIGINT identity/);
    assert.match(plan.globalPolicies.identityResolution, /never infer identity from display_name/);
  });
});
