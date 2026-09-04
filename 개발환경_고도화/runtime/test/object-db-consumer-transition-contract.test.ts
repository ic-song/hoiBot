import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  OBJECT_DB_CONSUMER_BASELINE_COMMIT,
  canonicalizeObjectDbConsumerSourceText,
  readCanonicalObjectDbConsumerSource
} from "../src/data-migration/object-db-consumer-baseline.js";
import { deriveConsumerManifest, rawAppMessageGuardKinds } from "../src/data-migration/object-db-consumer-transition-audit.js";
import { auditObjectDbRuntimeAdoption } from "../src/data-migration/object-db-runtime-adoption-audit.js";

type SourceSurface = { file: string; terms: string[] };
type Slice = {
  ordinal: number;
  sliceId: string;
  legacyConsumers: string[];
  sourceEvidence: string[];
  bindings: string[];
  portPlan: string;
  lockOrder: string[];
  transaction: string;
  rollback: string;
  replay: string;
  outbox: string;
  environmentPartition: string;
};
type Condition = { conditionId: string; status: string; ownerSlices: string[]; affectedConsumerRule: string; requirement: string; additivePlan: string };
type Contract = {
  format: string;
  status: string;
  baseCommit: string;
  baselinePolicy: { baseCommitRole: string; baselinePin: string; headEqualityRequired: boolean; verification: string };
  sourceTextNormalization: { rule: string; implementation: string; manifestValue: string };
  globalRules: Record<string, string>;
  frozenSourceHashes: Record<string, string>;
  implementationEvidence: {
    checkpointDate: string;
    status: string;
    acceptedPhases: string[];
    p2MariaVerification: string;
    runtimeEntrypointCallCount: number;
    ingressAdoption: string;
    hashNormalization: string;
    currentImplementationSourceHashes: Record<string, string>;
    sourceSurfaces: SourceSurface[];
  };
  sliceTargetDomains: Record<string, string[]>;
  consumerManifestContract: string;
  canonicalBindingPolicy: string;
  sourceSurfaces: SourceSurface[];
  runtimeAdoption: {
    status: string;
    entrypointRunner: string;
    productionSourceCallCount: number;
    connectedIngressFamilies: string[];
    pendingIngressFamilies: string[];
    reviewedSourceHashes: {
      appSourceSha256: string;
      petExploreIngressSourceSha256: string;
      petExploreEventControlProviderSourceSha256: string;
      appWiringOperationProviderSourceSha256: string;
      petExploreEventControlMigrationSourceSha256: string;
      petExploreEventControlRollbackSourceSha256: string;
      petDataCompareIngressSourceSha256: string;
      petDataCompareShadowEvaluatorSourceSha256: string;
    };
    auditHelper: string;
    currentAppBoundary: string;
    cutoverClaimed: boolean;
  };
  slices: Slice[];
  gate2P1Conditions: Condition[];
  requiredAdditiveReceiptTables: string[];
  observedDifferences: string[];
  forbidden: string[];
};

const contractUrl = new URL("../../migration-control/contracts/object-db-consumer-transition.v1.json", import.meta.url);
const contract = JSON.parse(readCanonicalObjectDbConsumerSource(contractUrl)) as Contract;
const consumerManifest = JSON.parse(readCanonicalObjectDbConsumerSource(new URL("../../migration-control/contracts/object-db-consumer-manifest.v1.json", import.meta.url))) as ReturnType<typeof deriveConsumerManifest>;
const repoUrl = new URL("../../../", import.meta.url);
const targetSchema = JSON.parse(readRepoFile("개발환경_고도화/migration-control/contracts/object-domain-import-target-schema.v1.json")) as {
  columns: Array<{ table: string; column: string; sqlType: string; nullable: boolean; migration: string }>;
};
const fieldMap = JSON.parse(readRepoFile("개발환경_고도화/migration-control/contracts/object-domain-import-field-map.v1.json")) as {
  mappings: Array<{ domain: string; targetTables: string[]; fields: Array<{ targetColumns: string[] }> }>;
};
const targetColumnTypes = new Map(targetSchema.columns.map((entry) => [`${entry.table}.${entry.column}`, entry.sqlType]));
const migrationsUrl = new URL("../migrations/", import.meta.url);
const migrationEntries = readdirSync(migrationsUrl)
  .filter((name) => name.endsWith(".sql"))
  .map((name) => ({ name, text: readCanonicalObjectDbConsumerSource(new URL(name, migrationsUrl)) }));
const migrationCorpus = migrationEntries.map(({ text }) => text).join("\n");
type StandardForeignKey = { column?: string; columns?: string[]; referencesTable: string; referencesColumn?: string; referencesColumns?: string[] };
type StandardTable = { table: string; columns: Array<{ name: string; type: string; charset?: string; collation?: string }>; primaryKey: string[]; foreignKeys?: StandardForeignKey[] };
const parsedStandard = JSON.parse(readRepoFile("개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json")) as {
  tables: StandardTable[];
  externalDependencies?: StandardTable[];
};
const standard = { ...parsedStandard, tables: [...parsedStandard.tables, ...(parsedStandard.externalDependencies ?? [])] };

function foreignKeyPairs(foreignKey: StandardForeignKey): Array<{ column: string; referencesColumn: string }> {
  const columns = foreignKey.column === undefined ? foreignKey.columns ?? [] : [foreignKey.column];
  const referencesColumns = foreignKey.referencesColumn === undefined ? foreignKey.referencesColumns ?? [] : [foreignKey.referencesColumn];
  assert.equal(columns.length, referencesColumns.length, `${foreignKey.referencesTable}:FK-ARITY`);
  return columns.map((column, index) => ({ column, referencesColumn: referencesColumns[index]! }));
}
const ddlMetadata = new Map<string, { tableOwners: string[]; columnOwners: string[]; line: string; nullable: boolean }>();
for (const table of standard.tables) {
  const tablePattern = new RegExp("(?:CREATE|ALTER) TABLE(?: IF NOT EXISTS)? `?" + table.table + "`?", "i");
  const tableOwners = migrationEntries.filter(({ text }) => new RegExp("CREATE TABLE(?: IF NOT EXISTS)? `?" + table.table + "`?\\s*\\(", "i").test(text)).map(({ name }) => name);
  for (const column of table.columns) {
    const columnPattern = new RegExp("(?:^|\\n|,)\\s*(?:ADD COLUMN(?: IF NOT EXISTS)?\\s+)?`?" + column.name + "`?\\s+" + column.type.replace(/[()]/g, "\\$&") + "([^\\n,]*)", "im");
    const matches = migrationEntries.filter(({ text }) => tablePattern.test(text) && columnPattern.test(text));
    const line = matches.map(({ text }) => text.match(columnPattern)?.[0]).find((value) => value !== undefined);
    if (line !== undefined) ddlMetadata.set(`${table.table}.${column.name}`, { tableOwners, columnOwners: matches.map(({ name }) => name), line, nullable: !/\bNOT NULL\b/i.test(line) });
  }
}

function readRepoFile(path: string): string {
  return readCanonicalObjectDbConsumerSource(new URL(path.replaceAll("\\", "/"), repoUrl));
}

function readGitBlob(commit: string, path: string): Buffer {
  return execFileSync("git", ["show", `${commit}:${path}`], {
    cwd: fileURLToPath(repoUrl),
    maxBuffer: 16 * 1024 * 1024
  });
}

