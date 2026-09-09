import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const SOURCE = {
  file: "개발환경_고도화/runtime/src/title/maria-canonical-title-repository.ts",
  start: 12944,
  end: 14646,
  sha256: "e24e0ffe24a927f79d74ca18dd3cdc5deba9631de158acaf78e1da31e8101b98",
};
const MODULE_EXECUTION_ID = randomUUID();
const SCENARIOS = ["READ_POSITIVE", "NEGATIVE_GUARD", "EXACT_OUTPUT", "SOURCE_DOMAIN_DML_ZERO", "RESTART_CONSISTENCY"];

function normalizedSql(config) {
  return `SELECT owned.${config.ownedId} AS owned_title_id,owned.${config.definitionId} AS title_definition_id,definition_row.title_name,definition_row.base_sale_price,owned.acquisition_price,owned.acquisition_sequence,owned.acquired_time,CASE WHEN selection_row.${config.ownedId} IS NULL THEN 0 ELSE 1 END AS selected_flag FROM ${config.ownershipTable} owned JOIN ${config.definitionTable} definition_row ON definition_row.${config.definitionId}=owned.${config.definitionId} LEFT JOIN ${config.selectionTable} selection_row ON selection_row.player_id=owned.player_id AND selection_row.${config.ownedId}=owned.${config.ownedId} WHERE owned.player_id=? AND owned.ownership_status='owned' ORDER BY owned.acquisition_sequence,owned.${config.ownedId}`;
}

