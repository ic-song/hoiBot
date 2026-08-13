import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../../..");
const controlRoot = path.resolve(scriptDirectory, "..");
const inventory = JSON.parse(await readFile(path.join(controlRoot, "inventory/data-stores.json"), "utf8"));
const importerPath = path.join(repositoryRoot, "개발환경_고도화/runtime/scripts/import-legacy-json.ts");
const migrationsDirectory = path.join(repositoryRoot, "개발환경_고도화/runtime/migrations");
const outputPath = path.join(controlRoot, "inventory/db-coverage.json");

const partialMappings = {
  "guildData.json": ["guilds", "guild_members"],
  "member.json": ["players", "player_profiles", "currency_accounts", "player_counters", "player_passes", "player_badge_assignments", "leaderboards", "leaderboard_entries", "legacy_identity_map"],
  "member_pet.json": ["player_pets", "mini_pet_definitions", "owned_mini_pets"],
  "member_title.json": ["title_definitions", "player_titles"],
  "petSweetHomeData.json": ["player_homes", "furniture_definitions", "owned_furniture", "furniture_placements", "leaderboards", "leaderboard_entries"],
  "pet_title.json": ["title_definitions", "pet_titles"]
};

const importer = await readFile(importerPath, "utf8");
const migrationFiles = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
const createdTables = new Set();
for (const migrationFile of migrationFiles) {
  const sql = await readFile(path.join(migrationsDirectory, migrationFile), "utf8");
  for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?([A-Za-z0-9_]+)`?/gi)) createdTables.add(match[1]);
}

const authoritativeStores = inventory.stores.filter((store) => store.classification === "authoritative");
const coverage = authoritativeStores.map((store) => {
  const fileName = store.operationalPath.split("/").pop();
  const mappedTables = partialMappings[fileName] ?? [];
  let status;
  let reason;
  if (!store.repositoryPresent) {
    status = "source-snapshot-missing";
    reason = "현재 Git data snapshot에 파일이 없어 구조·checksum·import coverage를 검증할 수 없음";
  } else if (mappedTables.length > 0) {
    status = "partial-domain-import";
    reason = "importer가 일부 필드를 domain table로 적재하지만 전체 legacy field 매핑과 reconciliation 증거는 없음";
  } else {
    status = "manifest-only";
    reason = "importer가 파일명·checksum·parse 상태만 legacy_import_files에 기록하고 domain row는 적재하지 않음";
  }
  const missingTables = mappedTables.filter((table) => !createdTables.has(table));
  if (missingTables.length > 0) throw new Error(`${fileName}: migration에 없는 table: ${missingTables.join(", ")}`);
  return {
    operationalPath: store.operationalPath,
    repositoryPath: store.path,
    status,
    mappedTables,
    reason
  };
});

const counts = {};
for (const item of coverage) counts[item.status] = (counts[item.status] ?? 0) + 1;
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  inputs: {
    dataInventory: "개발환경_고도화/migration-control/inventory/data-stores.json",
    importer: "개발환경_고도화/runtime/scripts/import-legacy-json.ts",
    migrations: migrationFiles.map((name) => `개발환경_고도화/runtime/migrations/${name}`),
    sourceRootHash: inventory.sourceSnapshot.rootHash
  },
  importerEvidence: {
    parsesAllJsonFiles: /for \(const name of fileNames\)/.test(importer),
    recordsAllFileChecksums: /INSERT INTO legacy_import_files/.test(importer),
    storesRawPayload: /raw_payload|payload_json/i.test(importer),
    recordsPerFileRecordCount: /record_count[^\n]*VALUES/i.test(importer),
    domainSourceFiles: Object.keys(partialMappings).sort()
  },
  summary: {
    authoritativeStoreCount: authoritativeStores.length,
    fullDomainImportCount: 0,
    ...counts
  },
  coverage,
  conclusion: "현재 importer는 전체 운영 데이터 이관기가 아니라 첫 수직 기능용 부분 importer다. DB apply 전에 26개 authoritative 저장소 각각에 전체 field mapping과 reconciliation을 추가해야 한다.",
  blockers: [
    "petHomeActivityData.json과 petHomePlacedFurniture.json의 실제 운영 snapshot이 Git data에 없음",
    "partial-domain-import 6개도 전체 field coverage와 문자·잔액·소유권 reconciliation 증거가 없음",
    "manifest-only 파일은 checksum만 기록되며 원본 payload나 domain row가 보존되지 않음",
    "현재 DB에는 로컬에 없는 028_character_mvp.sql 적용 이력이 남아 있어 DB apply가 차단됨"
  ]
};

await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, summary: result.summary, importerEvidence: result.importerEvidence }, null, 2));