describe("WBS743 object DB consumer transition Gate1/2 contract", () => {
  it("freezes exactly the classified 17 slices in stable order", () => {
    assert.equal(contract.format, "hoibot-object-db-consumer-transition-v1");
    assert.equal(OBJECT_DB_CONSUMER_BASELINE_COMMIT, "f97be62292c3f7e8ea79b2d6f302dd25517584d4");
    assert.equal(contract.baseCommit, OBJECT_DB_CONSUMER_BASELINE_COMMIT);
    assert.equal(consumerManifest.baseCommit, OBJECT_DB_CONSUMER_BASELINE_COMMIT);
    assert.equal(consumerManifest.sourceTextNormalization, "CRLF_AND_CR_TO_LF_BEFORE_SPAN_AND_HASH");
    assert.deepEqual(contract.slices.map(({ ordinal }) => ordinal), Array.from({ length: 17 }, (_, index) => index + 1));
    assert.deepEqual(contract.slices.map(({ sliceId }) => sliceId), [
      "CONTEXT-BRIDGE", "ITEM", "CURRENCY-SHOP", "BUILDING-RECIPE", "FURNITURE-HOME",
      "HOME-AGGREGATE-RANK", "PET-EQUIPMENT", "MINI-PET", "MEMBER-TITLE", "PET-TITLE",
      "MINI-PET-TITLE-COLLECTION", "PET-SKILL", "MARKET-ORCHESTRATOR", "PACKAGE-CATALOG",
      "PACKAGE-USE", "ADMIN-LIFECYCLE", "ADMIN-WEB-APP-WIRING"
    ]);
    assert.equal(new Set(contract.slices.map(({ sliceId }) => sliceId)).size, 17);
  });

  it("canonicalizes source bytes to LF before span and source hash derivation", () => {
    const lf = "alpha\nbeta\ngamma\n";
    const crlf = "alpha\r\nbeta\r\ngamma\r\n";
    const legacyCr = "alpha\rbeta\rgamma\r";
    assert.equal(canonicalizeObjectDbConsumerSourceText(crlf), lf);
    assert.equal(canonicalizeObjectDbConsumerSourceText(legacyCr), lf);
    assert.match(contract.sourceTextNormalization.rule, /CRLF.*bare CR.*LF/);
    assert.equal(contract.sourceTextNormalization.manifestValue, "CRLF_AND_CR_TO_LF_BEFORE_SPAN_AND_HASH");
    assert.equal(contract.implementationEvidence.hashNormalization, "CRLF_AND_CR_TO_LF_BEFORE_SHA256");
    const hash = (value: string): string => createHash("sha256").update(canonicalizeObjectDbConsumerSourceText(value)).digest("hex");
    assert.equal(hash(crlf), hash(lf));
    assert.equal(hash(legacyCr), hash(lf));
  });

  it("re-derives the complete consumer manifest with exact-one primary slice and no inventory drift", () => {
    const derived = deriveConsumerManifest(fileURLToPath(repoUrl), contract.baseCommit);
    assert.deepEqual(consumerManifest, derived);
    assert.equal(consumerManifest.audit.orphanCount, 0);
    assert.equal(consumerManifest.audit.extraCount, 0);
    assert.equal(consumerManifest.audit.duplicatePrimaryCount, 0);
    assert.equal(consumerManifest.audit.undeclaredSelectorCount, 0);
    assert.equal(consumerManifest.audit.registrySourceMismatchCount, 10);
    assert.equal(consumerManifest.counts.ADMIN_COMMAND, 78);
    assert.equal(consumerManifest.consumers.length, 1_104);
    assert.deepEqual(consumerManifest.counts, {
      LEGACY_COMMAND: 684,
      AUTOMATIC_CALLBACK: 3,
      RUNTIME_DISPATCH: 199,
      ADMIN_COMMAND: 78,
      HTTP_WEB_ROUTE: 81,
      APP_WIRING: 7,
      SQL_REPOSITORY: 52,
    });
    assert.equal(consumerManifest.consumers.some(({ kind, triggerOrPredicate }) =>
      kind === "APP_WIRING" && triggerOrPredicate === "dispatchPetDataCompareCommand"), false);
    assert.equal(consumerManifest.consumers.some(({ kind, file }) => kind === "SQL_REPOSITORY"
      && file === "개발환경_고도화/runtime/src/admin/pet-data-compare-shadow-snapshot-provider.ts"), false);
    assert.ok(consumerManifest.audit.operationReceiptTableCount >= contract.requiredAdditiveReceiptTables.length);
    const petTitleRead = consumerManifest.consumers.find(({ file, symbol }) => file.endsWith("/pet/pet-title-canonical-read-provider.ts") && symbol === "listOwned");
    assert.equal(petTitleRead?.primarySlice, "PET-TITLE");
    const playerContextConsumers = consumerManifest.consumers.filter(({ file }) => file.endsWith("/account-platform/player-context-provider.ts"));
    assert.equal(playerContextConsumers.length, 2);
    assert.equal(playerContextConsumers.every(({ primarySlice }) => primarySlice === "CONTEXT-BRIDGE"), true);
    assert.equal(petTitleRead?.access, "READ");
    const petTitleMutations = consumerManifest.consumers.filter(({ file }) => file.endsWith("/pet/pet-title-canonical-mutation-provider.ts"));
    assert.equal(petTitleMutations.length, 4);
    assert.equal(petTitleMutations.every(({ primarySlice, operationReceiptTables, transactionParticipantInterfaceIds }) => primarySlice === "PET-TITLE"
      && operationReceiptTables.includes("canonical_pet_title_operations")
      && transactionParticipantInterfaceIds.includes("pet-title.ownership.mutate")), true);
    assert.deepEqual(consumerManifest.audit.missingOperationReceiptTables, []);
    const authoritativeTables = new Set(standard.tables.map(({ table }) => table));
    for (const table of contract.requiredAdditiveReceiptTables) assert.ok(authoritativeTables.has(table), `required-receipt:${table}`);
    assert.ok(consumerManifest.audit.activeRegistryObjectRows > 0);
    const ids = consumerManifest.consumers.map(({ consumerId }) => consumerId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(consumerManifest.consumers.some(({ usedTargetColumns }) => usedTargetColumns.some((column) => column.endsWith(".undefined"))), false);
    const bagShadowConsumers = consumerManifest.consumers.filter(({ file }) => file === "개발환경_고도화/runtime/src/inventory/bag-shadow-parity-provider.ts");
    assert.ok(bagShadowConsumers.length > 0, "bag-shadow consumer must be audited");
    assert.ok(bagShadowConsumers.some(({ usedTargetColumns }) => [
      "canonical_player_identity_crosswalks.provider_code",
      "canonical_player_identity_crosswalks.external_user_id",
      "external_identities.provider_code",
      "external_identities.external_user_id",
    ].every((column) => usedTargetColumns.includes(column))), "bag-shadow composite FK columns must preserve positional mapping");
    const slices = new Set(contract.slices.map(({ sliceId }) => sliceId));
    for (const consumer of consumerManifest.consumers) {
      assert.ok(slices.has(consumer.primarySlice), consumer.consumerId);
      assert.equal(consumer.targetSelectorId, `selector:${consumer.primarySlice}`);
      assert.equal(consumer.status, "IN_SCOPE");
      assert.match(consumer.sourceSpan.sha256, /^[0-9a-f]{64}$/);
      assert.ok(consumer.sourceSpan.end > consumer.sourceSpan.start, consumer.consumerId);
      const source = readRepoFile(consumer.file);
      assert.equal(createHash("sha256").update(source.slice(consumer.sourceSpan.start, consumer.sourceSpan.end)).digest("hex"), consumer.sourceSpan.sha256, `${consumer.consumerId}:span`);
    }
    assert.equal(consumerManifest.consumers.filter(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND"
      && (/\bmsg\s*!==?/.test(triggerOrPredicate) || /^\s*!.*\.(?:test|exec)\s*\(\s*msg\b/s.test(triggerOrPredicate))
      && !(/\bmsg(?:\.trim\(\))?\s*===?\s*["']|\bmsg(?:\.trim\(\))?\.(?:startsWith|indexOf|includes)\s*\(/.test(triggerOrPredicate))).length, 0);
    const automaticCallbacks = consumerManifest.consumers.filter(({ kind }) => kind === "AUTOMATIC_CALLBACK");
    assert.deepEqual(new Set(automaticCallbacks.map(({ file }) => file)), new Set(["main.js", "개발환경_고도화/runtime/src/app.ts"]));
    assert.ok(automaticCallbacks.some(({ triggerOrPredicate }) => triggerOrPredicate === "TIMER:exploreInterval == true"));
    assert.equal(automaticCallbacks.find(({ triggerOrPredicate }) => triggerOrPredicate === "MESSAGE:msg.length > 3 progression")?.targetSelectorId, "selector:ADMIN-LIFECYCLE");
    for (const trigger of ["dispatchPetExploreSettlementCommand", "dispatchPetExploreEventControlCommand", "handlerKey=pet_feed_intimacy", "handlerKey=player_title_select"]) {
      assert.ok(consumerManifest.consumers.some(({ file, triggerOrPredicate }) => file.endsWith("app.ts") && triggerOrPredicate === trigger), trigger);
    }
    for (const trigger of ["POST|/api/v1/admin/object-catalog/objects", "GET|/api/v1/admin/configuration-catalog", "GET|/api/v1/admin/balance"]) {
      assert.ok(consumerManifest.consumers.some(({ kind, triggerOrPredicate }) => kind === "HTTP_WEB_ROUTE" && triggerOrPredicate === trigger), trigger);
    }
    for (const trigger of ["handlerKey=admin_diamond_edit", "handlerKey=admin_diamond_reset_all", "handlerKey=player_diamond_rank_read"]) {
      const consumer = consumerManifest.consumers.find(({ file, triggerOrPredicate }) => file.endsWith("app.ts") && triggerOrPredicate === trigger);
      assert.ok(consumer, trigger);
      assert.equal(consumer.primarySlice, "CURRENCY-SHOP", trigger);
    }
    const pointEdit = consumerManifest.consumers.find(({ file, triggerOrPredicate }) => file.endsWith("app.ts")
      && triggerOrPredicate.includes("predicate=isPointEditCommandCandidate")
      && triggerOrPredicate.includes("IrisAdminCommandService.changePlayerPoint"));
    assert.ok(pointEdit, "direct point-edit service consumer");
    assert.equal(pointEdit.primarySlice, "CURRENCY-SHOP");
    const serverMove = consumerManifest.consumers.find(({ file, triggerOrPredicate }) => file.endsWith("app.ts")
      && triggerOrPredicate.includes("message-guard@")
      && triggerOrPredicate.includes("IrisAdminCommandService.changePlayerServer"));
    assert.ok(serverMove, "raw startsWith server-move service consumer");
    assert.ok(["ADMIN-LIFECYCLE", "CONTEXT-BRIDGE"].includes(serverMove.primarySlice));
    assert.deepEqual(rawAppMessageGuardKinds('normalizedEvent.message === "/정확"'), ["EXACT"]);
    assert.deepEqual(rawAppMessageGuardKinds('normalizedEvent.message?.startsWith("/접두 ")'), ["STRING_METHOD"]);
    assert.deepEqual(rawAppMessageGuardKinds('/^\\/정규/.test(normalizedEvent.message)'), ["REGEX"]);
    const runtimeApp = consumerManifest.consumers.filter(({ file, kind }) => file.endsWith("app.ts") && kind === "RUNTIME_DISPATCH");
    const adminCommands = consumerManifest.consumers.filter(({ kind }) => kind === "ADMIN_COMMAND");
    assert.equal(consumerManifest.audit.adminSourceCandidateCount, adminCommands.length);
    assert.deepEqual(consumerManifest.audit.adminOrphanKeys, []);
    assert.deepEqual(consumerManifest.audit.adminExtraKeys, []);
    for (const guard of ["isPetSkillBookGrantCommandCandidate", "isPetDungeonEntryGrantCommandCandidate"]) {
      assert.equal(adminCommands.find(({ triggerOrPredicate }) => triggerOrPredicate.includes(guard))?.primarySlice, "ITEM", guard);
    }
    assert.ok(adminCommands.every(({ triggerOrPredicate }) => /^ADMIN:(?:is[A-Za-z0-9_$]*(?:Command|Candidate)[A-Za-z0-9_$]*|\/포인트수정)$/.test(triggerOrPredicate)));
    for (const forbidden of ["isRetryableIdempotencyConflict", "formatAdminFullSyncResult", "withDormantAccountRetry", "IrisAdminCommandService"]) {
      assert.equal(adminCommands.some(({ triggerOrPredicate }) => triggerOrPredicate.includes(forbidden)), false, forbidden);
    }
    assert.equal(adminCommands.find(({ triggerOrPredicate }) => triggerOrPredicate === "ADMIN:isAdminAccountSuspensionCommand")?.primarySlice, "ADMIN-LIFECYCLE");
    assert.equal(adminCommands.find(({ triggerOrPredicate }) => triggerOrPredicate === "ADMIN:isCharacterCountStatsCommand")?.access, "READ");
    for (const consumer of runtimeApp.filter(({ triggerOrPredicate }) => /handlerKey=player_title_/i.test(triggerOrPredicate))) assert.equal(consumer.primarySlice, "MEMBER-TITLE", consumer.triggerOrPredicate);
    for (const consumer of runtimeApp.filter(({ triggerOrPredicate }) => /handlerKey=pet_(?:creation|info|feed_intimacy|status_read|rebirth)|isPetInfoCommand|isPetRenameCommandCandidate|isPetCreationCommandCandidate|PetExplore/i.test(triggerOrPredicate))) assert.equal(consumer.primarySlice, "PET-EQUIPMENT", consumer.triggerOrPredicate);
    for (const consumer of runtimeApp.filter(({ triggerOrPredicate }) => /handlerKey=carrot_(?:board|ban_list)_/i.test(triggerOrPredicate))) assert.equal(consumer.primarySlice, "MARKET-ORCHESTRATOR", consumer.triggerOrPredicate);
    for (const consumer of consumerManifest.consumers.filter(({ file, kind, triggerOrPredicate }) => file.endsWith("app.ts") && kind === "APP_WIRING" && /PetExplore/.test(triggerOrPredicate))) assert.equal(consumer.primarySlice, "PET-EQUIPMENT", consumer.triggerOrPredicate);
    for (const consumer of consumerManifest.consumers.filter(({ file, kind, triggerOrPredicate }) => file.endsWith("app.ts") && kind === "APP_WIRING" && /MiniPet/.test(triggerOrPredicate))) assert.equal(consumer.primarySlice, "MINI-PET", consumer.triggerOrPredicate);
    for (const consumer of runtimeApp.filter(({ primarySlice }) => primarySlice === "CONTEXT-BRIDGE")) assert.match(consumer.triggerOrPredicate, /USER_(?:PROFILE|SIGNUP)|changePlayerServer|identity|context/i, `non-context consumer:${consumer.triggerOrPredicate}`);
    const exactPrimary = new Map<string, string>([
      ["handlerKey=tier_reward_payout", "ITEM"], ["handlerKey=mini_pet_carrot_trade", "MARKET-ORCHESTRATOR"],
      ["handlerKey=mini_pet_elite_combine", "BUILDING-RECIPE"], ["handlerKey=mini_pet_battle_reset_ticket_craft", "BUILDING-RECIPE"],
      ["handlerKey=pet_skill_carrot_trade", "MARKET-ORCHESTRATOR"], ["handlerKey=pet_skill_market_listing", "MARKET-ORCHESTRATOR"],
      ["handlerKey=home_furniture_rank_read", "HOME-AGGREGATE-RANK"], ["handlerKey=home_furniture_stats_read", "HOME-AGGREGATE-RANK"],
      ["handlerKey=pet_intimacy_rank_read", "HOME-AGGREGATE-RANK"], ["handlerKey=pendant_bag_read", "PET-EQUIPMENT"],
      ["handlerKey=pendant_bag_cleanup", "PET-EQUIPMENT"], ["handlerKey=pendant_delete", "PET-EQUIPMENT"],
      ["handlerKey=pendant_equip_reset", "PET-EQUIPMENT"], ["handlerKey=pendant_grant", "PET-EQUIPMENT"],
      ["handlerKey=spirit_name_combine", "BUILDING-RECIPE"], ["handlerKey=admin_title_gift_ticket_grant", "MEMBER-TITLE"],
      ["handlerKey=happy_foundation", "CURRENCY-SHOP"], ["handlerKey=auto_daily_quest_orchestration", "ADMIN-LIFECYCLE"],
      ["handlerKey=one_day_pass_subscription", "ITEM"], ["handlerKey=one_day_pass_registry", "ADMIN-LIFECYCLE"],
      ["handlerKey=pass_subscription_retired", "ADMIN-LIFECYCLE"], ["handlerKey=home_baseball_pitch", "HOME-AGGREGATE-RANK"],
      ["handlerKey=home_activity_file_bootstrap", "ADMIN-LIFECYCLE"], ["handlerKey=home_activity_restore", "ADMIN-LIFECYCLE"],
      ["handlerKey=home_comment_file_bootstrap", "ADMIN-LIFECYCLE"], ["handlerKey=HOME_COMMENT_PIN", "ADMIN-LIFECYCLE"],
      ["handlerKey=home_feed_migration", "ADMIN-LIFECYCLE"], ["handlerKey=home_social_badge_migration", "ADMIN-LIFECYCLE"],
      ["handlerKey=home_badge_gacha_open", "HOME-AGGREGATE-RANK"], ["handlerKey=home_badge_cube", "HOME-AGGREGATE-RANK"],
      ["handlerKey=home_activity_alert_read", "HOME-AGGREGATE-RANK"], ["handlerKey=home_comment_action", "HOME-AGGREGATE-RANK"],
      ["handlerKey=home_feed_mutate", "HOME-AGGREGATE-RANK"], ["handlerKey=home_like_action", "HOME-AGGREGATE-RANK"],
      ["handlerKey=home_profile_view", "HOME-AGGREGATE-RANK"], ["handlerKey=social_own_heart", "HOME-AGGREGATE-RANK"],
      ["handlerKey=legacy_social_like", "CURRENCY-SHOP"]
    ]);
    for (const [trigger, expected] of exactPrimary) assert.equal(runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate === trigger)?.primarySlice, expected, trigger);
    for (const unreachable of ["home_badge_inventory_read", "inventory_fortune_pouch_open", "home_heart_expression", "support_premium_notice_send", "home_badge_equip", "home_badge_permanent_delete"]) {
      assert.equal(runtimeApp.some(({ triggerOrPredicate }) => triggerOrPredicate === `handlerKey=${unreachable}`), false, `unreachable:${unreachable}`);
    }
    for (const reachable of ["handlerKey=letter_board", "handlerKey=castle_battle_execute", "handlerKey=castle_kingdom_status_read", "handlerKey=admin_account_suspension", "handlerKey=mini_pet_bulk_cleanup"]) {
      assert.ok(runtimeApp.some(({ triggerOrPredicate }) => triggerOrPredicate === reachable), reachable);
    }
    const stateConsumers = consumerManifest.consumers.filter(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND" && triggerOrPredicate.startsWith("STATE:"));
    assert.equal(stateConsumers.length, 13);
    const rocketConsumers = consumerManifest.consumers.filter(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND" && /^\/로켓\d+,/.test(triggerOrPredicate));
    assert.equal(rocketConsumers.length, 10);
    assert.ok(rocketConsumers.every(({ primarySlice, interfaceId }) => primarySlice === "ITEM" && interfaceId === "item.admin-grant.execute"));
    const sqlConsumers = consumerManifest.consumers.filter(({ kind }) => kind === "SQL_REPOSITORY");
    assert.ok(sqlConsumers.length > 0);
    assert.ok(sqlConsumers.every(({ triggerOrPredicate }) => triggerOrPredicate.startsWith("SQL_METHOD:")));
    assert.equal(sqlConsumers.some(({ file }) => file.includes("/data-migration/")), false);
    assert.equal(sqlConsumers.some(({ symbol }) => /^(?:if|for|while|switch|catch)$/.test(symbol)), false);
    for (const consumer of sqlConsumers.filter(({ access }) => access === "READ_WRITE")) {
      assert.ok(consumer.readTargetTables.length > 0, `${consumer.interfaceId}:sql-read`);
      assert.ok(consumer.writeTargetTables.length > 0, `${consumer.interfaceId}:sql-write`);
    }
    const titleSql = sqlConsumers.filter(({ file }) => file.endsWith("/title/maria-canonical-title-repository.ts"));
    assert.equal(titleSql.length, 18);
    for (const prefix of ["member.", "pet.", "mini-pet."]) assert.equal(titleSql.filter(({ symbol }) => symbol.startsWith(prefix)).length, 6, prefix);
    const memberDefinition = "canonical_member_title_definitions";
    const memberOwned = "canonical_owned_member_title_instances";
    const memberSelection = "canonical_member_title_selections";
    assert.deepEqual(titleSql.find(({ symbol }) => symbol === "member.registerDefinition")?.writeTargetTables, [memberDefinition]);
    assert.deepEqual(titleSql.find(({ symbol }) => symbol === "member.grant")?.writeTargetTables, [memberOwned]);
    assert.deepEqual(titleSql.find(({ symbol }) => symbol === "member.select")?.writeTargetTables, [memberSelection]);
    assert.deepEqual(titleSql.find(({ symbol }) => symbol === "member.select")?.readTargetTables.filter((table) => table.startsWith("canonical_") && table.includes("member_title")), [memberDefinition, memberOwned]);
    const furnitureSql = sqlConsumers.filter(({ file }) => file.endsWith("/home/canonical-furniture-home-repository.ts"));
    assert.deepEqual(new Set(furnitureSql.map(({ symbol }) => symbol)), new Set(["grantOwnedFurniture", "placeOwnedFurniture", "transitionOwnedFurniture", "listPlacedFurniture"]));
    assert.equal(furnitureSql.find(({ symbol }) => symbol === "transitionOwnedFurniture")?.primarySlice, "MARKET-ORCHESTRATOR");
    assert.equal(consumerManifest.consumers.find(({ kind, triggerOrPredicate }) => kind === "APP_WIRING" && triggerOrPredicate === "dispatchSupportPassRegistryCommand")?.primarySlice, "ADMIN-LIFECYCLE");
    const wizardContinuation = runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate.includes("predicate=packageCatalogWizardActiveInput") && triggerOrPredicate.includes("PackageCatalogAddWizardIrisHandler.execute"));
    assert.equal(wizardContinuation?.primarySlice, "PACKAGE-CATALOG");
    assert.equal(wizardContinuation?.access, "READ_WRITE");
    assert.deepEqual(wizardContinuation?.currentProviderImports, ["./package/package-catalog-add-wizard-iris-handler.js"]);
    for (const readTrigger of ["handlerKey=free_market_read", "handlerKey=pendant_market_info", "handlerKey=carrot_board_read", "predicate=isCarrotRankReadCommand;service=CarrotRankReadService|CarrotRankReadService.read"]) {
      assert.equal(runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate === readTrigger)?.access, "READ", readTrigger);
    }
    const mutationContract = (trigger: string, ports: string[], receipts: string[]) => {
      const consumer = runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate === trigger);
      assert.ok(consumer, trigger);
      assert.deepEqual(consumer.transactionParticipantInterfaceIds, ports.slice().sort(), `${trigger}:ports`);
      assert.deepEqual(consumer.operationReceiptTables, receipts.slice().sort(), `${trigger}:receipts`);
    };
    const marketReceipts = ["canonical_market_operations", "canonical_market_transfer_ledger_entries"];
    const itemReceipts = ["canonical_item_inventory_operations", "canonical_item_inventory_ledger_entries"];
    const currencyReceipts = ["canonical_currency_operations", "canonical_currency_ledger_entries"];
    mutationContract("handlerKey=free_market_cancel",
      ["market.settlement.mutate", "furniture.ownership.mutate", "item.inventory.mutate", "mini-pet.ownership.mutate", "pet-equipment.ownership.mutate", "pet-skill.ownership.mutate"],
      [...marketReceipts, ...itemReceipts, "canonical_mini_pet_operation_replays", "canonical_pet_equipment_operation_replays", "canonical_pet_skill_operation_replays", "object_furniture_operation_replays", "object_furniture_ownership_history"]);
    mutationContract("handlerKey=free_market_buy",
      ["market.settlement.mutate", "currency.balance.mutate", "furniture.ownership.mutate", "item.inventory.mutate", "mini-pet.ownership.mutate", "pet-equipment.ownership.mutate", "pet-skill.ownership.mutate"],
      [...marketReceipts, ...currencyReceipts, ...itemReceipts, "canonical_mini_pet_operation_replays", "canonical_pet_equipment_operation_replays", "canonical_pet_skill_operation_replays", "object_furniture_operation_replays", "object_furniture_ownership_history"]);
    mutationContract("handlerKey=free_market_bag_register",
      ["market.settlement.mutate", "item.inventory.mutate", "pet-skill.ownership.mutate"],
      [...marketReceipts, ...itemReceipts, "canonical_pet_skill_operation_replays"]);
    mutationContract("handlerKey=store_hoi_shop",
      ["market.settlement.mutate", "currency.balance.mutate", "item.inventory.mutate", "member-title.ownership.mutate", "mini-pet.ownership.mutate", "pet-equipment.ownership.mutate", "pet-title.ownership.mutate"],
      [...marketReceipts, ...currencyReceipts, ...itemReceipts, "canonical_member_title_operations", "canonical_mini_pet_operation_replays", "canonical_pet_equipment_operation_replays", "canonical_pet_title_operations"]);
    mutationContract("handlerKey=store_auction_bid",
      ["market.settlement.mutate", "currency.balance.mutate", "item.inventory.mutate"],
      [...marketReceipts, ...currencyReceipts, ...itemReceipts]);
    mutationContract("handlerKey=PACKAGE_USE",
      ["package.inventory.consume", "currency.balance.mutate", "furniture.ownership.mutate", "item.inventory.mutate", "member-title.ownership.mutate", "mini-pet.ownership.mutate", "pet-equipment.ownership.mutate", "pet-title.ownership.mutate"],
      ["canonical_package_use_operations", "canonical_package_use_reward_ledger_entries", ...currencyReceipts, ...itemReceipts, "canonical_member_title_operations", "canonical_mini_pet_operation_replays", "canonical_pet_equipment_operation_replays", "canonical_pet_title_operations", "object_furniture_operation_replays", "object_furniture_ownership_history"]);
    const packageReceiptConsumers = consumerManifest.consumers.filter(({ operationReceiptTables }) => operationReceiptTables.includes("canonical_package_use_operations"));
    assert.deepEqual(packageReceiptConsumers.map(({ triggerOrPredicate }) => triggerOrPredicate).sort(), [
      "handlerKey=PACKAGE_USE",
      'msg === "/패키지사용" || /^\\/패키지사용\\s+\\d+(\\s+\\d+)?$/.test(msg)'
    ].sort());
    for (const falsePackageUse of ["/안녕하세요?", "/길드보상지급", "/이랏싸이마쎄", "/부방상여", "/맞짱시작", "/휴식", "/구독패스지급", "/투수던집니다", "/선물삭제", "/아아", "/호프구독"]) {
      assert.equal(consumerManifest.consumers.some(({ triggerOrPredicate, operationReceiptTables }) => triggerOrPredicate.includes(falsePackageUse) && operationReceiptTables.includes("canonical_package_use_operations")), false, falsePackageUse);
    }
    const httpRoutes = consumerManifest.consumers.filter(({ kind }) => kind === "HTTP_WEB_ROUTE");
    assert.equal(httpRoutes.length, 81);
    assert.deepEqual(Object.fromEntries(["GET", "POST", "PATCH", "PUT", "DELETE"].map((method) =>
      [method, httpRoutes.filter(({ triggerOrPredicate }) => triggerOrPredicate.startsWith(`${method}|`)).length])),
    { GET: 33, POST: 28, PATCH: 5, PUT: 5, DELETE: 10 });
    assert.equal(new Set(httpRoutes.map(({ triggerOrPredicate }) => triggerOrPredicate)).size, 81);
    const requiredRegistrarSlices = new Map<string, string[]>([
      ["registerAdminPetSkillCatalogWebRoutes", ["PET-SKILL"]],
      ["registerAdminBalanceWebRoutes", ["CURRENCY-SHOP"]],
      ["registerAdminDiamondShopCatalogWebRoutes", ["CURRENCY-SHOP"]],
      ["registerAdminObjectCatalogWebRoutes", ["FURNITURE-HOME", "ITEM", "MEMBER-TITLE", "MINI-PET", "MINI-PET-TITLE-COLLECTION", "PET-EQUIPMENT", "PET-SKILL", "PET-TITLE"]],
      ["registerAdminConfigurationCatalogWebRoutes", ["ADMIN-LIFECYCLE", "BUILDING-RECIPE"]]
    ]);
    for (const route of httpRoutes) {
      for (const required of requiredRegistrarSlices.get(route.symbol) ?? []) assert.ok(route.dependentSlices.includes(required), `${route.triggerOrPredicate}:${required}`);
      assert.equal(route.targetUsageMode, "PORT_ONLY", `${route.triggerOrPredicate}:route-mode`);
      assert.deepEqual(route.operationReceiptTables, [], `${route.triggerOrPredicate}:route-receipt`);
      assert.ok(route.p1Bridges.includes("P1-MISSING-PORTS"), `${route.triggerOrPredicate}:route-split-p1`);
      assert.equal(route.p1Bridges.includes("P1-SINGLE-WRITER"), route.access !== "READ", `${route.triggerOrPredicate}:single-writer`);
    }
    for (const trigger of [
      "GET|/api/v1/admin/moderation-incidents/:incidentId/content",
      "GET|/api/v1/sessions/current",
      "GET|/api/v1/player-profiles/current"
    ]) assert.equal(httpRoutes.find(({ triggerOrPredicate }) => triggerOrPredicate === trigger)?.access, "READ_WRITE", trigger);
    assert.equal(httpRoutes.find(({ triggerOrPredicate }) => triggerOrPredicate === "POST|/api/v1/admin/balance/:domain/preview")?.access, "READ");
    assert.equal(httpRoutes.find(({ triggerOrPredicate }) => triggerOrPredicate === "POST|/api/v1/admin/restores/preview")?.access, "READ");
    assert.equal(httpRoutes.find(({ triggerOrPredicate }) => triggerOrPredicate === "GET|/api/v1/admin/balance")?.access, "READ");
    for (const route of httpRoutes) {
      assert.deepEqual(route.observedSqlReadTables, [], `${route.triggerOrPredicate}:unresolved-provider-read-evidence`);
      assert.deepEqual(route.observedSqlWriteTables, [], `${route.triggerOrPredicate}:unresolved-provider-write-evidence`);
      assert.ok(route.unresolvedDynamicCallCount > 0, `${route.triggerOrPredicate}:unresolved-provider-boundary`);
    }
    for (const readTrigger of ["handlerKey=home_ranking_read", "handlerKey=raid_charm_ranking_read", "handlerKey=home_furniture_rank_read", "handlerKey=home_furniture_info_read", "handlerKey=player_overall_rank_read", "handlerKey=player_diamond_rank_read", "handlerKey=pendant_rank_read", "handlerKey=player_level_rank_read", "handlerKey=player_title_list_read", "handlerKey=player_title_info_read"]) {
      const readConsumer = runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate === readTrigger);
      assert.equal(readConsumer?.access, "READ", `${readTrigger}:read-access`);
      assert.deepEqual(readConsumer?.operationReceiptTables, [], `${readTrigger}:read-receipt`);
    }
    for (const mutationTrigger of ["handlerKey=home_like_action", "handlerKey=home_comment_action", "handlerKey=home_feed_mutate", "handlerKey=home_profile_view"]) {
      const mutation = runtimeApp.find(({ triggerOrPredicate }) => triggerOrPredicate === mutationTrigger);
      assert.deepEqual(mutation?.transactionParticipantInterfaceIds, ["home.aggregate.mutate"], `${mutationTrigger}:home-participant`);
      assert.deepEqual(mutation?.operationReceiptTables, ["canonical_home_aggregate_operations"], `${mutationTrigger}:home-receipt`);
    }
    const beginner = consumerManifest.consumers.find(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND" && triggerOrPredicate.includes("/초보5"));
    assert.ok(beginner);
    assert.equal(beginner.primarySlice, "ITEM");
    assert.ok(beginner.usedTargetTables.includes("canonical_owned_item_stacks"));
    assert.ok(!beginner.usedTargetTables.some((table) => /currency|package/.test(table)));
    const packageBag = consumerManifest.consumers.find(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND" && triggerOrPredicate.includes('msg !== "/패키지가방"') === false && triggerOrPredicate.includes('"/패키지가방"'));
    assert.ok(packageBag);
    assert.ok(packageBag.usedTargetTables.includes("canonical_owned_item_stacks"));
    assert.ok(packageBag.usedTargetTables.includes("canonical_owned_item_instances"));
    assert.ok(packageBag.reachableHelpers.includes("buildUserPackageBagMessage"));
    assert.ok(!packageBag.usedTargetTables.some((table) => /currency|owned_pet|owned_mini_pet|owned_furniture/.test(table)));
    const packageUse = consumerManifest.consumers.find(({ kind, triggerOrPredicate }) => kind === "LEGACY_COMMAND" && triggerOrPredicate.includes('"/패키지사용"'));
    assert.ok(packageUse);
    assert.ok(packageUse.reachableHelpers.includes("usePackageFromBag"));
    for (const table of ["canonical_owned_item_stacks", "canonical_player_currency_balances"]) {
      assert.ok(packageUse.usedTargetTables.includes(table), `package-use:${table}`);
    }
    assert.ok(!packageUse.usedTargetTables.some((table) => /owned_(?:mini_pet|pet|furniture|member_title|pet_skill)/.test(table)), "package-use must not claim reward domains absent from the active helper");
    const prayerConsumers = consumerManifest.consumers.filter(({ interfaceId }) => interfaceId === "pet-skill.daily-prayer.execute");
    assert.ok(prayerConsumers.length >= 1);
    for (const prayer of prayerConsumers) {
      assert.deepEqual(prayer.transactionParticipantInterfaceIds, ["item.inventory.mutate"], `${prayer.consumerId}:prayer-participant`);
      assert.equal(prayer.writeTargetTables.some((table) => /pet_skill/.test(table)), false, `${prayer.consumerId}:prayer-skill-write`);
      assert.deepEqual(prayer.writeTargetTables, ["canonical_owned_item_stacks"], `${prayer.consumerId}:prayer-item-write`);
      assert.deepEqual(prayer.operationReceiptTables, ["canonical_daily_prayer_operations", ...itemReceipts].sort(), `${prayer.consumerId}:prayer-receipts`);
    }
    const legacyPrayer = prayerConsumers.find(({ kind }) => kind === "LEGACY_COMMAND");
    assert.deepEqual(legacyPrayer?.legacyPaths, ["/sdcard/호이랜드/", "/sdcard/호이랜드_dev/"].flatMap((root) => ["guildData.json", "member.json", "member_pet.json", "petSkillData.json"].map((name) => `${root}${name}`)));
    const runtimePrayer = prayerConsumers.find(({ kind }) => kind === "RUNTIME_DISPATCH");
    assert.deepEqual(runtimePrayer?.legacyPaths, []);
    for (const table of ["operations", "player_counters", "rng_events", "inventory_stacks", "inventory_ledger", "command_audit", "command_executions", "outbox_messages"]) assert.ok(runtimePrayer?.observedSqlWriteTables.includes(table), `runtime-prayer:${table}`);
    const exploreSettlements = consumerManifest.consumers.filter(({ interfaceId }) => interfaceId === "pet-explore.settlement.execute");
    assert.equal(exploreSettlements.length, 3);
    for (const settlement of exploreSettlements) {
      assert.deepEqual(settlement.transactionParticipantInterfaceIds, ["item.inventory.mutate"], `${settlement.consumerId}:explore-participant`);
      assert.equal(settlement.dependentSlices.includes("CURRENCY-SHOP"), false, `${settlement.consumerId}:explore-currency`);
      assert.ok(settlement.dependentSlices.includes("HOME-AGGREGATE-RANK"), `${settlement.consumerId}:explore-home-read`);
      assert.deepEqual(settlement.writeTargetTables, ["canonical_owned_item_stacks"], `${settlement.consumerId}:explore-item-write`);
      assert.equal(settlement.writeTargetTables.some((table) => /pet|equipment|furniture/.test(table)), false, `${settlement.consumerId}:explore-ownership-write`);
      assert.deepEqual(settlement.operationReceiptTables, ["canonical_pet_explore_operations", ...itemReceipts].sort(), `${settlement.consumerId}:explore-receipts`);
    }
    for (const settlement of exploreSettlements.filter(({ kind }) => kind !== "APP_WIRING")) assert.deepEqual(settlement.legacyPaths, ["/sdcard/호이랜드/", "/sdcard/호이랜드_dev/"].flatMap((root) => ["guildData.json", "member.json", "member_pet.json", "petExploreData.json", "petSkillData.json", "petSweetHomeData.json"].map((name) => `${root}${name}`)));
    const runtimeExplore = exploreSettlements.find(({ kind }) => kind === "APP_WIRING");
    assert.deepEqual(runtimeExplore?.legacyPaths, []);
    assert.deepEqual(runtimeExplore?.observedSqlReadTables, []);
    assert.deepEqual(runtimeExplore?.observedSqlWriteTables, []);
    assert.ok((runtimeExplore?.unresolvedDynamicCallCount ?? 0) > 0, "runtime-explore:unresolved-provider-boundary");
    for (const consumer of consumerManifest.consumers.filter(({ unresolvedDynamicCallCount }) => unresolvedDynamicCallCount > 0)) assert.ok(consumer.p1Bridges.includes("P1-MISSING-PORTS"), consumer.consumerId);
  });

  it("binds every consumer selector to exact authoritative columns with PK/FK closure", () => {
    const tableMap = new Map(standard.tables.map((table) => [table.table, table]));
    const targetColumns = new Map(targetSchema.columns.map((column) => [`${column.table}.${column.column}`, column]));
    for (const consumer of consumerManifest.consumers) {
      const selector = consumerManifest.targetSelectors[consumer.targetSelectorId];
      assert.ok(selector, consumer.consumerId);
      assert.match(consumer.interfaceId, /^[a-z0-9-]+\.[a-z0-9.-]+$/i, `${consumer.consumerId}:interface`);
      assert.equal(consumer.interfaceMethod, consumer.access === "READ" ? "READ" : "EXECUTE", `${consumer.consumerId}:interface-method`);
      assert.equal(consumer.transactionOwnerInterfaceId, consumer.access === "READ" ? null : consumer.interfaceId, `${consumer.consumerId}:transaction-owner`);
      assert.equal(consumer.transactionParticipantInterfaceIds.some((value) => value.startsWith("port:")), false, `${consumer.consumerId}:virtual-participant`);
      if (consumer.access === "READ") assert.equal(consumer.operationReceiptTables.length, 0, `${consumer.consumerId}:read-receipt`);
      else assert.ok(consumer.operationReceiptTables.length > 0 || consumer.p1Bridges.includes("P1-MISSING-PORTS"), `${consumer.consumerId}:mutation-receipt-or-p1`);
      assert.deepEqual(new Set(consumer.usedTargetTables), new Set([...consumer.readTargetTables, ...consumer.writeTargetTables]), `${consumer.consumerId}:table-partition`);
      assert.deepEqual(new Set(consumer.usedTargetColumns), new Set([...consumer.readTargetColumns, ...consumer.writeTargetColumns]), `${consumer.consumerId}:column-partition`);
      if (consumer.targetUsageMode === "CURRENT_SQL") {
        assert.deepEqual(consumer.usedTargetTables.filter((table) => consumer.sqlTables.includes(table)), consumer.sqlTables.slice().sort(), `${consumer.consumerId}:actual-sql-tables`);
      }
      const selected = new Set(consumer.usedTargetColumns);
      const usedTables = new Set(consumer.usedTargetTables);
      for (const qualified of selected) {
        const [tableName, columnName] = qualified.split(".") as [string, string];
        const table = tableMap.get(tableName);
        assert.ok(table?.columns.some(({ name }) => name === columnName), `${consumer.consumerId}:${qualified}`);
        const target = targetColumns.get(qualified);
        const ddl = ddlMetadata.get(qualified);
        assert.ok(ddl, `${consumer.consumerId}:DDL-COLUMN:${qualified}`);
        assert.ok(ddl.tableOwners.length >= 1, `${consumer.consumerId}:OWNER-MIGRATION:${qualified}`);
        assert.equal(typeof ddl.nullable, "boolean", `${consumer.consumerId}:DDL-NULLABILITY:${qualified}`);
        if (target !== undefined) {
          assert.equal(typeof (target as { nullable?: unknown }).nullable, "boolean", `${consumer.consumerId}:NULLABILITY:${qualified}`);
          assert.match((target as { migration?: string }).migration ?? "", /^\d{3}_[a-z0-9_]+\.sql$/, `${consumer.consumerId}:MIGRATION:${qualified}`);
          assert.ok(ddl.columnOwners.includes(target.migration), `${consumer.consumerId}:MIGRATION-OWNER:${qualified}`);
          assert.equal(ddl.nullable, target.nullable, `${consumer.consumerId}:NULLABILITY-MATCH:${qualified}`);
        }
        const standardColumn = table?.columns.find(({ name }) => name === columnName);
        if (standardColumn?.type === "CHAR(8)" && /(?:^|_)id$/.test(columnName)) {
          assert.match(qualified, /\.[a-z][a-z0-9_]*_id$/, `${consumer.consumerId}:CUID:${qualified}`);
          assert.equal(standardColumn.charset, "ascii", `${consumer.consumerId}:CUID-CHARSET:${qualified}`);
          assert.equal(standardColumn.collation, "ascii_bin", `${consumer.consumerId}:CUID-COLLATION:${qualified}`);
        }
      }
      for (const tableName of consumer.usedTargetTables) {
        const table = tableMap.get(tableName);
        assert.ok(table, `${consumer.consumerId}:${tableName}`);
        if (consumer.sqlTables.includes(tableName) || consumer.targetUsageMode === "ADDITIVE_PLAN") {
          for (const column of table!.primaryKey) assert.ok(selected.has(`${tableName}.${column}`), `${consumer.consumerId}:PK:${tableName}.${column}`);
        }
        for (const foreignKey of table!.foreignKeys ?? []) {
          for (const pair of foreignKeyPairs(foreignKey)) {
            if (!selected.has(`${tableName}.${pair.column}`)) continue;
            assert.ok(usedTables.has(foreignKey.referencesTable), `${consumer.consumerId}:REF-TABLE:${foreignKey.referencesTable}`);
            assert.ok(selected.has(`${foreignKey.referencesTable}.${pair.referencesColumn}`), `${consumer.consumerId}:REF-PK:${foreignKey.referencesTable}.${pair.referencesColumn}`);
            const sourceType: string | undefined = table!.columns.find(({ name }) => name === pair.column)?.type;
            const targetType: string | undefined = tableMap.get(foreignKey.referencesTable)?.columns.find(({ name }) => name === pair.referencesColumn)?.type;
            assert.equal(sourceType, targetType, `${consumer.consumerId}:FK-TYPE:${tableName}.${pair.column}`);
          }
        }
      }
    }
  });

  it("separates the immutable Gate1 source baseline from current Gate2 implementation evidence", () => {
    const repoPath = fileURLToPath(repoUrl);
    assert.equal(contract.baselinePolicy.baseCommitRole, "IMMUTABLE_GATE1_CLASSIFICATION_BASELINE");
    assert.equal(contract.baselinePolicy.baselinePin, "runtime/src/data-migration/object-db-consumer-baseline.ts:OBJECT_DB_CONSUMER_BASELINE_COMMIT");
    assert.equal(contract.baselinePolicy.headEqualityRequired, false);
    assert.match(contract.baselinePolicy.verification, /exact immutable pin.*ancestor of HEAD/);
    assert.equal(contract.baseCommit, OBJECT_DB_CONSUMER_BASELINE_COMMIT);
    execFileSync("git", ["merge-base", "--is-ancestor", contract.baseCommit, "HEAD"], { cwd: repoPath });
    assert.deepEqual(new Set(contract.sourceSurfaces.map(({ file }) => file)), new Set([
      "main.js", "Info.js", "COMMAND_INDEX.md",
      "개발환경_고도화/runtime/src/app.ts",
      "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts",
      "개발환경_고도화/runtime/migrations/003_identity_import.sql",
      "개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql"
    ]));
    for (const surface of contract.sourceSurfaces) {
      const text = canonicalizeObjectDbConsumerSourceText(readGitBlob(contract.baseCommit, surface.file).toString("utf8"));
      assert.ok(surface.terms.length > 0, surface.file);
      for (const term of surface.terms) assert.ok(text.includes(term), `${surface.file}: missing ${term}`);
    }
    for (const [file, expectedSha256] of Object.entries(contract.frozenSourceHashes)) {
      const blob = canonicalizeObjectDbConsumerSourceText(readGitBlob(contract.baseCommit, file).toString("utf8"));
      const actual = createHash("sha256").update(blob).digest("hex");
      assert.equal(actual, expectedSha256, `baseline:${file}`);
    }
    assert.equal(contract.implementationEvidence.checkpointDate, "2026-09-04");
    assert.equal(contract.implementationEvidence.status, "PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION");
    assert.deepEqual(contract.implementationEvidence.acceptedPhases, ["P0", "P1", "P2"]);
    assert.equal(contract.implementationEvidence.p2MariaVerification, "VERIFIED_ISOLATED_MARIADB_FORWARD_REPLAY_ROLLBACK_RESTART");
    for (const surface of contract.implementationEvidence.sourceSurfaces) {
      const text = readRepoFile(surface.file);
      assert.ok(surface.terms.length > 0, surface.file);
      for (const term of surface.terms) assert.ok(text.includes(term), `${surface.file}: missing ${term}`);
    }
    for (const [file, expectedSha256] of Object.entries(contract.implementationEvidence.currentImplementationSourceHashes)) {
      const actual = createHash("sha256").update(readRepoFile(file)).digest("hex");
      assert.equal(actual, expectedSha256, `implementation:${file}`);
    }
    const builder = readRepoFile("개발환경_고도화/runtime/scripts/build-object-db-consumer-transition-manifest.ts");
    assert.match(builder, /OBJECT_DB_CONSUMER_BASELINE_COMMIT/);
    assert.doesNotMatch(builder, /object-db-consumer-transition\.v1\.json/);
  });

  it("derives EVENT_CONTROL MODERN plus both accepted IRIS read-only ingress callsites while keeping Gate2 blocked", () => {
    assert.equal(contract.status, "PARTIALLY_IMPLEMENTED_BLOCKING_INGRESS_ADOPTION");
    assert.equal(contract.runtimeAdoption.status, "PARTIAL_IRIS_PET_EXPLORE_EVENT_CONTROL_MODERN_AND_READ_ONLY_ADOPTION");
    const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
    const adoption = auditObjectDbRuntimeAdoption(runtimeRoot, contract.runtimeAdoption.reviewedSourceHashes);
    assert.deepEqual(adoption.failures, []);
    assert.equal(adoption.productionSourceCallCount, 2);
    assert.equal(contract.runtimeAdoption.productionSourceCallCount, adoption.productionSourceCallCount);
    assert.equal(contract.implementationEvidence.runtimeEntrypointCallCount, adoption.productionSourceCallCount);
    assert.deepEqual(contract.runtimeAdoption.connectedIngressFamilies, adoption.connectedIngressFamilies);
    assert.deepEqual(contract.runtimeAdoption.pendingIngressFamilies, ["IRIS_PET_EXPLORE_SETTLEMENT_MODERN", "IRIS_LEGACY_HANDOFF", "AUTOMATIC", "ADMIN", "WEB"]);
    assert.equal(contract.runtimeAdoption.cutoverClaimed, false);
    assert.match(contract.runtimeAdoption.currentAppBoundary, /EVENT_CONTROL alone reaches a typed MODERN\/MUTATION handler/);
    assert.match(contract.runtimeAdoption.auditHelper, /auditObjectDbRuntimeAdoption$/);
  });

  it("derives each named slice selector exactly from the authoritative field map", () => {
    const mappings = new Map(fieldMap.mappings.map((mapping) => [mapping.domain, mapping]));
    assert.equal(contract.consumerManifestContract, "object-db-consumer-manifest.v1.json");
    assert.deepEqual(Object.keys(contract.sliceTargetDomains).sort(), contract.slices.map(({ sliceId }) => sliceId).sort());
    assert.match(contract.canonicalBindingPolicy, /exactly one selector/);
    for (const slice of contract.slices) {
      const domains = contract.sliceTargetDomains[slice.sliceId];
      assert.ok(domains !== undefined && domains.length > 0, slice.sliceId);
      const expectedColumns = new Set<string>();
      const expectedTables = new Set<string>();
      for (const domain of domains) {
        const mapping = mappings.get(domain);
        assert.ok(mapping, `${slice.sliceId}:${domain}`);
        for (const field of mapping.fields) for (const target of field.targetColumns) expectedColumns.add(target);
        for (const table of mapping.targetTables) expectedTables.add(table);
      }
      const selector = consumerManifest.targetSelectors[`selector:${slice.sliceId}`];
      assert.ok(selector, slice.sliceId);
      assert.deepEqual(selector.domains, domains);
      for (const qualified of expectedColumns) assert.ok(selector.columns.includes(qualified), `${slice.sliceId}:${qualified}`);
      for (const table of expectedTables) assert.ok(selector.tables.includes(table), `${slice.sliceId}:${table}`);
    }
  });

  it("binds every slice to concrete source evidence, typed columns and a complete transition boundary", () => {
    for (const slice of contract.slices) {
      assert.ok(slice.legacyConsumers.length > 0, slice.sliceId);
      assert.ok(slice.sourceEvidence.length > 0, slice.sliceId);
      assert.ok(slice.bindings.length > 0, slice.sliceId);
      for (const evidence of slice.sourceEvidence) {
        assert.match(evidence, /^(main\.js|Info\.js|COMMAND_(?:INDEX|REGISTRY)\.md|runtime\/src\/)/, `${slice.sliceId}:${evidence}`);
        const separator = evidence.indexOf(":");
        const sourcePath = separator === -1 ? evidence : evidence.slice(0, separator);
        const term = separator === -1 ? "" : evidence.slice(separator + 1);
        const repoPath = sourcePath.startsWith("runtime/") ? `개발환경_고도화/${sourcePath}` : sourcePath;
        const sourceText = readRepoFile(repoPath);
        if (term !== "") assert.ok(sourceText.includes(term), `${slice.sliceId}:${evidence}`);
      }
      for (const binding of slice.bindings) {
        assert.match(binding, /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*:[A-Z][A-Z0-9(), ]+$/, `${slice.sliceId}:${binding}`);
        assert.doesNotMatch(binding, /(?:^|_)CODE:/i, `${slice.sliceId}:${binding}`);
        const [qualified, declaredType] = binding.split(":") as [string, string];
        const [table, column] = qualified.split(".") as [string, string];
        const targetType = targetColumnTypes.get(qualified);
        if (targetType !== undefined) assert.equal(declaredType, targetType, binding);
        else {
          assert.match(migrationCorpus, new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? ${table} \\(`, "i"), binding);
          assert.match(migrationCorpus, new RegExp(`\\b${column}\\s+${declaredType.replace(/[()]/g, "\\$&")}(?=\\s|,|$)`, "i"), binding);
        }
      }
      assert.match(slice.portPlan, /^(?:EXISTING_PLUS_ADDITIVE|ADDITIVE_REQUIRED):/);
      assert.ok(slice.lockOrder.length > 0, slice.sliceId);
      for (const field of ["transaction", "rollback", "replay", "outbox", "environmentPartition"] as const) {
        assert.ok(slice[field].length > 10, `${slice.sliceId}:${field}`);
      }
    }
  });

  it("keeps canonical definition values out of ownership bindings and uses CHAR(8) typed object references", () => {
    const all = contract.slices.flatMap(({ bindings }) => bindings);
    const owned = all.filter((binding) => binding.includes("_owned_") || binding.startsWith("object_owned_"));
    for (const binding of owned) assert.doesNotMatch(binding, /\.(?:display_name|price_amount|purchase_price|base_charm|charm_per_enhancement|handler_key|options_json):/);
    for (const binding of all.filter((value) => /\.(?:player_id|item_id|pet_id|mini_pet_id|equipment_id|furniture_id|package_id|currency_id|pet_skill_id):/.test(value))) {
      if (binding.startsWith("external_identities.")) continue;
      assert.match(binding, /:CHAR\(8\)$/i, binding);
    }
    assert.match(contract.globalRules.identity ?? "", /display_name inference is forbidden/);
    assert.match(contract.globalRules.reference ?? "", /never a generic id or generic CODE/);
  });

  it("freezes all seven P1 bridges and attaches each to known slices and an additive closure plan", () => {
    assert.deepEqual(contract.gate2P1Conditions.map(({ conditionId }) => conditionId), [
      "P1-IDENTITY-CROSSWALK", "P1-MISSING-PORTS", "P1-ENVIRONMENT-PARTITION",
      "P1-CROSS-DOMAIN-ATOMICITY", "P1-FURNITURE-DRAW-POLICY", "P1-OWNER-GRAPH", "P1-SINGLE-WRITER"
    ]);
    const sliceIds = new Set(contract.slices.map(({ sliceId }) => sliceId));
    for (const condition of contract.gate2P1Conditions) {
      assert.match(condition.status, /BLOCKING/);
      assert.ok(condition.ownerSlices.length > 0);
      for (const sliceId of condition.ownerSlices) assert.ok(sliceIds.has(sliceId), `${condition.conditionId}:${sliceId}`);
      assert.ok(condition.affectedConsumerRule.length > 20);
      assert.ok(condition.requirement.length > 20);
      assert.ok(condition.additivePlan.length > 20);
    }
    for (const consumer of consumerManifest.consumers) {
      if (consumer.kind !== "SQL_REPOSITORY") {
        assert.ok(consumer.p1Bridges.includes("P1-ENVIRONMENT-PARTITION"), `${consumer.consumerId}:environment-impact`);
        assert.equal(consumer.p1Bridges.includes("P1-SINGLE-WRITER"), consumer.access !== "READ", `${consumer.consumerId}:writer-entrypoint-impact`);
        if (consumer.usedTargetTables.includes("canonical_players")) assert.ok(consumer.p1Bridges.includes("P1-IDENTITY-CROSSWALK"), `${consumer.consumerId}:identity-impact`);
      } else {
        assert.equal(consumer.p1Bridges.includes("P1-SINGLE-WRITER"), false, `${consumer.consumerId}:repository-not-writer-selector`);
        assert.equal(consumer.p1Bridges.includes("P1-ENVIRONMENT-PARTITION"), false, `${consumer.consumerId}:repository-inherits-environment`);
        if (consumer.targetUsageMode === "CURRENT_SQL" && consumer.operationReceiptTables.length > 0 && consumer.unresolvedDynamicCallCount === 0) assert.equal(consumer.p1Bridges.includes("P1-MISSING-PORTS"), false, `${consumer.consumerId}:implemented-sql-port`);
      }
    }
  });

  it("records the actual source differences and forbids unsafe inference or premature cutover", () => {
    assert.ok(contract.observedDifferences.some((entry) => entry.includes("no active /가구조합 trigger was found")));
    assert.ok(contract.observedDifferences.some((entry) => entry.includes("BIGINT") && entry.includes("CHAR(8)")));
    assert.ok(contract.forbidden.includes("display-name identity inference"));
    assert.ok(contract.forbidden.includes("generic object CODE"));
    assert.ok(contract.forbidden.includes("definition value copies in ownership tables"));
    assert.ok(contract.forbidden.some((entry) => entry.includes("Gate2 cutover claim") && entry.includes("P2 MariaDB")));
  });
});