const TRUSTED = {
  "sql-repository-0dc3c380c54081a2": {
    symbol: "member.listOwned", triggerOrPredicate: "SQL_METHOD:member:listOwned", interfaceId: "member-title.repository.maria-canonical-title-repository.member.listOwned",
    domain: "member", definitionTable: "canonical_member_title_definitions", definitionId: "member_title_id", ownershipTable: "canonical_owned_member_title_instances", ownedId: "owned_member_title_id", selectionTable: "canonical_member_title_selections",
    row: { ownedTitleId: "ownmem01", titleDefinitionId: "memttl01", titleName: "변경된 회원 타이틀✨", baseSalePrice: "300000000", acquisitionPrice: "100000000", acquisitionSequence: "1", acquiredTime: "2026-09-03 10:00:00", selected: true },
  },
  "sql-repository-a0a5f5d8f3338d7b": {
    symbol: "pet.listOwned", triggerOrPredicate: "SQL_METHOD:pet:listOwned", interfaceId: "pet-title.repository.maria-canonical-title-repository.pet.listOwned",
    domain: "pet", definitionTable: "canonical_pet_title_definitions", definitionId: "pet_title_id", ownershipTable: "canonical_owned_pet_title_instances", ownedId: "owned_pet_title_id", selectionTable: "canonical_pet_title_selections",
    row: { ownedTitleId: "ownpet01", titleDefinitionId: "petttl01", titleName: "변경된 펫 타이틀✨", baseSalePrice: "400000000", acquisitionPrice: null, acquisitionSequence: "2", acquiredTime: "2026-09-03 10:01:00", selected: false },
  },
  "sql-repository-6a1bdfaafba10749": {
    symbol: "mini-pet.listOwned", triggerOrPredicate: "SQL_METHOD:mini-pet:listOwned", interfaceId: "mini-pet-title-collection.repository.maria-canonical-title-repository.mini-pet.listOwned",
    domain: "mini_pet", definitionTable: "canonical_mini_pet_title_definitions", definitionId: "mini_pet_title_id", ownershipTable: "canonical_owned_mini_pet_title_instances", ownedId: "owned_mini_pet_title_id", selectionTable: "canonical_mini_pet_title_selections",
    row: { ownedTitleId: "ownmini1", titleDefinitionId: "minttl01", titleName: "변경된 미니펫 타이틀✨", baseSalePrice: "500000000", acquisitionPrice: "200000000", acquisitionSequence: "3", acquiredTime: "2026-09-03 10:02:00", selected: true },
  },
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedFixtureConsumer(consumerId, trusted) {
  return {
    consumerId,
    sourceLocator: { file: SOURCE.file, symbol: trusted.symbol, triggerOrPredicate: trusted.triggerOrPredicate, interfaceId: trusted.interfaceId, start: SOURCE.start, end: SOURCE.end, sha256: SOURCE.sha256 },
    trustedConfig: { domain: trusted.domain, definitionTable: trusted.definitionTable, definitionId: trusted.definitionId, ownershipTable: trusted.ownershipTable, ownedId: trusted.ownedId, selectionTable: trusted.selectionTable },
    input: { domain: trusted.domain, playerId: "player01" },
    negativeInput: { domain: trusted.domain, playerId: "bad" },
    expectedGuardError: "OBJECT_IDENTITY_CANDIDATE_INVALID",
    expectedNormalizedSql: normalizedSql(trusted),
    mockRows: [trusted.row],
    expectedRow: trusted.row,
    assertions: [trusted.ownershipTable, trusted.definitionTable, trusted.selectionTable, "owned.player_id=?", "owned.ownership_status='owned'", `ORDER BY owned.acquisition_sequence,owned.${trusted.ownedId}`],
  };
}

function normalizeRow(row) {
  return { ownedTitleId: row.ownedTitleId, titleDefinitionId: row.titleDefinitionId, titleName: row.titleName, baseSalePrice: row.baseSalePrice.toString(), acquisitionPrice: row.acquisitionPrice === null ? null : row.acquisitionPrice.toString(), acquisitionSequence: row.acquisitionSequence.toString(), acquiredTime: row.acquiredTime, selected: row.selected };
}

function verifyCommittedSource(repoRoot, consumer) {
  const sourcePath = resolve(repoRoot, SOURCE.file);
  const source = readFileSync(sourcePath, "utf8").replace(/\r\n?/g, "\n");
  const span = source.slice(SOURCE.start, SOURCE.end);
  assert(createHash("sha256").update(span).digest("hex") === SOURCE.sha256, `${consumer.consumerId}: source span hash drift`);
  assert(span.includes("async listOwned("), `${consumer.consumerId}: listOwned executable span missing`);
  return sourcePath;
}

export async function executeWave1TitleListOwned({ consumerId, harnessCaseId, scenarioKind, fixturePayload, database }) {
  let assertionCount = 0;
  const check = (condition, message) => { assertionCount += 1; assert(condition, message); };
  const parityCase = fixturePayload.cases.find((candidate) => candidate.caseId === harnessCaseId);
  check(parityCase !== undefined, `${consumerId}: case mapping missing`);
  check(parityCase.executablePath === "MariaCanonicalTitleRepository.listOwned", `${consumerId}: executable path drift`);
  check(parityCase.transactionPath === "DatabaseClient.query:READ_ONLY", `${consumerId}: transaction path drift`);
  check(JSON.stringify(parityCase.requiredScenarios) === JSON.stringify(SCENARIOS), `${consumerId}: scenario matrix drift`);
  const consumer = parityCase.consumers.find((candidate) => candidate.consumerId === consumerId);
  const trusted = TRUSTED[consumerId];
  check(consumer !== undefined && trusted !== undefined, `${consumerId}: trusted consumer mapping missing`);
  check(JSON.stringify(consumer) === JSON.stringify(expectedFixtureConsumer(consumerId, trusted)), `${consumerId}: fixture attempted to select untrusted locator/domain/table/ID/SQL config`);
  check(parityCase.consumers.every((candidate) => candidate.sourceLocator.file === SOURCE.file && candidate.sourceLocator.start === SOURCE.start && candidate.sourceLocator.end === SOURCE.end && candidate.sourceLocator.sha256 === SOURCE.sha256), `${consumerId}: shared executable span drift`);
  check(SCENARIOS.includes(scenarioKind), `${consumerId}: unsupported scenario`);

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const sourcePath = verifyCommittedSource(repoRoot, consumer);
  assertionCount += 2;
  const { MariaCanonicalTitleRepository } = await tsImport(pathToFileURL(sourcePath).href, import.meta.url);
  const repository = new MariaCanonicalTitleRepository(database);

  if (scenarioKind === "NEGATIVE_GUARD") {
    let errorMessage = null;
    try { await repository.listOwned(consumer.negativeInput.domain, consumer.negativeInput.playerId); }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); }
    check(errorMessage === consumer.expectedGuardError, `${consumerId}: negative guard result drift`);
    return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: errorMessage, result: JSON.stringify({ error: errorMessage, queryCount: 0 }) };
  }

  const result = (await repository.listOwned(consumer.input.domain, consumer.input.playerId)).map(normalizeRow);
  check(JSON.stringify(result) === JSON.stringify([trusted.row]), `${consumerId}: exact result drift`);
  const raw = JSON.stringify(result);
  return { executedConsumerId: consumerId, executedCaseId: harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: raw };
}
