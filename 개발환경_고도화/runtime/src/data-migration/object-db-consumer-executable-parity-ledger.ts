import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

import { canonicalizeObjectDbConsumerSourceText, OBJECT_DB_CONSUMER_BASELINE_COMMIT } from "./object-db-consumer-baseline.js";
import { deriveUniqueClassMethodSourceSpan, predicateAcceptsRegistryCommand } from "./object-db-consumer-transition-audit.js";
import {
  createConsumerIdResolver,
  parseConsumerIdRegistry,
  type ConsumerIdRegistry,
  type StableConsumerIdentity,
} from "./object-db-consumer-id-registry.js";
import {
  projectObjectDbMutationOracleResult,
  validateObjectDbMutationScenarioEvidence,
  type ObjectDbMutationEvidenceContract,
  type ObjectDbMutationScenarioEvidence,
} from "./object-db-consumer-mutation-evidence.js";

export const OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT = "hoibot-object-db-consumer-executable-parity-ledger-v1" as const;
export const OBJECT_DB_EXECUTABLE_PARITY_WAVE0_EVIDENCE_COMMIT = "f07021701d2f058531512b0e805dc0d9c4b2a3fb" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT = "28a04f25af5d29f1abe957b8b9886746bb1481f9" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_ROOT_COMMIT = "bfa3a1b868b88676cd4ea82b44a6bd22f280ca62" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PATH = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave11-v1.json" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_COUNT = 144 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_BYTES = 587_926 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_SHA256 = "5988f41608a9d5024f8ff11538b6cb9f7460bce76cb511607d104f5e0142b639" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_ROOT_COMMIT = "b5b2600721526e35ff3f5037c10298bae86058ac" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_EVIDENCE_COMMIT = "2d1b6a4545d2b8beaaf95d3859b237248c4b648b" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PATH = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave12-v1.json" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_COUNT = 149 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_BYTES = 636_158 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_SHA256 = "14160ca2c95bee198c04ca6223fc796e9b9295b4cd893b8aee7c4f04d5462f28" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_ROOT_COMMIT = "6ac066bfd868efc876577b40b91b909053d025a3" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_EVIDENCE_COMMIT = "9f1611fbd60b7612fe09711981dd9eb4a76326f8" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PATH = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave13-v1.json" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_COUNT = 155 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_BYTES = 693_449 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_SHA256 = "c2774106e73fe7f4793958eeb2047c27b20f12c0cab0c97c83efa603ef8d8b60" as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_COUNT = 160 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_BYTES = 740_925 as const;
const OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_SHA256 = "2d1803d6d217fc60c0357b4aa7a2d7e0b3993233ba571063315c4493ee910975" as const;
const OBJECT_DB_PARITY_RUNNER = "NODE_OBJECT_DB_PARITY_V1" as const;
const OBJECT_DB_PARITY_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE8_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave8-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE9_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave9-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE10_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave10-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE11_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave11-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE12_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave12-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE13_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave13-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE14_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave14-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE15_HARNESS_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-harness.mjs" as const;
const OBJECT_DB_PARITY_CHILD_TIMEOUT_MS = 10_000;
export const OBJECT_DB_PARITY_WAVE10_CHILD_TIMEOUT_MS = 30_000;
export const OBJECT_DB_PARITY_WAVE11_CHILD_TIMEOUT_MS = 30_000;
export const OBJECT_DB_PARITY_WAVE12_CHILD_TIMEOUT_MS = 30_000;
export const OBJECT_DB_PARITY_WAVE13_CHILD_TIMEOUT_MS = 30_000;
export const OBJECT_DB_PARITY_WAVE14_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE15_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE16_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE17_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE19_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE20_CHILD_TIMEOUT_MS = 120_000;
export const OBJECT_DB_PARITY_WAVE25_CHILD_TIMEOUT_MS = 60_000;
export const OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS = 120_000;
const OBJECT_DB_PARITY_WAVE1_TITLE_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave1-title-list-owned.mjs" as const;
const OBJECT_DB_PARITY_WAVE2_COMPATIBILITY_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave2-compatibility-resolver.mjs" as const;
const OBJECT_DB_PARITY_WAVE3_PLAYER_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave3-player-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE4_PET_TITLE_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave4-pet-title-read.mjs" as const;
const OBJECT_DB_PARITY_WAVE5_PLACED_FURNITURE_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave5-placed-furniture-read.mjs" as const;
const OBJECT_DB_PARITY_WAVE6_MULTI_QUERY_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave6-multi-query.mjs" as const;
const OBJECT_DB_PARITY_WAVE7_SERVICE_CHAIN_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave7-service-chain.mjs" as const;
const OBJECT_DB_PARITY_WAVE8_ADMIN_CHAIN_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave8-admin-chain.mjs" as const;
const OBJECT_DB_PARITY_WAVE9_RANK_CHAIN_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave9-rank-chain.mjs" as const;
const OBJECT_DB_PARITY_WAVE10_PENDANT_READ_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave10-pendant-read.mjs" as const;
const OBJECT_DB_PARITY_WAVE11_HOME_FURNITURE_READ_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave11-home-furniture-read.mjs" as const;
const OBJECT_DB_PARITY_WAVE12_CHARACTER_COUNT_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave12-character-count.mjs" as const;
const OBJECT_DB_PARITY_WAVE13_SERVER_STATS_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave13-server-stats.mjs" as const;
const OBJECT_DB_PARITY_WAVE14_PET_SKILL_PROBABILITY_TARGET_PATH = "개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave14-pet-skill-probability.mjs" as const;
const OBJECT_DB_PARITY_WAVE14_FIXTURE_PATH = "개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave14-pet-skill-probability-v1.json" as const;
const OBJECT_DB_PARITY_WAVE14_EVIDENCE_COMMIT = "3f3416d4ec843db8856540078f9df19ffd5c055d" as const;
const OBJECT_DB_PARITY_WAVE14_HARNESS_SHA256 = "a1159828c054f1b74256baaf9645961722b56c738e1cbe62ae93c46019606eea" as const;
const OBJECT_DB_PARITY_WAVE14_FIXTURE_SHA256 = "7bc4e2c47e84bc624847372ef1d7e71942c9d3175245bd1c15733231c6a7299d" as const;
const OBJECT_DB_PARITY_WAVE14_TARGET_SHA256 = "b53967da249dd7a1b42c1eea0a6323d369e085da3291b8309a4a033c73417ff3" as const;
const OBJECT_DB_PARITY_WAVE14_RECEIPT_IDS = new Set([
  "receipt:wave14:legacy-e038a86d8e885624:read_positive",
  "receipt:wave14:legacy-e038a86d8e885624:negative_guard",
  "receipt:wave14:legacy-e038a86d8e885624:exact_output",
  "receipt:wave14:legacy-e038a86d8e885624:source_domain_dml_zero",
  "receipt:wave14:legacy-e038a86d8e885624:restart_consistency",
]);
const OBJECT_DB_PARITY_WAVE15_CONSUMER_ID="legacy-0a10ef65ad4b37cd" as const;
const OBJECT_DB_PARITY_WAVE15_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave15-pet-skill-info-private-dev.mjs" as const;
const OBJECT_DB_PARITY_WAVE15_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave15-pet-skill-info-private-dev-v1.json" as const;
const OBJECT_DB_PARITY_WAVE15_EVIDENCE_COMMIT="ec7144a29c8bcd5066bf21243fc111c873582b1b" as const;
const OBJECT_DB_PARITY_WAVE15_HARNESS_SHA256="fc16a16494d18c59b9293750eebe1121c698c5796e4fe72dcb7113e12bcdb00a" as const;
const OBJECT_DB_PARITY_WAVE15_FIXTURE_SHA256="2e6bea0bc856a3ec0fdbbd8e80350db201ddc7a88de9946c61f03d2787ad54cc" as const;
const OBJECT_DB_PARITY_WAVE15_TARGET_SHA256="cf8d765757856e22c111269f85b7fb157005a6ac4284fa09f2e7182a03b2bb12" as const;
const OBJECT_DB_PARITY_WAVE16_CONSUMER_ID="legacy-0a10ef65ad4b37cd" as const;
const OBJECT_DB_PARITY_WAVE16_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE16_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave16-pet-skill-info-direct-reply.mjs" as const;
const OBJECT_DB_PARITY_WAVE16_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave16-pet-skill-info-direct-reply-v1.json" as const;
const OBJECT_DB_PARITY_WAVE17_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE17_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave17-item-bag-read-providers.mjs" as const;
const OBJECT_DB_PARITY_WAVE17_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave17-item-bag-read-providers-v1.json" as const;
const OBJECT_DB_PARITY_WAVE17_CONSUMERS={
  "sql-repository-19f17500144188bf":{exportName:"executeWave17LegacyBagOwnerLabelResolve",file:"개발환경_고도화/runtime/src/inventory/legacy-bag-owner-label-provider.ts",symbol:"resolve"},
  "sql-repository-2415b4267e1577c6":{exportName:"executeWave17CanonicalItemBagImportReadinessInspect",file:"개발환경_고도화/runtime/src/inventory/canonical-item-bag-import-readiness-provider.ts",symbol:"inspect"},
  "sql-repository-3b23c2f0f5501988":{exportName:"executeWave17LegacyRankLabelSideEffectReadinessResolve",file:"개발환경_고도화/runtime/src/inventory/legacy-rank-label-side-effect-readiness-provider.ts",symbol:"resolve"},
} as const;
const OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_COUNT=182 as const;
const OBJECT_DB_PARITY_WAVE18_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave18-read4-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE18_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave18-read4.mjs" as const;
const OBJECT_DB_PARITY_WAVE18_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave18-read4-v1.json" as const;
const OBJECT_DB_PARITY_WAVE18_CONSUMERS={
  "sql-repository-3001ad9fc2f36d01":{exportName:"executeWave18BagCompare",file:"개발환경_고도화/runtime/src/inventory/bag-shadow-parity-provider.ts",symbol:"compare"},
  "sql-repository-41a1be35f0d83825":{exportName:"executeWave18PetEvaluate",file:"개발환경_고도화/runtime/src/pet/pet-skill-info-shadow-service.ts",symbol:"evaluate"},
  "sql-repository-4fdd013faca84a3f":{exportName:"executeWave18PetReadinessInspect",file:"개발환경_고도화/runtime/src/pet/canonical-pet-skill-readiness-provider.ts",symbol:"inspect"},
  "sql-repository-55dcd683c5528d65":{exportName:"executeWave18PetEvaluateInSnapshot",file:"개발환경_고도화/runtime/src/pet/pet-skill-info-shadow-service.ts",symbol:"evaluateInSnapshot"},
} as const;
const OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_COUNT=202 as const;
const OBJECT_DB_PARITY_WAVE19_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave19-package-wizard-status-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE19_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave19-package-wizard-status.mjs" as const;
const OBJECT_DB_PARITY_WAVE19_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave19-package-wizard-status-v1.json" as const;
const OBJECT_DB_PARITY_WAVE19_CONSUMER_ID="runtime-dispatch-79ff58fea52c7457" as const;
const OBJECT_DB_PARITY_WAVE19_EXPORT_NAME="executeWave19PackageWizardStatus" as const;
const OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_COUNT=207 as const;
const OBJECT_DB_PARITY_WAVE20_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave20-package-import-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE20_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave20-package-import.mjs" as const;
const OBJECT_DB_PARITY_WAVE20_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave20-package-import-v1.json" as const;
const OBJECT_DB_PARITY_WAVE20_CONSUMER_ID="sql-repository-b1d650b73c2ddff0" as const;
const OBJECT_DB_PARITY_WAVE20_EXPORT_NAME="executeWave20PackageImport" as const;
const OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_COUNT=213 as const;
const OBJECT_DB_PARITY_WAVE20_ALLOWED_TABLES=["object_identities","object_identity_crosswalks","canonical_package_definitions","canonical_package_definition_imports","canonical_package_reward_groups","canonical_package_reward_entries","canonical_package_item_rewards","canonical_package_nested_rewards","canonical_package_reward_quarantines","canonical_package_definition_replays"] as const;
const OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_BYTES=883_778 as const;
const OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_SHA256="d85dc0275af21fc6492df9c8f5565d03a105d0695f1c100731c9ef9eca659f34" as const;
const OBJECT_DB_PARITY_WAVE20_EVIDENCE_COMMIT="bbb5297245195ae03d71580a737b4354444bbf59" as const;
const OBJECT_DB_PARITY_WAVE21_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave21-pet-equipment-assign-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE21_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave21-pet-equipment-assign.mjs" as const;
const OBJECT_DB_PARITY_WAVE21_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave21-pet-equipment-assign-v1.json" as const;
const OBJECT_DB_PARITY_WAVE21_CONSUMER_ID="sql-repository-4f896a4a6feb5ec1" as const;
const OBJECT_DB_PARITY_WAVE21_EXPORT_NAME="executeWave21PetEquipmentAssign" as const;
const OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_COUNT=219 as const;
const OBJECT_DB_PARITY_WAVE21_ALLOWED_TABLES=["object_identities","object_identity_crosswalks","canonical_owned_pet_equipment","canonical_pet_equipment_operation_replays"] as const;
const OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_BYTES=903_454 as const;
const OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_SHA256="6ef3d333dc5a6605734eeb346b75069d1a0b3c6eeb498e81cbce03d8ff26b333" as const;
const OBJECT_DB_PARITY_WAVE21_EVIDENCE_COMMIT="86274556c610b8934380b74a25dcf160d6681da6" as const;
const OBJECT_DB_PARITY_WAVE22_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave22-furniture-grant-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE22_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave22-furniture-grant.mjs" as const;
const OBJECT_DB_PARITY_WAVE22_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave22-furniture-grant-v1.json" as const;
const OBJECT_DB_PARITY_WAVE22_CONSUMER_ID="sql-repository-6a8f4b07e980a91f" as const;
const OBJECT_DB_PARITY_WAVE22_EXPORT_NAME="executeWave22FurnitureGrant" as const;
const OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_COUNT=225 as const;
const OBJECT_DB_PARITY_WAVE22_EVIDENCE_COMMIT="da5532d80f9a8d313c75dd162340b1cd9ab0db1c" as const;
const OBJECT_DB_PARITY_WAVE22_ALLOWED_TABLES=["object_owned_furniture_instances","object_furniture_operation_replays"] as const;
const OBJECT_DB_PARITY_WAVE23_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave23-mutations-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE23_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave23-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE23_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave23-mutations-v1.json" as const;
const OBJECT_DB_PARITY_WAVE23_EXPORT_NAME="executeWave23Mutation" as const;
const OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_COUNT=243 as const;
const OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_BYTES=919_668 as const;
const OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_SHA256="1a7bec9fefe0c009012fbaa3286f987a1ae8b8d279cbd23ab0870e4919d83809" as const;
const OBJECT_DB_PARITY_WAVE23_CONSUMERS={
  "sql-repository-818137c4fb22037a":{wbs:"WBS787",className:"MariaCanonicalFurnitureHomeRepository",methodName:"placeOwnedFurniture",allowedTables:["object_owned_furniture_instances","object_home_furniture_placements","object_furniture_operation_replays","object_furniture_ownership_history"]},
  "sql-repository-f6c531148a436a21":{wbs:"WBS788",className:"MariaCanonicalMiniPetRepository",methodName:"acquire",allowedTables:["canonical_owned_mini_pet_instances","canonical_mini_pet_operation_replays"]},
  "sql-repository-31c4099080d9c9c1":{wbs:"WBS789",className:"MariaCanonicalPetSkillRepository",methodName:"grant",allowedTables:["canonical_owned_pet_skill_stacks","canonical_pet_skill_operation_replays"]},
} as const;
const OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_BYTES=849_438 as const;
const OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_SHA256="92824417cd67180ed155edf01d39d8acc156c276f16077361f01b46a9193a9b2" as const;
const OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_BYTES=838_358 as const;
const OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_SHA256="9d2772842555871d2b96c8c80c7029549b5d5f9a6f5d8d7e0aebcb1c0e7e9b7b" as const;
const OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_BYTES=795_793 as const;
const OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_SHA256="ce5c0c207b9bb28f83553f776851b0d87d8e87f58aa9ba2cfca9c8d3f68663b6" as const;
const OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_COUNT=167 as const;
const OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_BYTES=762_133 as const;
const OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_SHA256="64f80cf0f01beff713905ba414db4c11f1f192e6eab8136127047d3d2444015f" as const;
const OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_COUNT=167 as const;
const OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_BYTES=800_975 as const;
const OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_SHA256="13f737ec01a5f0ace33efc2d4243baef1880d21fb5ac21f47f8bbe60fc2c44f5" as const;
const OBJECT_DB_PARITY_WAVE15_RUNTIME_SOURCE_HASHES=[
  {path:"개발환경_고도화/runtime/src/app.ts",sha256:"2b37454a23236e22d7df321165f53d1cce2542af16f1b4a5b6d1af34ccbce3f8"},
  {path:"개발환경_고도화/runtime/src/dispatch/app-wiring-operation-provider.ts",sha256:"e20134fb8ecd4d8e6a5d63c9db495f347181638404e8bbc1e006c41917f50373"},
  {path:"개발환경_고도화/runtime/src/dispatch/app-wiring-read-only-recovery-provider.ts",sha256:"155927d4b3136f9e0dfc138cc0425353baa0ae2de050827b4c333116d2537e4a"},
  {path:"개발환경_고도화/runtime/src/pet/pet-skill-info-read-only-recovery-ingress.ts",sha256:"fca82050b248bc79a10a8f204a06d8fbfb13605bb0ee70b0e26f59557b9efdcf"},
  {path:"개발환경_고도화/runtime/src/pet/pet-skill-info-shadow-service.ts",sha256:"bf3ccba378e39dba30d57c730b63afadc4bcd38bc7d8f5b8eb89c35725c8f964"},
] as const;
const OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS=new Set([
  "receipt:wave15:legacy-0a10ef65ad4b37cd:read_positive",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:negative_guard",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:auth_denied",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:wrong_room_rejected",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:exact_output",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:source_domain_dml_zero",
  "receipt:wave15:legacy-0a10ef65ad4b37cd:restart_consistency",
]);
const OBJECT_DB_PARITY_WAVE16_RECEIPT_IDS=new Set([
  "receipt:wave16:legacy-0a10ef65ad4b37cd:read_positive",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:negative_guard",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:auth_denied",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:wrong_room_rejected",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:exact_output",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:source_domain_dml_zero",
  "receipt:wave16:legacy-0a10ef65ad4b37cd:restart_consistency",
]);
const OBJECT_DB_PARITY_WAVE17_RECEIPT_IDS=new Set(Object.keys(OBJECT_DB_PARITY_WAVE17_CONSUMERS).flatMap(consumerId=>[
  "READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY",
].map(kind=>`receipt:wave17:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE18_RECEIPT_IDS=new Set(Object.keys(OBJECT_DB_PARITY_WAVE18_CONSUMERS).flatMap(consumerId=>[
  "READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY",
].map(kind=>`receipt:wave18:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE19_RECEIPT_IDS=new Set([
  "READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY",
].map(kind=>`receipt:wave19:${OBJECT_DB_PARITY_WAVE19_CONSUMER_ID}:${kind.toLowerCase()}`));
const OBJECT_DB_PARITY_WAVE20_RECEIPT_IDS=new Set([
  "MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER",
].map(kind=>`receipt:wave20:${OBJECT_DB_PARITY_WAVE20_CONSUMER_ID}:${kind.toLowerCase()}`));
const OBJECT_DB_PARITY_WAVE21_RECEIPT_IDS=new Set([
  "MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER",
].map(kind=>`receipt:wave21:${OBJECT_DB_PARITY_WAVE21_CONSUMER_ID}:${kind.toLowerCase()}`));
const OBJECT_DB_PARITY_WAVE22_RECEIPT_IDS=new Set([
  "MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER",
].map(kind=>`receipt:wave22:${OBJECT_DB_PARITY_WAVE22_CONSUMER_ID}:${kind.toLowerCase()}`));
const OBJECT_DB_PARITY_WAVE23_RECEIPT_IDS=new Set(Object.keys(OBJECT_DB_PARITY_WAVE23_CONSUMERS).flatMap(consumerId=>[
  "MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER",
].map(kind=>`receipt:wave23:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE24_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave24-mutations-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE24_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave24-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE24_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave24-mutations-v1.json" as const;
const OBJECT_DB_PARITY_WAVE24_EXPORT_NAME="executeWave24Mutation" as const;
const OBJECT_DB_PARITY_WAVE24_FULL_RECEIPT_COUNT=249 as const;
const OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_BYTES=970_854 as const;
const OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_SHA256="e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97" as const;
const OBJECT_DB_PARITY_WAVE24_CONSUMERS={
  "sql-repository-87ed81931dd7417b":{wbs:"WBS790",className:"CanonicalItemInventoryRepository",methodName:"changeStackQuantity",allowedTables:["canonical_owned_item_stacks","canonical_item_inventory_operations","canonical_item_inventory_ledger_entries"]},
} as const;
const OBJECT_DB_PARITY_WAVE24_RECEIPT_IDS=new Set(Object.keys(OBJECT_DB_PARITY_WAVE24_CONSUMERS).flatMap(consumerId=>[
  "MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER",
].map(kind=>`receipt:wave24:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE25_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave25-item-bag-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE25_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave25-item-bag.mjs" as const;
const OBJECT_DB_PARITY_WAVE25_FIXTURE_PATH="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-executable-parity-wave25-item-bag-v1.json" as const;
const OBJECT_DB_PARITY_WAVE25_CONSUMER_ID="legacy-94904fa11988ff04" as const;
const OBJECT_DB_PARITY_WAVE25_EXPORT_NAME="executeWave25ItemBag" as const;
const OBJECT_DB_PARITY_WAVE25_FULL_RECEIPT_COUNT=254 as const;
const OBJECT_DB_PARITY_WAVE25_RECEIPT_IDS=new Set([
  "READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY",
].map(kind=>`receipt:wave25:${OBJECT_DB_PARITY_WAVE25_CONSUMER_ID}:${kind.toLowerCase()}`));
const OBJECT_DB_PARITY_WAVE26_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave26-rocket-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE26_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave26-rocket-projection-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE26_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave26-rocket-v1.json" as const;
const OBJECT_DB_PARITY_WAVE26_EXPORT_NAME="executeWave26RocketProjection" as const;
const OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_COUNT=324 as const;
const OBJECT_DB_PARITY_WAVE25_PREFIX_BYTES=999_311 as const;
const OBJECT_DB_PARITY_WAVE25_PREFIX_SHA256="103338fbc49d17d47f0a04c3fa66e98575bf5a9ca7241ab7e878dd9a907131b5" as const;
const OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID="legacy-16dc4874712ffe07" as const;
const OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS=["legacy-16dc4874712ffe07","legacy-b9a3e9684a6c3909","legacy-cc1ca98a74fa80e5","legacy-dec710bc74968473","legacy-b455212232514478","legacy-7c3e90397c74fdc0","legacy-1e1016af0dea53d4","legacy-15076f1474d3bf90","legacy-8befb54eb907db04","legacy-7fa084c426801da5"].sort() as string[];
const OBJECT_DB_PARITY_WAVE26_SCENARIOS=["MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER","AUTH_DENIED"] as const;
const OBJECT_DB_PARITY_WAVE26_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE26_SCENARIOS.map(kind=>`receipt:wave26:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE26_ALLOWED_TABLES=new Set(["operations","outbox_messages","command_executions","command_audit","canonical_owned_item_stacks","canonical_item_inventory_operations","canonical_item_inventory_ledger_entries"]);
const OBJECT_DB_PARITY_WAVE27_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave27-slot-newbie-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE27_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave27-slot-newbie-projection-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE27_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave27-slot-newbie-v1.json" as const;
const OBJECT_DB_PARITY_WAVE27_EXPORT_NAME="executeWave27SlotNewbieProjection" as const;
const OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_COUNT=352 as const;
const OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_BYTES=1_260_829 as const;
const OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_SHA256="72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb" as const;
const OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID="legacy-36588f6a2db3277d" as const;
const OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS=["legacy-36588f6a2db3277d","legacy-02d447882f335ea1","legacy-ac46db2ac0deedf4","legacy-f51202b9335997d8"].sort() as string[];
const OBJECT_DB_PARITY_WAVE27_SCENARIOS=["MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER","AUTH_DENIED"] as const;
const OBJECT_DB_PARITY_WAVE27_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE27_SCENARIOS.map(kind=>`receipt:wave27:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE27_ALLOWED_TABLES=OBJECT_DB_PARITY_WAVE26_ALLOWED_TABLES;
const OBJECT_DB_PARITY_WAVE29_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave29-home-badge-usage-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE29_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave29-home-badge-usage-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE29_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave29-home-badge-usage-v1.json" as const;
const OBJECT_DB_PARITY_WAVE29_EXPORT_NAME="executeWave29HomeBadgeUsage" as const;
const OBJECT_DB_PARITY_WAVE29_FULL_RECEIPT_COUNT=362 as const;
const OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_BYTES=1_361_204 as const;
const OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_SHA256="70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b" as const;
const OBJECT_DB_PARITY_WAVE29_CONSUMER_IDS=["legacy-827e1dc284cea52c","legacy-bf7edb9e7cee98cd"].sort() as string[];
const OBJECT_DB_PARITY_WAVE29_SCENARIOS=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"] as const;
const OBJECT_DB_PARITY_WAVE29_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE29_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE29_SCENARIOS.map(kind=>`receipt:wave29:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE30_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave30-player-title-read-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE30_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave30-player-title-read-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE30_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave30-player-title-read-v1.json" as const;
const OBJECT_DB_PARITY_WAVE30_EXPORT_NAME="executeWave30PlayerTitleRead" as const;
const OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_COUNT=372 as const;
const OBJECT_DB_PARITY_WAVE30_CONSUMER_IDS=["runtime-dispatch-e2445b135d4fb12c","runtime-dispatch-e2dde461680d21ca"].sort() as string[];
const OBJECT_DB_PARITY_WAVE30_SCENARIOS=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"] as const;
const OBJECT_DB_PARITY_WAVE30_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE30_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE30_SCENARIOS.map(kind=>`receipt:wave30:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE31_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave31-member-title-legacy-list-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE31_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave31-member-title-legacy-list-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE31_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave31-member-title-legacy-list-v1.json" as const;
const OBJECT_DB_PARITY_WAVE31_FIXTURE_ID="fixture:object-db-executable-parity:wave31:member-title-legacy-list:v1" as const;
const OBJECT_DB_PARITY_WAVE31_EXPORT_NAME="executeWave31MemberTitleLegacyList" as const;
const OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_COUNT=382 as const;
const OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_BYTES=1_485_238 as const;
const OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_SHA256="f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546" as const;
const OBJECT_DB_PARITY_WAVE31_CONSUMER_IDS=["legacy-542e265c2135fb46","legacy-d04b5224bde6be54"].sort() as string[];
const OBJECT_DB_PARITY_WAVE31_SCENARIOS=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"] as const;
const OBJECT_DB_PARITY_WAVE31_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE31_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE31_SCENARIOS.map(kind=>`receipt:wave31:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE32_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave32-member-title-legacy-info-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE32_TARGET_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave32-member-title-legacy-info-target.mjs" as const;
const OBJECT_DB_PARITY_WAVE32_FIXTURE_PATH="개발환경_고도화/migration-control/contracts/object-db-consumer-executable-parity-wave32-member-title-legacy-info-v1.json" as const;
const OBJECT_DB_PARITY_WAVE32_FIXTURE_ID="fixture:object-db-executable-parity:wave32:member-title-legacy-info:v1" as const;
const OBJECT_DB_PARITY_WAVE32_EXPORT_NAME="executeWave32MemberTitleLegacyInfo" as const;
const OBJECT_DB_PARITY_WAVE32_FULL_RECEIPT_COUNT=387 as const;
const OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_BYTES=1_588_071 as const;
const OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_SHA256="df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506" as const;
const OBJECT_DB_PARITY_WAVE32_CONSUMER_IDS=["legacy-798257cac0e93e27"] as string[];
const OBJECT_DB_PARITY_WAVE32_SCENARIOS=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"] as const;
const OBJECT_DB_PARITY_WAVE32_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE32_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE32_SCENARIOS.map(kind=>`receipt:wave32:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_WAVE33_HARNESS_PATH="개발환경_고도화/runtime/test/fixtures/object-db-executable-parity-wave33-title-ticket-harness.mjs" as const;
const OBJECT_DB_PARITY_WAVE33_FULL_RECEIPT_COUNT=401 as const;
const OBJECT_DB_PARITY_WAVE33_CONSUMER_IDS=["legacy-bda1428003a5b522","runtime-dispatch-948bbf36d6af623a"].sort() as string[];
const OBJECT_DB_PARITY_WAVE33_SCENARIOS=["MUTATION_SUCCESS","DOMAIN_FAILURE_ROLLBACK","DUPLICATE_REPLAY_DML_ZERO","PAYLOAD_DRIFT_FAIL_CLOSED","RESTART_REPLAY","CONCURRENCY_SINGLE_WRITER","AUTH_DENIED"] as const;
const OBJECT_DB_PARITY_WAVE33_RECEIPT_IDS=new Set(OBJECT_DB_PARITY_WAVE33_CONSUMER_IDS.flatMap(consumerId=>OBJECT_DB_PARITY_WAVE33_SCENARIOS.map(kind=>`receipt:wave33:${consumerId}:${kind.toLowerCase()}`)));
const OBJECT_DB_PARITY_HISTORICAL_EVIDENCE_COMMITS:Readonly<Record<string,string>>={
  wave1:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave2:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,
  wave3:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave4:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,
  wave5:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave6:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,
  wave7:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave8:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,
  wave9:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave10:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,
  wave11:OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT,wave12:OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_EVIDENCE_COMMIT,
  wave13:OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_EVIDENCE_COMMIT,wave14:OBJECT_DB_PARITY_WAVE14_EVIDENCE_COMMIT,
  wave15:OBJECT_DB_PARITY_WAVE15_EVIDENCE_COMMIT,wave20:OBJECT_DB_PARITY_WAVE20_EVIDENCE_COMMIT,wave21:OBJECT_DB_PARITY_WAVE21_EVIDENCE_COMMIT,wave22:OBJECT_DB_PARITY_WAVE22_EVIDENCE_COMMIT,
};
const TRUSTED_WAVE1_TITLE_READS = {
  "sql-repository-0dc3c380c54081a2": { domain: "member", symbol: "member.listOwned", triggerOrPredicate: "SQL_METHOD:member:listOwned", interfaceId: "member-title.repository.maria-canonical-title-repository.member.listOwned", definitionTable: "canonical_member_title_definitions", definitionId: "member_title_id", ownershipTable: "canonical_owned_member_title_instances", ownedId: "owned_member_title_id", selectionTable: "canonical_member_title_selections" },
  "sql-repository-a0a5f5d8f3338d7b": { domain: "pet", symbol: "pet.listOwned", triggerOrPredicate: "SQL_METHOD:pet:listOwned", interfaceId: "pet-title.repository.maria-canonical-title-repository.pet.listOwned", definitionTable: "canonical_pet_title_definitions", definitionId: "pet_title_id", ownershipTable: "canonical_owned_pet_title_instances", ownedId: "owned_pet_title_id", selectionTable: "canonical_pet_title_selections" },
  "sql-repository-6a1bdfaafba10749": { domain: "mini_pet", symbol: "mini-pet.listOwned", triggerOrPredicate: "SQL_METHOD:mini-pet:listOwned", interfaceId: "mini-pet-title-collection.repository.maria-canonical-title-repository.mini-pet.listOwned", definitionTable: "canonical_mini_pet_title_definitions", definitionId: "mini_pet_title_id", ownershipTable: "canonical_owned_mini_pet_title_instances", ownedId: "owned_mini_pet_title_id", selectionTable: "canonical_mini_pet_title_selections" },
} as const;
const TRUSTED_WAVE2_COMPATIBILITY_READS = {
  "sql-repository-aa5b2d6d12d1268b": { method: "resolveLegacyObjectId", symbol: "resolveLegacyObjectId", triggerOrPredicate: "SQL_METHOD:resolveLegacyObjectId", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveLegacyObjectId", input: ["42", { expectedObjectType: "ITEM" }], negativeInput: ["0", { expectedObjectType: "ITEM" }], expectedQueryValues: ["42"], expectedGuardReason: "LEGACY_OBJECT_ID_INVALID", sqlSuffix: "WHERE registry.id = ?" },
  "sql-repository-fd1e8659cff045f9": { method: "resolveAlias", symbol: "resolveAlias", triggerOrPredicate: "SQL_METHOD:resolveAlias", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveAlias", input: ["ITEM", "legacy_name", "diamond-box", {}], negativeInput: ["ITEM", "invalid_alias_type", "diamond-box", {}], expectedQueryValues: ["ITEM", "legacy_name", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_ALIAS_INVALID", sqlSuffix: "JOIN object_aliases alias ON alias.object_id = registry.id AND alias.object_type = registry.object_type WHERE alias.object_type = ? AND alias.alias_type = ? AND alias.alias_value = ?" },
  "sql-repository-520566e376bf7ee8": { method: "resolveSource", symbol: "resolveSource", triggerOrPredicate: "SQL_METHOD:resolveSource", interfaceId: "context-bridge.repository.object-catalog-compatibility-resolver.resolveSource", input: [{ system: "LEGACY_JSON", table: "data/itemList.json", key: "diamond-box" }, { expectedObjectType: "ITEM" }], negativeInput: [{ system: "LEGACY_JSON", table: "not-allowlisted", key: "diamond-box" }, {}], expectedQueryValues: ["LEGACY_JSON", "data/itemList.json", "diamond-box"], expectedGuardReason: "LEGACY_OBJECT_SOURCE_INVALID", sqlSuffix: "JOIN object_source_bindings source ON source.object_id = registry.id AND source.object_type = registry.object_type WHERE source.source_system = ? AND source.source_table = ? AND source.source_key = ?" },
} as const;

export const OBJECT_DB_EXECUTABLE_PARITY_VERDICTS = [
  "STATIC_ONLY",
  "BLOCKED_DYNAMIC",
  "BLOCKED_REGISTRY_MISMATCH",
  "PARTIAL",
  "DIRECT_PASS",
  "EQUIVALENT_PASS",
] as const;

export function objectDbParityHarnessTimeoutMs(harnessPath: string): number {
  return harnessPath === OBJECT_DB_PARITY_WAVE33_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE32_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE31_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE29_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE27_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE27_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE25_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE25_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE24_HARNESS_PATH||harnessPath === OBJECT_DB_PARITY_WAVE23_HARNESS_PATH||harnessPath === OBJECT_DB_PARITY_WAVE22_HARNESS_PATH||harnessPath === OBJECT_DB_PARITY_WAVE21_HARNESS_PATH||harnessPath === OBJECT_DB_PARITY_WAVE20_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE20_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE19_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE19_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE17_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE17_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE16_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE16_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE15_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE15_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE14_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE14_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE13_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE13_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE12_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE12_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE11_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE11_CHILD_TIMEOUT_MS
    : harnessPath === OBJECT_DB_PARITY_WAVE10_HARNESS_PATH
    ? OBJECT_DB_PARITY_WAVE10_CHILD_TIMEOUT_MS
    : OBJECT_DB_PARITY_CHILD_TIMEOUT_MS;
}

export function executeObjectDbParityHarnessChild(args: readonly string[], timeoutMs: number): string {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new Error("object DB parity child timeout invalid");
  return execFileSync(process.execPath, [...args], { encoding: "utf8", timeout: timeoutMs, maxBuffer: 1024 * 1024 });
}

export type ObjectDbExecutableParityVerdict = typeof OBJECT_DB_EXECUTABLE_PARITY_VERDICTS[number];
export type ConsumerAccess = "READ" | "WRITE" | "READ_WRITE";
export type AccessClass = "READ" | "MUTATION";

type NullableHash = string | null;

export type ExpectedActualHash = {
  expectedSha256: NullableHash;
  actualSha256: NullableHash;
  match: boolean | null;
};

export type ExpectedActualSequence = {
  expected: string[] | null;
  actual: string[] | null;
  match: boolean | null;
};

export type ExpectedActualDml = ExpectedActualHash & {
  expectedNormalizedStatements: string[] | null;
  actualNormalizedStatements: string[] | null;
  expectedRowCount: number | null;
  actualRowCount: number | null;
};

export type ExpectedActualTransaction = {
  expected: "READ_ONLY" | "COMMIT" | "ROLLBACK" | null;
  actual: "READ_ONLY" | "COMMIT" | "ROLLBACK" | null;
  match: boolean | null;
  expectedTimeline: string[] | null;
  actualTimeline: string[] | null;
};

export type ExpectedActualEvidence = {
  reply: ExpectedActualHash;
  result: ExpectedActualHash;
  dml: ExpectedActualDml;
  lockOrder: ExpectedActualSequence;
  transaction: ExpectedActualTransaction;
};

export type ParityScenario = {
  receiptId: string;
  scenarioId: string;
  scenarioKind: ObjectDbParityScenarioKind;
  harnessCaseId: string;
  attributedConsumerIds: string[];
  expectedActual: ExpectedActualEvidence;
};

export const OBJECT_DB_PARITY_READ_SCENARIOS = [
  "READ_POSITIVE",
  "NEGATIVE_GUARD",
  "AUTH_DENIED",
  "WRONG_ROOM_REJECTED",
  "EXACT_OUTPUT",
  "SOURCE_DOMAIN_DML_ZERO",
  "RESTART_CONSISTENCY",
] as const;

export const OBJECT_DB_PARITY_MUTATION_SCENARIOS = [
  "MUTATION_SUCCESS",
  "DOMAIN_FAILURE_ROLLBACK",
  "DUPLICATE_REPLAY_DML_ZERO",
  "PAYLOAD_DRIFT_FAIL_CLOSED",
  "RESTART_REPLAY",
  "CONCURRENCY_SINGLE_WRITER",
  "AUTH_DENIED",
  "WRONG_ROOM_REJECTED",
] as const;

export type ObjectDbParityScenarioKind = typeof OBJECT_DB_PARITY_READ_SCENARIOS[number] | typeof OBJECT_DB_PARITY_MUTATION_SCENARIOS[number];

export type ScenarioRequirement = {
  scenarioKind: ObjectDbParityScenarioKind;
  disposition: "REQUIRED" | "NOT_APPLICABLE";
  notApplicable: null | {
    ruleId: "SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1" | "SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1";
    reasonCode: "NO_AUTH_GUARD" | "NO_ROOM_GUARD";
    reason: string;
    sourceEvidenceSha256: string;
  };
};

export type ParityHarness = {
  harnessId: string | null;
  runner: string | null;
  path: string | null;
  sha256: NullableHash;
};

export type ParityFixture = {
  fixtureId: string | null;
  path: string | null;
  sha256: NullableHash;
};

export type ParityInvocation = {
  targetPath: string | null;
  targetSourceSha256: NullableHash;
  exportName: string | null;
};

export type ParityEvidence = {
  evidenceIds: string[];
  attributedConsumerIds: string[];
  hashes: Array<{ path: string; sha256: string }>;
};

export type MechanicalEquivalenceRule = {
  ruleId: "SAME_INTERFACE_ACCESS_V1" | "ROCKET_PARAMETER_PROJECTION_V1" | "SLOT_NEWBIE_PARAMETER_PROJECTION_V1";
  ruleVersion: "1";
  mechanical: true;
  equivalenceKey: string;
  variantConsumerIds: string[];
};

export type ObjectDbConsumerExecutionReceipt = {
  receiptId: string;
  consumerId: string;
  proofMode: "DIRECT" | "EQUIVALENT";
  harness: { harnessId: string; harnessCaseId: string; runner: string; path: string; sourceSha256: string };
  fixture: { fixtureId: string; path: string; sha256: string };
  invocation: { targetPath: string; targetSourceSha256: string; exportName: string };
  scenario: { scenarioId: string; scenarioKind: ObjectDbParityScenarioKind };
  expectedActual: ExpectedActualEvidence;
  equivalenceRule: MechanicalEquivalenceRule | null;
  verdict: "PASS";
  receiptSha256: string;
};

export type ObjectDbConsumerExecutionReceiptBundle = {
  format: "hoibot-object-db-consumer-execution-receipts-v1";
  catalogVersion: "SC-20260902-1";
  classificationBaseCommit: string;
  evidenceCommit: string;
  receipts: ObjectDbConsumerExecutionReceipt[];
};

export type ConsumerManifestInput = {
  format: "hoibot-object-db-consumer-manifest-v1";
  baseCommit: string;
  sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_SPAN_AND_HASH";
  consumerSetSha256: string;
  consumers: Array<StableConsumerIdentity & {
    consumerId: string;
    access: ConsumerAccess;
    interfaceId: string;
    unresolvedDynamicCallCount: number;
    sourceSpan: { start: number; end: number; sha256: string };
  }>;
  audit: {
    registrySourceMismatchCount: number;
    registrySourceMismatches: string[];
  };
};

const WAVE33_DELTA_PATH = "개발환경_고도화/migration-control/contracts/object-db-consumer-classification-delta.SCD-OBJ-20260910-33.v1.json";

function applyCompatibleClassificationDeltas(
  manifest: ConsumerManifestInput,
  classificationSourceTexts: Readonly<Record<string, string>>,
): ConsumerManifestInput {
  const text = classificationSourceTexts[WAVE33_DELTA_PATH];
  if (text === undefined) return manifest;
  const delta = JSON.parse(canonicalizeObjectDbConsumerSourceText(text)) as Record<string, any>;
  if (delta.format !== "hoibot-object-db-consumer-compatible-delta-v1" || delta.baseCatalogVersion !== "SC-20260902-1" || delta.deltaId !== "SCD-OBJ-20260910-33") {
    throw new Error("Wave33 compatible classification delta provenance drift");
  }
  if (!Array.isArray(delta.operations) || delta.operations.length !== 1) throw new Error("Wave33 compatible classification delta operation drift");
  const operation = delta.operations[0];
  if (operation.operation !== "REPLACE_CLASSIFICATION" || operation.consumerId !== "legacy-bda1428003a5b522"
    || operation.before?.access !== "READ" || operation.after?.access !== "READ_WRITE"
    || operation.after?.accessClass !== "MUTATION" || operation.after?.interfaceMethod !== "EXECUTE"
    || operation.after?.interfaceId !== "member-title.admin-title-gift-ticket-grant.execute") {
    throw new Error("Wave33 compatible classification delta content drift");
  }
  let replaced = false;
  const consumers = manifest.consumers.map(consumer => {
    if (consumer.consumerId !== operation.consumerId) return consumer;
    if (consumer.access !== operation.before.access) throw new Error("Wave33 compatible classification delta before-state drift");
    replaced = true;
    return { ...consumer, access: operation.after.access, interfaceId: operation.after.interfaceId };
  });
  if (!replaced) throw new Error("Wave33 compatible classification delta consumer missing");
  return { ...manifest, consumers };
}

export type ExecutableParityLedgerEntry = {
  consumerId: string;
  classification: {
    kind: string;
    file: string;
    symbol: string;
    triggerOrPredicate: string;
    access: ConsumerAccess;
    accessClass: AccessClass;
    interfaceId: string;
    unresolvedDynamicCallCount: number;
    registrySourceMismatchLabels: string[];
    sourceSpanSha256: string;
    classificationSha256: string;
  };
  verdict: ObjectDbExecutableParityVerdict;
  harness: ParityHarness;
  fixture: ParityFixture;
  invocation: ParityInvocation;
  scenarioRequirements: ScenarioRequirement[];
  scenarios: ParityScenario[];
  evidence: ParityEvidence;
  equivalenceRule: MechanicalEquivalenceRule | null;
};

export type ExecutableParityCoverage = {
  manifestConsumers: number;
  ledgerEntries: number;
  missingConsumerIds: number;
  duplicateConsumerIds: number;
  unknownConsumerIds: number;
  readConsumers: number;
  mutationConsumers: number;
  unresolvedDynamicConsumers: number;
  unresolvedDynamicCallCount: number;
  registrySourceMismatchCount: number;
  registrySourceMismatchAttributedCount: number;
  registrySourceMismatchUnattributedCount: number;
  provenConsumers: number;
  unprovenConsumers: number;
  directPassConsumers: number;
  equivalentPassConsumers: number;
  verdicts: Record<ObjectDbExecutableParityVerdict, number>;
};

export type ExecutableParityLedger = {
  format: typeof OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT;
  catalogVersion: "SC-20260902-1";
  classificationBaseCommit: string;
  evidenceCommit: string;
  sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_HASH";
  sources: {
    ledgerSchema: { path: string; sha256: string };
    executionReceiptSchema: { path: string; sha256: string };
    consumerManifest: { path: string; sha256: string; consumerSetSha256: string };
    consumerIdRegistry: { path: string; sha256: string };
    transitionContract: { path: string; sha256: string };
    executionReceipts: { path: string; sha256: string };
    classificationSources: Array<{ path: string; sha256: string }>;
  };
  registrySourceMismatchResolution: {
    bindings: Array<{ registrySourceMismatch: string; consumerId: string; sourceSpanSha256: string }>;
    unattributed: string[];
  };
  coverage: ExecutableParityCoverage;
  entries: ExecutableParityLedgerEntry[];
  entrySetSha256: string;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const CONSUMER_ID_PATTERN = /^(?:legacy|automatic-callback|runtime-dispatch|admin-command|http-web-route|app-wiring|sql-repository)-[a-f0-9]{16}$/;
const VERDICTS = new Set<string>(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS);
const PASS_VERDICTS = new Set<ObjectDbExecutableParityVerdict>(["DIRECT_PASS", "EQUIVALENT_PASS"]);

export function sha256CanonicalText(value: string): string {
  return createHash("sha256").update(canonicalizeObjectDbConsumerSourceText(value)).digest("hex");
}

export function sha256CanonicalJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function deriveSameInterfaceAccessEquivalenceKey(classification: Pick<ExecutableParityLedgerEntry["classification"], "interfaceId" | "accessClass">): string {
  return sha256CanonicalJson({
    ruleId: "SAME_INTERFACE_ACCESS_V1",
    interfaceId: classification.interfaceId,
    accessClass: classification.accessClass,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertTrustedWave26RocketVariantProjection(variant:unknown,manifestConsumer:Pick<ConsumerManifestInput["consumers"][number],"consumerId"|"triggerOrPredicate">):void{
  if(!isRecord(variant))throw new Error(`${manifestConsumer.consumerId} Wave26 variant missing`);
  assertExactKeys(variant,["consumerId","trigger","rocketNo","itemName","reply","payload"],`${manifestConsumer.consumerId}.Wave26Variant`);
  const rocketNo=Number(String(manifestConsumer.triggerOrPredicate).match(/^\/로켓(10|[1-9]),$/)?.[1]),itemName=`로켓배송패키지🚀[${rocketNo}](/호팡오픈${rocketNo})`,reply=`[대상 회원]님에게 ${itemName}가 지급되었습니다.`,payload={amount:"1",targetLegacyKey:"대상 회원",reasonType:"ADMIN_ROCKET_PACKAGE_GRANT",itemName};
  if(!Number.isInteger(rocketNo)||variant.consumerId!==manifestConsumer.consumerId||variant.trigger!==manifestConsumer.triggerOrPredicate||variant.rocketNo!==rocketNo||variant.itemName!==itemName||variant.reply!==reply||!isRecord(variant.payload))throw new Error(`${manifestConsumer.consumerId} Wave26 trigger/parameter projection drift`);
  assertExactKeys(variant.payload,["amount","targetLegacyKey","reasonType","itemName"],`${manifestConsumer.consumerId}.Wave26Variant.payload`);
  if(JSON.stringify(variant.payload)!==JSON.stringify(payload))throw new Error(`${manifestConsumer.consumerId} Wave26 payload projection drift`);
}

export function assertTrustedWave27SlotNewbieVariantProjection(variant:unknown,manifestConsumer:Pick<ConsumerManifestInput["consumers"][number],"consumerId"|"triggerOrPredicate"|"sourceSpan">):void{
  if(!isRecord(variant))throw new Error(`${manifestConsumer.consumerId} Wave27 variant missing`);
  assertExactKeys(variant,["consumerId","trigger","predicate","variantNo","itemName","reply","payload","sourceSpan"],`${manifestConsumer.consumerId}.Wave27Variant`);
  const match=String(manifestConsumer.triggerOrPredicate).match(/^msg\.startsWith\("\/슬롯초보([2-4])?,"\) && isMaster\(sender\)$/),variantNo=match?.[1]===undefined?1:Number(match[1]),suffix=variantNo===1?"":String(variantNo),trigger=`/슬롯초보${suffix},`,itemName=`슬롯초보패키지${suffix}🪙(/슬롯초보오픈${suffix})`,reply=`대상 회원님에게 슬롯초보패키지${suffix}(/슬롯초보오픈${suffix})🪙를 지급했습니다.`,payload={amount:"1",targetLegacyKey:"대상 회원",reasonType:"ADMIN_SLOT_NEWBIE_PACKAGE_GRANT",itemName};
  if(!match||variant.consumerId!==manifestConsumer.consumerId||variant.trigger!==trigger||variant.predicate!==manifestConsumer.triggerOrPredicate||variant.variantNo!==variantNo||variant.itemName!==itemName||variant.reply!==reply||!isRecord(variant.payload))throw new Error(`${manifestConsumer.consumerId} Wave27 trigger/parameter projection drift`);
  assertExactKeys(variant.payload,["amount","targetLegacyKey","reasonType","itemName"],`${manifestConsumer.consumerId}.Wave27Variant.payload`);
  if(JSON.stringify(variant.payload)!==JSON.stringify(payload)||JSON.stringify(variant.sourceSpan)!==JSON.stringify(manifestConsumer.sourceSpan))throw new Error(`${manifestConsumer.consumerId} Wave27 payload/source projection drift`);
}

function matchesTrustedTraceValue(actual:unknown,expected:unknown):boolean{
  if(isRecord(expected)&&expected.matcher==="UUID_V4")return typeof actual==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actual);
  if(isRecord(expected)&&typeof expected.$bigint==="string")return actual===expected.$bigint;
  return JSON.stringify(actual)===JSON.stringify(expected);
}

function assertExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} keys drift: expected=${expected.join(",")} actual=${actual.join(",")}`);
}

function assertHash(value: unknown, label: string, nullable = false): asserts value is string | null {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) throw new Error(`${label} must be sha256`);
}

function assertCommit(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !COMMIT_PATTERN.test(value)) throw new Error(`${label} must be a 40-character commit`);
}

function assertSortedUniqueStrings(values: unknown, label: string, allowEmpty = true): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
  if (!allowEmpty && values.length === 0) throw new Error(`${label} must not be empty`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
  if (values.some((value, index) => index > 0 && values[index - 1]! > value)) throw new Error(`${label} must be sorted`);
}

function assertUniqueStrings(values: unknown, label: string): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
  if (new Set(values).size !== values.length) throw new Error(`${label} contains duplicates`);
}

function assertStringArray(values: unknown, label: string): asserts values is string[] {
  if (!Array.isArray(values) || values.some((value) => typeof value !== "string" || value.length === 0)) throw new Error(`${label} must be string[]`);
}

function emptyExpectedActual(): ExpectedActualEvidence {
  return {
    reply: { expectedSha256: null, actualSha256: null, match: null },
    result: { expectedSha256: null, actualSha256: null, match: null },
    dml: { expectedSha256: null, actualSha256: null, match: null, expectedNormalizedStatements: null, actualNormalizedStatements: null, expectedRowCount: null, actualRowCount: null },
    lockOrder: { expected: null, actual: null, match: null },
    transaction: { expected: null, actual: null, match: null, expectedTimeline: null, actualTimeline: null },
  };
}

function emptyExecutionEvidence(scenarioRequirements: ScenarioRequirement[]): Pick<ExecutableParityLedgerEntry, "harness" | "fixture" | "invocation" | "scenarioRequirements" | "scenarios" | "evidence" | "equivalenceRule"> {
  return {
    harness: { harnessId: null, runner: null, path: null, sha256: null },
    fixture: { fixtureId: null, path: null, sha256: null },
    invocation: { targetPath: null, targetSourceSha256: null, exportName: null },
    scenarioRequirements,
    scenarios: [],
    evidence: { evidenceIds: [], attributedConsumerIds: [], hashes: [] },
    equivalenceRule: null,
  };
}

function classificationProjection(consumer: ConsumerManifestInput["consumers"][number], registrySourceMismatchLabels: string[] = []): ExecutableParityLedgerEntry["classification"] {
  const projection = {
    kind: consumer.kind,
    file: consumer.file,
    symbol: consumer.symbol,
    triggerOrPredicate: consumer.triggerOrPredicate,
    access: consumer.access,
    accessClass: consumer.access === "READ" ? "READ" as const : "MUTATION" as const,
    interfaceId: consumer.interfaceId,
    unresolvedDynamicCallCount: consumer.unresolvedDynamicCallCount,
    registrySourceMismatchLabels: registrySourceMismatchLabels.slice().sort(),
    sourceSpanSha256: consumer.sourceSpan.sha256,
  };
  return { ...projection, classificationSha256: sha256CanonicalJson(projection) };
}

function baselineVerdict(consumer: ConsumerManifestInput["consumers"][number], registrySourceMismatchLabels: string[]): ObjectDbExecutableParityVerdict {
  if (registrySourceMismatchLabels.length > 0) return "BLOCKED_REGISTRY_MISMATCH";
  return consumer.unresolvedDynamicCallCount > 0 ? "BLOCKED_DYNAMIC" : "STATIC_ONLY";
}

function sourceClassificationHasAuthGuard(consumer: ConsumerManifestInput["consumers"][number]): boolean {
  const source = `${consumer.kind}|${consumer.triggerOrPredicate}|${consumer.symbol}|${consumer.interfaceId}`;
  return consumer.kind === "ADMIN_COMMAND" || /(?:^|[_.:/|-])admin(?:$|[_.:/|-])|auth|permission|role|isMaster|isAdmin|operator/i.test(source);
}

function sourceClassificationHasRoomGuard(consumer: ConsumerManifestInput["consumers"][number]): boolean {
  const source = `${consumer.triggerOrPredicate}|${consumer.symbol}|${consumer.interfaceId}`;
  return /room|channel|isGroupChat|operational/i.test(source);
}

function scenarioRequirementsFor(consumer: ConsumerManifestInput["consumers"][number], classificationSha256: string,consumerId?:string): ScenarioRequirement[] {
  const accessClass: AccessClass = consumer.access === "READ" ? "READ" : "MUTATION";
  const kinds = accessClass === "READ" ? OBJECT_DB_PARITY_READ_SCENARIOS : OBJECT_DB_PARITY_MUTATION_SCENARIOS;
  if((consumer.consumerId??consumerId)===OBJECT_DB_PARITY_WAVE15_CONSUMER_ID)return kinds.map(scenarioKind=>({scenarioKind,disposition:"REQUIRED",notApplicable:null}));
  const authRequired = sourceClassificationHasAuthGuard(consumer);
  const roomRequired = sourceClassificationHasRoomGuard(consumer);
  return kinds.map((scenarioKind): ScenarioRequirement => {
    if (scenarioKind === "AUTH_DENIED" && !authRequired) return {
      scenarioKind,
      disposition: "NOT_APPLICABLE",
      notApplicable: {
        ruleId: "SOURCE_CLASSIFICATION_HAS_NO_AUTH_GUARD_V1",
        reasonCode: "NO_AUTH_GUARD",
        reason: "Frozen consumer classification contains no authentication or authorization guard.",
        sourceEvidenceSha256: classificationSha256,
      },
    };
    if (scenarioKind === "WRONG_ROOM_REJECTED" && !roomRequired) return {
      scenarioKind,
      disposition: "NOT_APPLICABLE",
      notApplicable: {
        ruleId: "SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1",
        reasonCode: "NO_ROOM_GUARD",
        reason: "Frozen consumer classification contains no room or channel guard.",
        sourceEvidenceSha256: classificationSha256,
      },
    };
    return { scenarioKind, disposition: "REQUIRED", notApplicable: null };
  });
}

function assertRepoRelativeEvidencePath(path: string, label: string): void {
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..")) throw new Error(`${label} must be a repo-relative POSIX path`);
}

export function parseObjectDbConsumerExecutionReceiptBundle(value: unknown): ObjectDbConsumerExecutionReceiptBundle {
  if (!isRecord(value)) throw new Error("execution receipt bundle must be an object");
  assertExactKeys(value, ["format", "catalogVersion", "classificationBaseCommit", "evidenceCommit", "receipts"], "execution receipt bundle");
  if (value.format !== "hoibot-object-db-consumer-execution-receipts-v1") throw new Error("unsupported execution receipt bundle format");
  if (value.catalogVersion !== "SC-20260902-1") throw new Error("unsupported execution receipt bundle catalogVersion");
  assertCommit(value.classificationBaseCommit, "execution receipt bundle classificationBaseCommit");
  assertCommit(value.evidenceCommit, "execution receipt bundle evidenceCommit");
  if (!Array.isArray(value.receipts)) throw new Error("execution receipt bundle receipts must be an array");
  if(value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave12:"))){
    const hasWave13=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave13:"));
    const hasWave14=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave14:"));
    const hasWave15=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave15:"));
    const hasWave16=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave16:"));
    const hasWave17=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave17:"));
    const hasWave18=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave18:"));
    const hasWave19=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave19:"));
    const hasWave20=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave20:"));
    const hasWave21=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave21:"));
    const hasWave22=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave22:"));
    const hasWave23=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave23:"));
    const hasWave24=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave24:"));
    const hasWave25=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave25:"));
    const hasWave26=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave26:"));
    const hasWave27=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave27:"));
    const hasWave29=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave29:"));
    const hasWave30=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave30:"));
    const hasWave31=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave31:"));
    const hasWave32=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave32:"));
    const hasWave33=value.receipts.some(receipt=>isRecord(receipt)&&typeof receipt.receiptId==="string"&&receipt.receiptId.startsWith("receipt:wave33:"));
    if(hasWave15&&hasWave16)throw new Error("Wave15 SHADOW and Wave16 DIRECT receipts cannot be active together");
    if(hasWave17&&!hasWave16)throw new Error("Wave17 receipt bundle must preserve Wave16 receipts");
    if(hasWave18&&!hasWave17)throw new Error("Wave18 receipt bundle must preserve Wave17 receipts");
    if(hasWave19&&!hasWave18)throw new Error("Wave19 receipt bundle must preserve Wave18 receipts");
    if(hasWave20&&!hasWave19)throw new Error("Wave20 receipt bundle must preserve Wave19 receipts");
    if(hasWave21&&!hasWave20)throw new Error("Wave21 receipt bundle must preserve Wave20 receipts");
    if(hasWave22&&!hasWave21)throw new Error("Wave22 receipt bundle must preserve Wave21 receipts");
    if(hasWave23&&!hasWave22)throw new Error("Wave23 receipt bundle must preserve Wave22 receipts");
    if(hasWave24&&!hasWave23)throw new Error("Wave24 receipt bundle must preserve Wave23 receipts");
    if(hasWave25&&!hasWave24)throw new Error("Wave25 receipt bundle must preserve Wave24 receipts");
    if(hasWave26&&!hasWave25)throw new Error("Wave26 receipt bundle must preserve Wave25 receipts");
    if(hasWave27&&!hasWave26)throw new Error("Wave27 receipt bundle must preserve Wave26 receipts");
    if(hasWave29&&!hasWave27)throw new Error("Wave29 receipt bundle must preserve Wave27 receipts");
    if(hasWave30&&!hasWave29)throw new Error("Wave30 receipt bundle must preserve Wave29 receipts");
    if(hasWave31&&!hasWave30)throw new Error("Wave31 receipt bundle must preserve Wave30 receipts");
    if(hasWave32&&!hasWave31)throw new Error("Wave32 receipt bundle must preserve Wave31 receipts");
    if(hasWave33&&!hasWave32)throw new Error("Wave33 receipt bundle must preserve Wave32 receipts");
    if(value.receipts.length!==(hasWave33?OBJECT_DB_PARITY_WAVE33_FULL_RECEIPT_COUNT:hasWave32?OBJECT_DB_PARITY_WAVE32_FULL_RECEIPT_COUNT:hasWave31?OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_COUNT:hasWave30?OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_COUNT:hasWave29?OBJECT_DB_PARITY_WAVE29_FULL_RECEIPT_COUNT:hasWave27?OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_COUNT:hasWave26?OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_COUNT:hasWave25?OBJECT_DB_PARITY_WAVE25_FULL_RECEIPT_COUNT:hasWave24?OBJECT_DB_PARITY_WAVE24_FULL_RECEIPT_COUNT:hasWave23?OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_COUNT:hasWave22?OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_COUNT:hasWave21?OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_COUNT:hasWave20?OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_COUNT:hasWave19?OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_COUNT:hasWave18?OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_COUNT:hasWave17?OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_COUNT:hasWave16?167:hasWave15?167:hasWave14?160:hasWave13?155:149))throw new Error(`${hasWave33?"Wave33":hasWave32?"Wave32":hasWave31?"Wave31":hasWave30?"Wave30":hasWave29?"Wave29":hasWave27?"Wave27":hasWave26?"Wave26":hasWave25?"Wave25":hasWave24?"Wave24":hasWave23?"Wave23":hasWave22?"Wave22":hasWave21?"Wave21":hasWave20?"Wave20":hasWave19?"Wave19":hasWave18?"Wave18":hasWave17?"Wave17":hasWave16?"Wave16":hasWave15?"Wave15":hasWave14?"Wave14":hasWave13?"Wave13":"Wave12"} receipt bundle cardinality drift`);
    const historicalPrefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_COUNT));
    if(Buffer.byteLength(historicalPrefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_BYTES||sha256CanonicalText(historicalPrefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_SHA256)throw new Error(`historical receipt fingerprint drift at ${OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT}`);
    const wave12Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_COUNT));
    if(Buffer.byteLength(wave12Prefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_BYTES||sha256CanonicalText(wave12Prefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_SHA256)throw new Error(`historical receipt fingerprint drift at ${OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_EVIDENCE_COMMIT}`);
    if(hasWave14){const wave13Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_COUNT));if(Buffer.byteLength(wave13Prefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_BYTES||sha256CanonicalText(wave13Prefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_SHA256)throw new Error(`historical receipt fingerprint drift at ${OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_EVIDENCE_COMMIT}`);}
    if(hasWave15||hasWave16||hasWave17||hasWave18||hasWave19||hasWave20){const wave14Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_COUNT));if(Buffer.byteLength(wave14Prefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_BYTES||sha256CanonicalText(wave14Prefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE14_RECEIPT_PREFIX_SHA256)throw new Error("historical Wave14 receipt fingerprint drift");}
    if(hasWave15){const wave15Receipts=JSON.stringify(value.receipts);if(Buffer.byteLength(wave15Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_BYTES||sha256CanonicalText(wave15Receipts)!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_SHA256)throw new Error("historical Wave15 receipt fingerprint drift");}
    if(hasWave17||hasWave18||hasWave19||hasWave20){const wave16Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave16Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_BYTES||sha256CanonicalText(wave16Receipts)!==OBJECT_DB_PARITY_WAVE16_FULL_RECEIPT_SHA256)throw new Error("historical Wave16 receipt fingerprint drift");}
    if(hasWave18||hasWave19||hasWave20){const wave17Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave17Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_BYTES||sha256CanonicalText(wave17Receipts)!==OBJECT_DB_PARITY_WAVE17_FULL_RECEIPT_SHA256)throw new Error("historical Wave17 receipt fingerprint drift");}
    if(hasWave19||hasWave20){const wave18Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave18Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_BYTES||sha256CanonicalText(wave18Receipts)!==OBJECT_DB_PARITY_WAVE18_FULL_RECEIPT_SHA256)throw new Error("historical Wave18 receipt fingerprint drift");}
    if(hasWave20||hasWave21||hasWave22){const wave19Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave19Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_BYTES||sha256CanonicalText(wave19Receipts)!==OBJECT_DB_PARITY_WAVE19_FULL_RECEIPT_SHA256)throw new Error("historical Wave19 receipt fingerprint drift");}
    if(hasWave26){const wave25Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE25_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave25Prefix,"utf8")!==OBJECT_DB_PARITY_WAVE25_PREFIX_BYTES||sha256CanonicalText(wave25Prefix)!==OBJECT_DB_PARITY_WAVE25_PREFIX_SHA256)throw new Error("historical Wave25 receipt fingerprint drift");}
    if(hasWave27){const wave26Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave26Prefix,"utf8")!==OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_BYTES||sha256CanonicalText(wave26Prefix)!==OBJECT_DB_PARITY_WAVE26_FULL_RECEIPT_SHA256)throw new Error("historical Wave26 receipt fingerprint drift");}
    if(hasWave29){const wave27Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave27Prefix,"utf8")!==OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_BYTES||sha256CanonicalText(wave27Prefix)!==OBJECT_DB_PARITY_WAVE27_FULL_RECEIPT_SHA256)throw new Error("historical Wave27 receipt fingerprint drift");}
    if(hasWave30){const wave29Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE29_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave29Prefix,"utf8")!==1_382_594||sha256CanonicalText(wave29Prefix)!=="5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373")throw new Error("historical Wave29 receipt fingerprint drift");}
    if(hasWave31){const wave30Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave30Prefix,"utf8")!==OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_BYTES||sha256CanonicalText(wave30Prefix)!==OBJECT_DB_PARITY_WAVE30_FULL_RECEIPT_SHA256)throw new Error("historical Wave30 receipt fingerprint drift");}
    if(hasWave32){const wave31Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave31Prefix,"utf8")!==OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_BYTES||sha256CanonicalText(wave31Prefix)!==OBJECT_DB_PARITY_WAVE31_FULL_RECEIPT_SHA256)throw new Error("historical Wave31 receipt fingerprint drift");}
    if(hasWave33){const wave32Prefix=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE32_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave32Prefix,"utf8")!==1_639_915||sha256CanonicalText(wave32Prefix)!=="59a43f463dd33b1945c7e5d16c7c9da632c2075bbad57852d1b1092da78b7bfb")throw new Error("historical Wave32 receipt fingerprint drift");}
    if(hasWave21||hasWave22){const wave20Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave20Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_BYTES||sha256CanonicalText(wave20Receipts)!==OBJECT_DB_PARITY_WAVE20_FULL_RECEIPT_SHA256)throw new Error("historical Wave20 receipt fingerprint drift");}
    if(hasWave22){const wave21Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave21Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_BYTES||sha256CanonicalText(wave21Receipts)!==OBJECT_DB_PARITY_WAVE21_FULL_RECEIPT_SHA256)throw new Error("historical Wave21 receipt fingerprint drift");}
    if(hasWave23){const wave22Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave22Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_BYTES||sha256CanonicalText(wave22Receipts)!==OBJECT_DB_PARITY_WAVE22_FULL_RECEIPT_SHA256)throw new Error("historical Wave22 receipt fingerprint drift");}
    if(hasWave24){const wave23Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave23Receipts,"utf8")!==OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_BYTES||sha256CanonicalText(wave23Receipts)!==OBJECT_DB_PARITY_WAVE23_FULL_RECEIPT_SHA256)throw new Error("historical Wave23 receipt fingerprint drift");}
    if(hasWave25){const wave24Receipts=JSON.stringify(value.receipts.slice(0,OBJECT_DB_PARITY_WAVE24_FULL_RECEIPT_COUNT));if(Buffer.byteLength(wave24Receipts,"utf8")!==988_846||sha256CanonicalText(wave24Receipts)!=="2287ae220032e0190d5fec91eadbe6c10d50acb0590f5f9ccba683a26f57820b")throw new Error("historical Wave24 receipt fingerprint drift");}
  }
  return value as unknown as ObjectDbConsumerExecutionReceiptBundle;
}

export function listObjectDbExecutableParityEvidencePaths(executionReceiptsText: string): string[] {
  const bundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(executionReceiptsText)));
  const paths = new Set<string>();
  for (const receipt of bundle.receipts) {
    for (const path of [receipt.harness?.path, receipt.fixture?.path, receipt.invocation?.targetPath]) {
      if (path === null || path === undefined) continue;
      if (typeof path !== "string" || path.length === 0) throw new Error("evidence path invalid");
      assertRepoRelativeEvidencePath(path, "evidence path");
      paths.add(path);
    }
  }
  return [...paths].sort();
}

function receiptFingerprint(receipt: ObjectDbConsumerExecutionReceipt): string {
  const { receiptSha256: _receiptSha256, ...payload } = receipt;
  return sha256CanonicalJson(payload);
}

function receiptBinding(receipt: ObjectDbConsumerExecutionReceipt): Record<string, string> {
  return {
    consumerId: receipt.consumerId,
    harnessId: receipt.harness.harnessId,
    harnessCaseId: receipt.harness.harnessCaseId,
    fixtureId: receipt.fixture.fixtureId,
    scenarioId: receipt.scenario.scenarioId,
    scenarioKind: receipt.scenario.scenarioKind,
  };
}

function normalizedDmlFingerprint(statements: string[], rowCount: number): string {
  return sha256CanonicalJson({ normalizedStatements: statements, rowCount });
}

function resolveEvidenceFile(path: string, expectedText: string): string {
  let cursor = process.cwd();
  for (;;) {
    const candidate = resolve(cursor, path);
    if (existsSync(candidate)) {
      if (sha256CanonicalText(readFileSync(candidate, "utf8")) !== sha256CanonicalText(expectedText)) throw new Error(`on-disk invocation source hash drift: ${path}`);
      return candidate;
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`allowlisted runner entrypoint is not present on disk: ${path}`);
}

function sha256Raw(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

let cachedGitRepositoryRoot:string|undefined;
function gitRepositoryRoot(): string {
  if(cachedGitRepositoryRoot===undefined)cachedGitRepositoryRoot=execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  return cachedGitRepositoryRoot;
}

type ReceiptMatrixBinding={receiptIds:string[];harnessPath:string|null;fixtureId:string|null;fixturePath:string|null;targetPath:string|null;exportName:string|null};
function receiptMatrixComplete(consumerId:string,requiredKinds:string[],receivedKinds:string[],binding?:ReceiptMatrixBinding):boolean{
  if(JSON.stringify(requiredKinds)===JSON.stringify(receivedKinds))return true;
  // Wave12 글자수 통계는 AUTH_DENIED를 고정 fixture의 risk cohort에서 실제 실행하고,
  // 정식 영수증 수는 공통 READ 5종으로 유지한다.
  if(consumerId in TRUSTED_WAVE12_CHARACTER_COUNT_READS&&JSON.stringify(requiredKinds)===JSON.stringify(["AUTH_DENIED","EXACT_OUTPUT","NEGATIVE_GUARD","READ_POSITIVE","RESTART_CONSISTENCY","SOURCE_DOMAIN_DML_ZERO"])&&JSON.stringify(receivedKinds)===JSON.stringify(["EXACT_OUTPUT","NEGATIVE_GUARD","READ_POSITIVE","RESTART_CONSISTENCY","SOURCE_DOMAIN_DML_ZERO"]))return true;
  // Wave31 관리자 목록의 NEGATIVE_GUARD는 검증된 동일 fixture에서 정확한 명령을 비관리자로 실행해 AUTH_DENIED까지 함께 증명합니다.
  const expectedReceiptIds=[...OBJECT_DB_PARITY_WAVE31_RECEIPT_IDS].filter(receiptId=>receiptId.startsWith(`receipt:wave31:${consumerId}:`)).sort();
  return consumerId==="legacy-d04b5224bde6be54"
    &&JSON.stringify(requiredKinds)===JSON.stringify(["AUTH_DENIED","EXACT_OUTPUT","NEGATIVE_GUARD","READ_POSITIVE","RESTART_CONSISTENCY","SOURCE_DOMAIN_DML_ZERO"])
    &&JSON.stringify(receivedKinds)===JSON.stringify(["EXACT_OUTPUT","NEGATIVE_GUARD","READ_POSITIVE","RESTART_CONSISTENCY","SOURCE_DOMAIN_DML_ZERO"])
    &&binding!==undefined
    &&JSON.stringify(binding.receiptIds)===JSON.stringify(expectedReceiptIds)
    &&binding.harnessPath===OBJECT_DB_PARITY_WAVE31_HARNESS_PATH
    &&binding.fixtureId===OBJECT_DB_PARITY_WAVE31_FIXTURE_ID
    &&binding.fixturePath===OBJECT_DB_PARITY_WAVE31_FIXTURE_PATH
    &&binding.targetPath===OBJECT_DB_PARITY_WAVE31_TARGET_PATH
    &&binding.exportName===OBJECT_DB_PARITY_WAVE31_EXPORT_NAME;
}

const commitBlobCache=new Map<string,string>();
function readCommitBlob(repositoryRoot: string, commit: string, path: string): string {
  const cacheKey=`${repositoryRoot}\0${commit}\0${path}`,cached=commitBlobCache.get(cacheKey);if(cached!==undefined)return cached;
  try {
    const blob=execFileSync("git", ["-c", "core.longpaths=true", "show", `${commit}:${path}`], { cwd: repositoryRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });commitBlobCache.set(cacheKey,blob);return blob;
  } catch {
    throw new Error(`evidenceCommit does not contain trusted input: ${path}`);
  }
}

const verifiedEvidenceCommits=new Set<string>();
const verifiedCommitAncestries=new Set<string>();
function assertCommitAncestor(repositoryRoot:string,ancestor:string,descendant:string,errorMessage:string):void{
  const cacheKey=`${repositoryRoot}\0${ancestor}\0${descendant}`;if(verifiedCommitAncestries.has(cacheKey))return;
  try{execFileSync("git",["merge-base","--is-ancestor",ancestor,descendant],{cwd:repositoryRoot,stdio:"ignore"});}catch{throw new Error(errorMessage);}
  verifiedCommitAncestries.add(cacheKey);
}
function assertEvidenceCommitAncestry(repositoryRoot: string, evidenceCommit: string): void {
  const cacheKey=`${repositoryRoot}\0${evidenceCommit}`;if(verifiedEvidenceCommits.has(cacheKey))return;
  try { execFileSync("git", ["cat-file", "-e", `${evidenceCommit}^{commit}`], { cwd: repositoryRoot, stdio: "ignore" }); }
  catch { throw new Error(`evidenceCommit does not exist: ${evidenceCommit}`); }
  try { execFileSync("git", ["merge-base", "--is-ancestor", evidenceCommit, "HEAD"], { cwd: repositoryRoot, stdio: "ignore" }); }
  catch { throw new Error(`evidenceCommit is not an ancestor of current HEAD: ${evidenceCommit}`); }
  verifiedEvidenceCommits.add(cacheKey);
}

export function assertTrustedWave1ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const trusted = TRUSTED_WAVE1_TITLE_READS[consumerId as keyof typeof TRUSTED_WAVE1_TITLE_READS];
  if (trusted === undefined) return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  const trustedConfig = consumer.trustedConfig as Record<string, unknown> | undefined;
  const input = consumer.input as Record<string, unknown> | undefined;
  const negativeInput = consumer.negativeInput as Record<string, unknown> | undefined;
  if (locator === undefined || trustedConfig === undefined || input === undefined || negativeInput === undefined) throw new Error(`${consumerId} trusted Wave1 locator/config/input missing`);
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  if (JSON.stringify(locator) !== JSON.stringify(exactLocator)) throw new Error(`${consumerId} exact manifest locator drift`);
  if (locator.symbol !== trusted.symbol || locator.triggerOrPredicate !== trusted.triggerOrPredicate || locator.interfaceId !== trusted.interfaceId) throw new Error(`${consumerId} trusted symbol/trigger/interface drift`);
  const exactTrustedConfig = { domain: trusted.domain, definitionTable: trusted.definitionTable, definitionId: trusted.definitionId, ownershipTable: trusted.ownershipTable, ownedId: trusted.ownedId, selectionTable: trusted.selectionTable };
  if (JSON.stringify(trustedConfig) !== JSON.stringify(exactTrustedConfig) || input.domain !== trusted.domain || negativeInput.domain !== trusted.domain || input.playerId !== "player01") throw new Error(`${consumerId} trusted domain/table/ID config drift`);
  const assertions = consumer.assertions as unknown;
  if (!Array.isArray(assertions) || JSON.stringify(assertions) !== JSON.stringify([trusted.ownershipTable, trusted.definitionTable, trusted.selectionTable, "owned.player_id=?", "owned.ownership_status='owned'", `ORDER BY owned.acquisition_sequence,owned.${trusted.ownedId}`])) throw new Error(`${consumerId} exact SQL semantics assertion drift`);
  const expectedSql = consumer.expectedNormalizedSql;
  for (const token of [trusted.ownershipTable, trusted.definitionTable, trusted.selectionTable, `definition_row.${trusted.definitionId}=owned.${trusted.definitionId}`, `selection_row.${trusted.ownedId}=owned.${trusted.ownedId}`, "owned.player_id=?", "owned.ownership_status='owned'", `ORDER BY owned.acquisition_sequence,owned.${trusted.ownedId}`]) if (typeof expectedSql !== "string" || !expectedSql.includes(token)) throw new Error(`${consumerId} exact normalized SQL/AST semantics drift`);
}

export function assertTrustedWave2ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const trusted = TRUSTED_WAVE2_COMPATIBILITY_READS[consumerId as keyof typeof TRUSTED_WAVE2_COMPATIBILITY_READS];
  if (trusted === undefined) return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  if (locator === undefined || consumer.consumerId !== consumerId) throw new Error(`${consumerId} trusted Wave2 source locator/consumer binding missing`);
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  if (JSON.stringify(locator) !== JSON.stringify(exactLocator)) throw new Error(`${consumerId} exact manifest locator drift`);
  if (locator.symbol !== trusted.symbol || locator.triggerOrPredicate !== trusted.triggerOrPredicate || locator.interfaceId !== trusted.interfaceId || consumer.method !== trusted.method) throw new Error(`${consumerId} trusted Wave2 method/symbol/trigger/interface drift`);
  if (JSON.stringify(consumer.input) !== JSON.stringify(trusted.input) || JSON.stringify(consumer.negativeInput) !== JSON.stringify(trusted.negativeInput) || JSON.stringify(consumer.expectedQueryValues) !== JSON.stringify(trusted.expectedQueryValues) || consumer.expectedGuardReason !== trusted.expectedGuardReason) throw new Error(`${consumerId} trusted Wave2 input/guard drift`);
  if (consumer.databaseRowShape !== "legacy-object-row" || !Array.isArray(consumer.mockRows) || consumer.mockRows.length !== 1) throw new Error(`${consumerId} trusted Wave2 database row contract drift`);
  const assertions = consumer.assertions;
  if (!Array.isArray(assertions) || JSON.stringify(assertions) !== JSON.stringify(["object_registry registry", "object_identity_crosswalks crosswalk", "crosswalk.source_system = 'LEGACY_DB'", "crosswalk.source_namespace = 'object_registry.id'"])) throw new Error(`${consumerId} exact SQL semantics assertion drift`);
  const expectedSql = consumer.expectedNormalizedSql;
  if (typeof expectedSql !== "string") throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  const sqlPrefix = "SELECT registry.id legacy_object_id,registry.object_key legacy_object_key,registry.object_type,crosswalk.object_identity_id FROM object_registry registry LEFT JOIN object_identity_crosswalks crosswalk ON crosswalk.source_system = 'LEGACY_DB' AND crosswalk.source_namespace = 'object_registry.id' AND crosswalk.source_identifier = CAST(registry.id AS CHAR) ";
  if (expectedSql !== sqlPrefix + trusted.sqlSuffix) throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  for (const token of assertions) if (typeof token !== "string" || !expectedSql.includes(token)) throw new Error(`${consumerId} exact normalized SQL semantics drift`);
  const expectedMock = [{ legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", canonicalObjectIdentityId: "objid001" }];
  const expectedRow = { status: "RESOLVED", canonicalObjectIdentityId: "objid001", legacyObjectId: "42", legacyObjectKey: "diamond-box", objectType: "ITEM", quarantineReason: null };
  if (JSON.stringify(consumer.mockRows) !== JSON.stringify(expectedMock) || JSON.stringify(consumer.expectedRow) !== JSON.stringify(expectedRow)) throw new Error(`${consumerId} trusted Wave2 result fixture drift`);
}

export function assertTrustedWave3ConsumerFixtureMapping(
  consumerId: string,
  consumer: Record<string, unknown>,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  if (consumerId !== "sql-repository-261eb97022941f77") return;
  const locator = consumer.sourceLocator as Record<string, unknown> | undefined;
  const exactLocator = { file: manifestConsumer.file, symbol: manifestConsumer.symbol, triggerOrPredicate: manifestConsumer.triggerOrPredicate, interfaceId: manifestConsumer.interfaceId, start: manifestConsumer.sourceSpan.start, end: manifestConsumer.sourceSpan.end, sha256: manifestConsumer.sourceSpan.sha256 };
  const input = consumer.input as Record<string, unknown> | undefined;
  const queryValues = consumer.expectedQueryValues as unknown[] | undefined;
  const mockRows = consumer.mockRows as Array<Record<string, unknown>> | undefined;
  if (input === undefined || queryValues === undefined || mockRows === undefined || input.targetKey !== queryValues[0] || input.targetKey !== mockRows[0]?.displayName) throw new Error(`${consumerId} trusted Wave3 lookup/row equality drift`);
  if (locator === undefined || JSON.stringify(locator) !== JSON.stringify(exactLocator) || consumer.consumerId !== consumerId || JSON.stringify(consumer.input) !== JSON.stringify({ targetKey: "대상유저" }) || JSON.stringify(consumer.negativeInput) !== JSON.stringify({ targetKey: "" }) || JSON.stringify(consumer.expectedQueryValues) !== JSON.stringify(["대상유저"]) || consumer.expectedGuardError !== "PLAYER_CONTEXT_TARGET_INVALID" || consumer.databaseRowShape !== "player-target-row") throw new Error(`${consumerId} trusted Wave3 fixture drift`);
  if (typeof consumer.expectedNormalizedSql !== "string" || sha256CanonicalText(consumer.expectedNormalizedSql) !== "40c9e38957fa73a1295859c7d8a3c096c8512b18b350c4797fed07fa86b68199" || JSON.stringify(consumer.mockRows) !== JSON.stringify([{ legacyPlayerId: "42", canonicalPlayerId: "player01", externalIdentityId: "7", displayName: "대상유저", rankEmoji: "🏆", providerCode: "kakao" }]) || JSON.stringify(consumer.expectedRow) !== JSON.stringify({ canonicalPlayerId: "player01", legacyPlayerId: "42", displayName: "대상유저", rankEmoji: "🏆" })) throw new Error(`${consumerId} trusted Wave3 SQL/result drift`);
}

export function assertTrustedWave4ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  if(consumerId!=="sql-repository-9cfe67ded7b1e5b0")return;const locator=consumer.sourceLocator as Record<string,unknown>|undefined, exact={file:manifestConsumer.file,symbol:manifestConsumer.symbol,triggerOrPredicate:manifestConsumer.triggerOrPredicate,interfaceId:manifestConsumer.interfaceId,start:manifestConsumer.sourceSpan.start,end:manifestConsumer.sourceSpan.end,sha256:manifestConsumer.sourceSpan.sha256};
  if(!locator||JSON.stringify(locator)!==JSON.stringify(exact)||consumer.consumerId!==consumerId||JSON.stringify(consumer.input)!==JSON.stringify({playerId:"player01"})||JSON.stringify(consumer.negativeInput)!==JSON.stringify({playerId:"bad"})||JSON.stringify(consumer.expectedQueryValues)!==JSON.stringify(["player01"])||consumer.expectedGuardError!=="OBJECT_IDENTITY_CANDIDATE_INVALID"||consumer.databaseRowShape!=="pet-title-read-row")throw new Error(`${consumerId} trusted Wave4 fixture drift`);
  if(typeof consumer.expectedNormalizedSql!=="string"||sha256CanonicalText(consumer.expectedNormalizedSql)!=="83af6c30c61dee95ab64902671809677d212f24720a430f7b64b919c95c564ab"||JSON.stringify(consumer.mockRows)!==JSON.stringify([{instanceId:"ownpet01",displayName:"펫 타이틀✨",acquisitionSequence:"1",acquiredAt:"2026-09-06 11:35:00",acquisitionPrice:"100000000",baseSalePrice:"400000000",equipped:true}])||JSON.stringify(consumer.expectedRow)!==JSON.stringify({instanceId:"ownpet01",displayName:"펫 타이틀✨",priceDigits:"100000000",acquiredAt:"2026-09-06 11:35:00",equipped:true}))throw new Error(`${consumerId} trusted Wave4 SQL/result drift`);
}

export function assertTrustedWave5ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  if(consumerId!=="sql-repository-13888c58966b6d56")return;const locator=consumer.sourceLocator as Record<string,unknown>|undefined,exact={file:manifestConsumer.file,symbol:manifestConsumer.symbol,triggerOrPredicate:manifestConsumer.triggerOrPredicate,interfaceId:manifestConsumer.interfaceId,start:manifestConsumer.sourceSpan.start,end:manifestConsumer.sourceSpan.end,sha256:manifestConsumer.sourceSpan.sha256};
  const input=consumer.input as Record<string,unknown>|undefined,queryValues=consumer.expectedQueryValues as unknown[]|undefined,mockRows=consumer.mockRows as Array<Record<string,unknown>>|undefined,expectedRow=consumer.expectedRow as Record<string,unknown>|undefined;if(!input||!queryValues||!mockRows||!expectedRow||input.playerId!==queryValues[0]||input.playerId!==mockRows[0]?.playerId||input.playerId!==expectedRow.playerId)throw new Error(`${consumerId} trusted Wave5 lookup/row equality drift`);
  if(!locator||JSON.stringify(locator)!==JSON.stringify(exact)||consumer.consumerId!==consumerId||JSON.stringify(consumer.input)!==JSON.stringify({playerId:"player01"})||JSON.stringify(consumer.negativeInput)!==JSON.stringify({playerId:"bad"})||JSON.stringify(consumer.expectedQueryValues)!==JSON.stringify(["player01"])||consumer.expectedGuardError!=="CANONICAL_FURNITURE_ID_INVALID"||consumer.databaseRowShape!=="placed-furniture-read-row")throw new Error(`${consumerId} trusted Wave5 fixture drift`);
  if(typeof consumer.expectedNormalizedSql!=="string"||sha256CanonicalText(consumer.expectedNormalizedSql)!=="ac7ac01398e26961966409cab77ef8987e8b4e4dd85152d52369e903965a3825"||JSON.stringify(consumer.mockRows)!==JSON.stringify([{ownedFurnitureId:"ownfur01",playerId:"player01",furnitureId:"furnit01",enhancementLevel:"2",baseCharm:"100",charmPerEnhancement:"20"}])||JSON.stringify(consumer.expectedRow)!==JSON.stringify({ownedFurnitureId:"ownfur01",playerId:"player01",furnitureId:"furnit01",enhancementLevel:"2",finalCharm:"140",ownershipStatus:"placed"}))throw new Error(`${consumerId} trusted Wave5 SQL/result drift`);
}

export function assertTrustedWave6ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  const trusted=consumerId==="sql-repository-7367fce7053551f3"?{input:{identityProviderCode:"kakao",externalUserId:"user-1",externalContextId:"room-1"},negative:{identityProviderCode:"unknown",externalUserId:"user-1",externalContextId:"room-1"},guard:"PLAYER_CONTEXT_PROVIDER_UNSUPPORTED",sql:["78f0fb1fcc4adeae026ebdbd9d5534613c1b2aa343e7643062a983c3d7ed1c4a","96b03ba1349efe09bd158509b6337de530dbdc6fa0a6ecc093d94bf82537b714"],values:[["kakao","user-1","KAKAO","room-1","user-1","ROOM","room-1"],["kakao","user-1"]],shapes:["player-context-row","player-context-row"],rows:"f076e71f80a819e60caf7fdf268b14a3c0e58ffd65734c7340daf636303cd275",results:"7ed8cb8ab4788e864680dc4bac24edeb483ac557a640f0ef58608aa3b6616967"}:consumerId==="sql-repository-3001ad9fc2f36d01"?{input:{providerCode:"kakao",externalUserId:"user-1"},negative:{providerCode:"",externalUserId:"user-1"},guard:"BAG_SHADOW_IDENTITY_INPUT_INVALID",sql:["5f0e15d00eaead00e73b4a7159205416eb77c0d3d28d816049406b90acc3157e","aa51085ad4ea85c9e296a4e078e3b8f04768cdaf7b8766e6ec05e9aa6740f3df","6f4fc469f1f068f84e45e6b71929bf8c07f03f183464f1305b5e2483c16e245d","31b40fd07562c85df23240bead76343d56f9cffc4db7caef52c24483ab4c918e"],values:[["kakao","user-1"],["42"],["player01"],["player01"]],shapes:["bag-identity-row","legacy-stack-row","canonical-stack-row","canonical-instance-row"],rows:"3dcbb6b230293165717a15304f9f31c46eb2b3d6557f87df532e3e617b90412f",results:"79b946aa4a8d2799a0bf714c3c29332136a6d85a713c17461b905dd2f10cf133"}:undefined;if(!trusted)return;
  const locator=consumer.sourceLocator as Record<string,unknown>|undefined,exact=consumerId==="sql-repository-3001ad9fc2f36d01"
    ?{file:"개발환경_고도화/runtime/src/inventory/bag-shadow-parity-provider.ts",symbol:"compare",triggerOrPredicate:"SQL_METHOD:compare",interfaceId:"item.repository.bag-shadow-parity-provider.compare",start:6618,end:16896,sha256:"b19de38cf45d65786fa679411313cf3249c159d685af0a4b6c64b4e565656144"}
    :{file:manifestConsumer.file,symbol:manifestConsumer.symbol,triggerOrPredicate:manifestConsumer.triggerOrPredicate,interfaceId:manifestConsumer.interfaceId,start:manifestConsumer.sourceSpan.start,end:manifestConsumer.sourceSpan.end,sha256:manifestConsumer.sourceSpan.sha256},queries=consumer.orderedQueries as Array<Record<string,unknown>>|undefined;
  if(!locator||JSON.stringify(locator)!==JSON.stringify(exact)||consumer.consumerId!==consumerId||JSON.stringify(consumer.input)!==JSON.stringify(trusted.input)||JSON.stringify(consumer.negativeInput)!==JSON.stringify(trusted.negative)||consumer.expectedGuardError!==trusted.guard||!queries||JSON.stringify(queries.map(query=>query.expectedQueryValues))!==JSON.stringify(trusted.values)||JSON.stringify(queries.map(query=>query.rowShape))!==JSON.stringify(trusted.shapes)||JSON.stringify(queries.map(query=>sha256CanonicalText(String(query.expectedNormalizedSql))))!==JSON.stringify(trusted.sql))throw new Error(`${consumerId} trusted Wave6 query contract drift`);
  if(sha256CanonicalJson(consumer.queryRowsByScenario)!==trusted.rows||sha256CanonicalJson(consumer.expectedResultsByScenario)!==trusted.results)throw new Error(`${consumerId} trusted Wave6 rows/result drift`);
}

const TRUSTED_WAVE7_SERVICE_CHAINS = {
  "runtime-dispatch-f53934feccdd6d39": { caseId:"case:point-shop-catalog-read-chain", executablePath:"app dispatch→PointShopCatalogIrisHandler.execute→PointShopCatalogService.read→MariaPointShopCatalogRepository.readSnapshot→ProcessIrisEventService.queueCommandReply", transactionPath:"handler queries→queueCommandReply:COMMIT", hash:"9dc208c27bb91e48b945d9e2ec02c7378925596f8e86a0f9fe2215840873c294" },
  "runtime-dispatch-f024a0ae45b58a2a": { caseId:"case:package-bag-chain", executablePath:"app dispatch→PackageIrisCommandHandler.execute→PackageCommandService.execute→CurrentPackageHubApplication.listBag→ProcessIrisEventService.queueCommandReply", transactionPath:"handler queries→queueCommandReply:COMMIT", hash:"e24fcd99de44ebb03cb333e979c66710320475344f801d2b48ff6fce0a4a4468" },
  "runtime-dispatch-e45c1c15e08c165a": { caseId:"case:package-wizard-guide-chain", executablePath:"app dispatch→PackageCatalogAddWizardIrisHandler.execute→PackageCatalogAddWizardService.execute→MariaDbPackageCatalogAddWizardRepository.findReplay→ProcessIrisEventService.queueCommandReply-or-replay", transactionPath:"handler queries→queueCommandReply:COMMIT-or-existing-outbox:READ_ONLY", hash:"eb9405fb683f88c81f3e02869dcc379d453e228dee52923512fcb54d0fc6082b" },
} as const;

const TRUSTED_WAVE8_ADMIN_CHAINS = {
  "admin-command-0ab0acb6f570d48c": { caseId: "case:admin-data-status-chain", hash: "cac09acdc41d47556ad9e40027ea588ae6b54751cf8c8389fa799e3c446ccfd9" },
  "admin-command-115e33dcf567dd08": { caseId: "case:admin-pet-owner-read-chain", hash: "3f0c4c334effe1e47c370853d3d860dae8cf6b405dfeb3e409ce098b179815ce" },
  "admin-command-3a76b9ad462b6143": { caseId: "case:admin-ring-read-chain", hash: "26e0bef9858e7669ae2b74b5ab1553580bf7481385d3546816775cdb36896d54" },
  "admin-command-5e04d0767d4c2abc": { caseId: "case:admin-server-stats-chain", hash: "9391a17bc77ac77f2ad1cfef3b4ec083e8b81d683c3cee15ebce0eaeca836b70" },
} as const;

const TRUSTED_WAVE9_RANK_CHAINS = {
  "runtime-dispatch-465e4b3a15c003dc": { caseId: "case:rank-cumulative-level", handlerKey: "player_cumulative_level_rank_read", hash: "7f6948ba6ac8e2b1f4eca371f2e259a81ceb32025d8df7b20f9b937ec8e96688" },
  "runtime-dispatch-9db5e3e6c256b5fa": { caseId: "case:rank-cumulative-like", handlerKey: "player_cumulative_like_rank_read", hash: "8e8cd8fba543bda40deef2ea3e5212889df6888be878a190dc7fa6631119382f" },
  "runtime-dispatch-eaa906ea249408a5": { caseId: "case:rank-overall", handlerKey: "player_overall_rank_read", hash: "506d7d682a722d8445f8f5f7331e8c9e23ef023299f2c67e6220b5206e97e6ff" },
  "runtime-dispatch-e02f58bf27070ab0": { caseId: "case:rank-home", handlerKey: "home_ranking_read", hash: "5c95f2908c08d9b65c34eb32322cbde6641a71b3c1ded7a7609869d995520794" },
  "runtime-dispatch-e54fc7fbded287c6": { caseId: "case:rank-furniture", handlerKey: "home_furniture_rank_read", hash: "ad7e480bfe3590a8cda356f32f8a80c599263e9be1844b88021e13778c3934ef" },
} as const;
const TRUSTED_WAVE9_HARNESS_SHA256="23e16bb8455e2a767e886a3903db7c649b1615ab8c09812b3380af189abe5674" as const;
const TRUSTED_WAVE9_TARGET_SHA256="c5d69c5190872c087bff8666163c97acc878d992d3c37e15d48138b21889c72d" as const;
export function assertTrustedWave9ExecutableHashes(harnessSha256:unknown,targetSha256:unknown):void{
  if(harnessSha256!==TRUSTED_WAVE9_HARNESS_SHA256||targetSha256!==TRUSTED_WAVE9_TARGET_SHA256)throw new Error("trusted Wave9 executable source hash drift");
}

const TRUSTED_WAVE10_PENDANT_READS={
  "runtime-dispatch-36d6721ade0707a6":{caseId:"case:pendant-market-info",handlerKey:"pendant_market_info",hash:"1db03bb735f6ba71c85f781d5dbf26bceb42dc44e8fee32bb24998b37ee5498c"},
  "runtime-dispatch-8c6c3c3d598fe078":{caseId:"case:pendant-info",handlerKey:"pendant_info_read",hash:"5776da6d93309dbb6f2f406fca0fcc9673387973d55cd9178ff5c66d5cc920df"},
  "runtime-dispatch-19076db78c2eefb9":{caseId:"case:pendant-probability",handlerKey:"pendant_probability_read",hash:"9c5f9328115f39454fbf92bf571bf09816db4e9697405414df4c4a413063892a"},
} as const;
const TRUSTED_WAVE10_HARNESS_SHA256="9a214f1f84fbc8f7b3fc87da8fa224e1255d6e82f8e2284aafc32a32ee319950" as const;
const TRUSTED_WAVE10_TARGET_SHA256="2d222b295baeac245e644b3ea06225e4cccdc8016a8c5ae2cf66c6b4cf90949b" as const;
export function assertTrustedWave10ExecutableHashes(harnessSha256:unknown,targetSha256:unknown):void{if(harnessSha256!==TRUSTED_WAVE10_HARNESS_SHA256||targetSha256!==TRUSTED_WAVE10_TARGET_SHA256)throw new Error("trusted Wave10 executable source hash drift");}
export function assertTrustedWave10ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{const trusted=TRUSTED_WAVE10_PENDANT_READS[consumerId as keyof typeof TRUSTED_WAVE10_PENDANT_READS];if(!trusted)return;const locator=consumer.sourceLocator;if(consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="15abb95203e7eb375c9f0bd4294a0ec7100aa1a6"||sha256CanonicalJson(consumer)!==trusted.hash||!isRecord(locator)||locator.file!==manifestConsumer.file||locator.symbol!==manifestConsumer.symbol||locator.triggerOrPredicate!==manifestConsumer.triggerOrPredicate||locator.interfaceId!==manifestConsumer.interfaceId||locator.catalogSourceSpanStatus!=="STALE_RELOCATED_AT_WAVE10"||locator.needle!==trusted.handlerKey)throw new Error(`${consumerId} trusted Wave10 pendant-read contract drift`);}

const TRUSTED_WAVE11_HOME_FURNITURE_READS={
  "runtime-dispatch-722afb15e9cbd92c":{caseId:"case:home-furniture-info",handlerKey:"home_furniture_info_read",hash:"c344dea1246bac130d821cbc14b80fd7734ff8fc28bae196e48a4ee0f3e120bc"},
  "runtime-dispatch-c3cb8d18613c2358":{caseId:"case:home-furniture-stats",handlerKey:"home_furniture_stats_read",hash:"16d5938c10e749bb513930b6275b3260a0aa1382d0dea98f8bd13af7ab698f46"},
} as const;
const TRUSTED_WAVE11_HARNESS_SHA256="6e8ba3bc5494b1ab7592d9846f744698cd6f23a1916e138a4ac0e8eedca21dd0" as const;
const TRUSTED_WAVE11_TARGET_SHA256="65ba70e72501216e9390fbe0f2e1ac16f93140cce77f950dc46e3b5ee527e5d2" as const;
export function assertTrustedWave11ExecutableHashes(harnessSha256:unknown,targetSha256:unknown):void{if(harnessSha256!==TRUSTED_WAVE11_HARNESS_SHA256||targetSha256!==TRUSTED_WAVE11_TARGET_SHA256)throw new Error("trusted Wave11 executable source hash drift");}
export function assertTrustedWave11ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{const trusted=TRUSTED_WAVE11_HOME_FURNITURE_READS[consumerId as keyof typeof TRUSTED_WAVE11_HOME_FURNITURE_READS];if(!trusted)return;const locator=consumer.sourceLocator;if(consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="4ce4fd91a001abf2a16f5fe8b3a7098321e733f7"||sha256CanonicalJson(consumer)!==trusted.hash||!isRecord(locator)||locator.file!==manifestConsumer.file||locator.symbol!==manifestConsumer.symbol||locator.triggerOrPredicate!==manifestConsumer.triggerOrPredicate||locator.interfaceId!==manifestConsumer.interfaceId||locator.catalogSourceSpanStatus!=="STALE_RELOCATED_AT_WAVE11"||locator.needle!==trusted.handlerKey)throw new Error(`${consumerId} trusted Wave11 home-furniture-read contract drift`);}

const TRUSTED_WAVE12_CHARACTER_COUNT_READS={
  "admin-command-96dcd3753578c56c":{caseId:"case:admin-character-count",handlerKey:"isCharacterCountStatsCommand(message)",hash:"b29178fc96f54e6dfe3d7d00342ecf0eb7baccdd716021f0b9b022c4eac10973"},
} as const;
const TRUSTED_WAVE12_HARNESS_SHA256="f0cbc4100804f2ca42ab362d89ffa739f891c2f5c4585d4410bd1e028e28a6a6" as const;
const TRUSTED_WAVE12_TARGET_SHA256="bbe35b407e0d65be6fb9314a341e7708c1227d2fc4f08848c0eddf4b5f8f00d1" as const;
export function assertTrustedWave12ExecutableHashes(harnessSha256:unknown,targetSha256:unknown):void{if(harnessSha256!==TRUSTED_WAVE12_HARNESS_SHA256||targetSha256!==TRUSTED_WAVE12_TARGET_SHA256)throw new Error("trusted Wave12 executable source hash drift");}
export function assertTrustedWave12ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{const trusted=TRUSTED_WAVE12_CHARACTER_COUNT_READS[consumerId as keyof typeof TRUSTED_WAVE12_CHARACTER_COUNT_READS];if(!trusted)return;const locator=consumer.sourceLocator;if(consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="d4169e0447de5d862f03fdd13654029c5e298fca"||sha256CanonicalJson(consumer)!==trusted.hash||!isRecord(locator)||locator.file!==manifestConsumer.file||locator.symbol!==manifestConsumer.symbol||locator.triggerOrPredicate!==manifestConsumer.triggerOrPredicate||locator.interfaceId!==manifestConsumer.interfaceId||locator.catalogSourceSpanStatus!=="STALE_RELOCATED_AT_WAVE12"||locator.needle!==trusted.handlerKey)throw new Error(`${consumerId} trusted Wave12 character-count contract drift`);}

const TRUSTED_WAVE13_SERVER_STATS_READS={"admin-command-5e04d0767d4c2abc":{caseId:"case:admin-server-stats-corrective",hash:"a47fe65ae55fc6c144e02ce996dd546e204668ba1b3b794431574fe63c42fa2d"}}as const;
const TRUSTED_WAVE13_HARNESS_SHA256="2cbf47acf342fcf7e09e3f796717ffc045744d8c9adbe40abe19fadc5f39bb11"as const,TRUSTED_WAVE13_TARGET_SHA256="fd304562a2c97b4a02b25de065920ddf62fcf4616169f40fbd81d6f7b8fb50f6"as const;

export function assertTrustedWave9ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  const trusted=TRUSTED_WAVE9_RANK_CHAINS[consumerId as keyof typeof TRUSTED_WAVE9_RANK_CHAINS];
  if(!trusted)return;
  const locator=consumer.sourceLocator;
  if(consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="15abb95203e7eb375c9f0bd4294a0ec7100aa1a6"||sha256CanonicalJson(consumer)!==trusted.hash||!isRecord(locator)||locator.file!==manifestConsumer.file||locator.symbol!==manifestConsumer.symbol||locator.triggerOrPredicate!==manifestConsumer.triggerOrPredicate||locator.interfaceId!==manifestConsumer.interfaceId||locator.catalogSourceSpanStatus!=="STALE_RELOCATED_AT_WAVE9"||locator.needle!==trusted.handlerKey)throw new Error(`${consumerId} trusted Wave9 rank-chain contract drift`);
}

export function assertTrustedWave8ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  const trusted=TRUSTED_WAVE8_ADMIN_CHAINS[consumerId as keyof typeof TRUSTED_WAVE8_ADMIN_CHAINS];if(!trusted)return;
  const locator=consumer.sourceLocator as Record<string,unknown>|undefined;
  const logicalLocatorMatches=locator!==undefined&&locator.file===manifestConsumer.file&&locator.symbol===manifestConsumer.symbol
    &&locator.triggerOrPredicate===manifestConsumer.triggerOrPredicate&&locator.interfaceId===manifestConsumer.interfaceId;
  const required=["READ_POSITIVE","NEGATIVE_GUARD","AUTH_DENIED","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"];
  if(!logicalLocatorMatches||consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="15abb95203e7eb375c9f0bd4294a0ec7100aa1a6"||sha256CanonicalJson(consumer)!==trusted.hash)throw new Error(`${consumerId} trusted Wave8 admin-chain contract drift`);
  if(!Array.isArray(consumer.chainLocators)||!isRecord(consumer.queryPlanByScenario)||!isRecord(consumer.mutationPlanByScenario)||!isRecord(consumer.expectedResultsByScenario)||!isRecord(consumer.scenarioInputsByScenario))throw new Error(`${consumerId} trusted Wave8 plan missing`);
  for(const scenario of required)if(!Array.isArray(consumer.queryPlanByScenario[scenario])||!Array.isArray(consumer.mutationPlanByScenario[scenario])||typeof consumer.expectedResultsByScenario[scenario]!=="string"||!isRecord(consumer.scenarioInputsByScenario[scenario]))throw new Error(`${consumerId} trusted Wave8 scenario plan drift`);
}

export function assertTrustedWave7ConsumerFixtureMapping(consumerId:string,consumer:Record<string,unknown>,manifestConsumer:ConsumerManifestInput["consumers"][number]):void{
  const trusted=TRUSTED_WAVE7_SERVICE_CHAINS[consumerId as keyof typeof TRUSTED_WAVE7_SERVICE_CHAINS];
  if(!trusted)return;
  const locator=consumer.sourceLocator as Record<string,unknown>|undefined;
  const logicalLocatorMatches=locator!==undefined&&locator.file===manifestConsumer.file&&locator.symbol===manifestConsumer.symbol
    &&locator.triggerOrPredicate===manifestConsumer.triggerOrPredicate&&locator.interfaceId===manifestConsumer.interfaceId
    &&locator.sha256===manifestConsumer.sourceSpan.sha256;
  if(!logicalLocatorMatches||consumer.consumerId!==consumerId||consumer.frozenSourceCommit!=="3e5cbd48ba94f23277adbb2327fab6c93c6a25b9"||sha256CanonicalJson(consumer)!==trusted.hash)throw new Error(`${consumerId} trusted Wave7 service-chain contract drift`);
}

function assertTrustedWave1FixtureBinding(
  receipt: ObjectDbConsumerExecutionReceipt,
  fixtureText: string,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
  repositoryRoot: string,
  bundleEvidenceCommit: string,
): void {
  const receiptWave=/^receipt:(wave\d+):/.exec(receipt.receiptId)?.[1];
  const evidenceCommit=receiptWave===undefined?bundleEvidenceCommit:(OBJECT_DB_PARITY_HISTORICAL_EVIDENCE_COMMITS[receiptWave]??bundleEvidenceCommit);
  try{execFileSync("git",["merge-base","--is-ancestor",evidenceCommit,bundleEvidenceCommit],{cwd:repositoryRoot,stdio:"ignore"});}catch{throw new Error(`${receipt.receiptId} historical evidence commit is not bundle evidence ancestor`);}
  const trusted = TRUSTED_WAVE1_TITLE_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE1_TITLE_READS];
  if (trusted === undefined) {
    const wave2 = TRUSTED_WAVE2_COMPATIBILITY_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE2_COMPATIBILITY_READS];
    if (wave2 === undefined) {
      const wave13=receiptWave==="wave13"?TRUSTED_WAVE13_SERVER_STATS_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE13_SERVER_STATS_READS]:undefined;
      if(wave13!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE13_SERVER_STATS_TARGET_PATH||receipt.invocation.exportName!=="executeWave13ServerStats"||receipt.harness.sourceSha256!==TRUSTED_WAVE13_HARNESS_SHA256||receipt.invocation.targetSourceSha256!==TRUSTED_WAVE13_TARGET_SHA256)throw new Error(`${receipt.receiptId} trusted Wave13 executable binding drift`);
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText))as{payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}},parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave13.caseId||parityCase.executablePath!=="buildApp().inject Iris HTTP event→token→normalize→operational channel→ProcessIrisEventService inbox→partial dispatch→production server-stats service→outbox delivery callback"||parityCase.transactionPath!=="actual ProcessIrisEventService and ServerStatsService transactions; callback stub only; external sender/network excluded"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(["READ_POSITIVE","NEGATIVE_GUARD","AUTH_DENIED","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"])||!consumer||sha256CanonicalJson(consumer)!==wave13.hash)throw new Error(`${receipt.receiptId} trusted Wave13 corrective contract drift`);
        for(const item of[consumer.sourceLocator,...(consumer.chainLocators as Array<Record<string,unknown>>),consumer.serviceCallsite]){if(!isRecord(item)||typeof item.file!=="string"||typeof item.start!=="number"||typeof item.end!=="number"||typeof item.sha256!=="string"||typeof item.needle!=="string")throw new Error(`${receipt.receiptId} trusted Wave13 source locator drift`);const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,item.file)),span=blob.slice(item.start,item.end);if(sha256CanonicalText(span)!==item.sha256||!span.includes(item.needle))throw new Error(`${receipt.receiptId} Wave13 source span drift`);}
        return;
      }
      const wave12=TRUSTED_WAVE12_CHARACTER_COUNT_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE12_CHARACTER_COUNT_READS];
      if(wave12!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE12_CHARACTER_COUNT_TARGET_PATH||receipt.invocation.exportName!=="executeWave12CharacterCount")throw new Error(`${receipt.receiptId} trusted Wave12 invocation target drift`);
        try{assertTrustedWave12ExecutableHashes(receipt.harness.sourceSha256,receipt.invocation.targetSourceSha256);}catch{throw new Error(`${receipt.receiptId} trusted Wave12 executable source hash drift`);}
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave12.caseId||parityCase.executablePath!=="buildApp().inject Iris HTTP event→token→normalize→operational channel→ProcessIrisEventService inbox→partial dispatch→production character-count service→outbox delivery callback"||parityCase.transactionPath!=="actual ProcessIrisEventService and CharacterCountStatsService transactions; callback stub only; external sender/network excluded"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"])||!consumer)throw new Error(`${receipt.receiptId} trusted Wave12 case/path binding drift`);
        assertTrustedWave12ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const locator=consumer.sourceLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>,service=consumer.serviceCallsite as Record<string,unknown>;
        for(const item of [locator,...(Array.isArray(chains)?chains:[]),service]){if(!isRecord(item)||typeof item.file!=="string"||typeof item.start!=="number"||typeof item.end!=="number"||typeof item.sha256!=="string"||typeof item.needle!=="string")throw new Error(`${receipt.receiptId} trusted Wave12 source locator drift`);const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,item.file)),span=blob.slice(item.start,item.end);if(sha256CanonicalText(span)!==item.sha256||!span.includes(item.needle))throw new Error(`${receipt.receiptId} Wave12 source span drift`);}
        return;
      }
      const wave11=TRUSTED_WAVE11_HOME_FURNITURE_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE11_HOME_FURNITURE_READS];
      if(wave11!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE11_HOME_FURNITURE_READ_TARGET_PATH||receipt.invocation.exportName!=="executeWave11HomeFurnitureRead")throw new Error(`${receipt.receiptId} trusted Wave11 invocation target drift`);
        try{assertTrustedWave11ExecutableHashes(receipt.harness.sourceSha256,receipt.invocation.targetSourceSha256);}catch{throw new Error(`${receipt.receiptId} trusted Wave11 executable source hash drift`);}
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave11.caseId||parityCase.executablePath!=="buildApp().inject Iris HTTP event→token→normalize→operational channel→ProcessIrisEventService inbox→partial dispatch→production home furniture read service→outbox delivery callback"||parityCase.transactionPath!=="actual ProcessIrisEventService, home furniture read service and recordOutboxDelivery transactions; callback stub only; external sender/network excluded"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"])||!consumer)throw new Error(`${receipt.receiptId} trusted Wave11 case/path binding drift`);
        assertTrustedWave11ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const locator=consumer.sourceLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>;
        if(!isRecord(locator)||typeof locator.start!=="number"||typeof locator.end!=="number"||typeof locator.sha256!=="string"||locator.needle!==wave11.handlerKey)throw new Error(`${receipt.receiptId} trusted Wave11 relocated source mapping drift`);
        const appBlob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string)),appSpan=appBlob.slice(locator.start as number,locator.end as number);if(sha256CanonicalText(appSpan)!==locator.sha256||!appSpan.includes(wave11.handlerKey))throw new Error(`${receipt.receiptId} trusted Wave11 app branch span drift`);
        if(!Array.isArray(chains))throw new Error(`${receipt.receiptId} trusted Wave11 chain locator drift`);for(const chain of chains){if(!isRecord(chain)||typeof chain.file!=="string"||typeof chain.start!=="number"||typeof chain.end!=="number"||typeof chain.sha256!=="string"||typeof chain.needle!=="string")throw new Error(`${receipt.receiptId} trusted Wave11 chain locator drift`);const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,chain.file)),span=blob.slice(chain.start,chain.end);if(sha256CanonicalText(span)!==chain.sha256||!span.includes(chain.needle))throw new Error(`${receipt.receiptId} Wave11 downstream chain span drift`);}
        return;
      }
      const wave10=TRUSTED_WAVE10_PENDANT_READS[receipt.consumerId as keyof typeof TRUSTED_WAVE10_PENDANT_READS];
      if(wave10!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE10_PENDANT_READ_TARGET_PATH||receipt.invocation.exportName!=="executeWave10PendantRead")throw new Error(`${receipt.receiptId} trusted Wave10 invocation target drift`);
        try{assertTrustedWave10ExecutableHashes(receipt.harness.sourceSha256,receipt.invocation.targetSourceSha256);}catch{throw new Error(`${receipt.receiptId} trusted Wave10 executable source hash drift`);}
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave10.caseId||parityCase.executablePath!=="buildApp().inject Iris HTTP event→token→normalize→operational channel→ProcessIrisEventService inbox→partial dispatch→production pendant read service→outbox delivery callback"||parityCase.transactionPath!=="actual ProcessIrisEventService, pendant read service and recordOutboxDelivery transactions; callback stub only; external sender/network excluded"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"])||!consumer)throw new Error(`${receipt.receiptId} trusted Wave10 case/path binding drift`);
        assertTrustedWave10ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const locator=consumer.sourceLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>;
        if(!isRecord(locator)||typeof locator.start!=="number"||typeof locator.end!=="number"||typeof locator.sha256!=="string"||locator.needle!==wave10.handlerKey)throw new Error(`${receipt.receiptId} trusted Wave10 relocated source mapping drift`);
        const appBlob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string)),appSpan=appBlob.slice(locator.start as number,locator.end as number);if(sha256CanonicalText(appSpan)!==locator.sha256||!appSpan.includes(wave10.handlerKey))throw new Error(`${receipt.receiptId} trusted Wave10 app branch span drift`);
        if(!Array.isArray(chains))throw new Error(`${receipt.receiptId} trusted Wave10 chain locator drift`);for(const chain of chains){if(!isRecord(chain)||typeof chain.file!=="string"||typeof chain.start!=="number"||typeof chain.end!=="number"||typeof chain.sha256!=="string"||typeof chain.needle!=="string")throw new Error(`${receipt.receiptId} trusted Wave10 chain locator drift`);const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,chain.file)),span=blob.slice(chain.start,chain.end);if(sha256CanonicalText(span)!==chain.sha256||!span.includes(chain.needle))throw new Error(`${receipt.receiptId} Wave10 downstream chain span drift`);}
        return;
      }
      const wave9=TRUSTED_WAVE9_RANK_CHAINS[receipt.consumerId as keyof typeof TRUSTED_WAVE9_RANK_CHAINS];
      if(wave9!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE9_RANK_CHAIN_TARGET_PATH||receipt.invocation.exportName!=="executeWave9RankChain")throw new Error(`${receipt.receiptId} trusted Wave9 invocation target drift`);
        try{assertTrustedWave9ExecutableHashes(receipt.harness.sourceSha256,receipt.invocation.targetSourceSha256);}catch{throw new Error(`${receipt.receiptId} trusted Wave9 executable source hash drift`);}
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave9.caseId||parityCase.executablePath!=="Iris event callback→partial dispatch→CommandDispatcher→exact guard→production rank service transaction"||parityCase.transactionPath!=="actual rank service transaction; external sender/network excluded"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"])||!consumer)throw new Error(`${receipt.receiptId} trusted Wave9 case/path binding drift`);
        assertTrustedWave9ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const locator=consumer.sourceLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>;
        if(!isRecord(locator)||locator.file!==manifestConsumer.file||locator.symbol!==manifestConsumer.symbol||locator.triggerOrPredicate!==manifestConsumer.triggerOrPredicate||locator.interfaceId!==manifestConsumer.interfaceId||locator.catalogSourceSpanSha256!==manifestConsumer.sourceSpan.sha256||locator.catalogSourceSpanStatus!=="STALE_RELOCATED_AT_WAVE9"||typeof locator.start!=="number"||typeof locator.end!=="number"||typeof locator.sha256!=="string"||locator.needle!==wave9.handlerKey)throw new Error(`${receipt.receiptId} trusted Wave9 relocated source mapping drift`);
        const appBlob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string)),appSpan=appBlob.slice(locator.start as number,locator.end as number);
        if(sha256CanonicalText(appSpan)!==locator.sha256||!appSpan.includes(wave9.handlerKey))throw new Error(`${receipt.receiptId} trusted Wave9 app branch span drift`);
        if(!Array.isArray(chains)||!chains.every(chain=>isRecord(chain)&&typeof chain.file==="string"&&typeof chain.start==="number"&&typeof chain.end==="number"&&typeof chain.sha256==="string"&&typeof chain.needle==="string"))throw new Error(`${receipt.receiptId} trusted Wave9 chain locator drift`);
        for(const chain of chains){const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,chain.file as string)),span=blob.slice(chain.start as number,chain.end as number);if(sha256CanonicalText(span)!==chain.sha256||!span.includes(chain.needle as string))throw new Error(`${receipt.receiptId} Wave9 downstream chain span drift`);}
        return;
      }
      const wave8=TRUSTED_WAVE8_ADMIN_CHAINS[receipt.consumerId as keyof typeof TRUSTED_WAVE8_ADMIN_CHAINS];
      if(wave8!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE8_ADMIN_CHAIN_TARGET_PATH||receipt.invocation.exportName!=="executeWave8AdminChain")throw new Error(`${receipt.receiptId} trusted Wave8 invocation target drift`);
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;requiredScenarios?:unknown;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave8.caseId||parityCase.executablePath!==`IrisAdminCommandService.changePlayerPoint→${manifestConsumer.symbol}→actual service/repository`||parityCase.transactionPath!=="actual admin dispatch + service transaction"||JSON.stringify(parityCase.requiredScenarios)!==JSON.stringify(OBJECT_DB_PARITY_READ_SCENARIOS.filter(kind=>kind!=="WRONG_ROOM_REJECTED"))||!consumer)throw new Error(`${receipt.receiptId} trusted Wave8 case/path binding drift`);
        assertTrustedWave8ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const frozenCommit=consumer.frozenSourceCommit as string,locator=consumer.sourceLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>;
        try{execFileSync("git",["merge-base","--is-ancestor",frozenCommit,evidenceCommit],{cwd:repositoryRoot,stdio:"ignore"});}catch{throw new Error(`${receipt.receiptId} frozen source commit is not evidence ancestor`);}
        const frozenBlob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,frozenCommit,locator.file as string));if(sha256CanonicalText(frozenBlob.slice(locator.start as number,locator.end as number))!==locator.sha256)throw new Error(`${receipt.receiptId} frozen admin dispatch span hash drift`);
        for(const chain of chains){const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,chain.file as string)),span=blob.slice(chain.start as number,chain.end as number);if(sha256CanonicalText(span)!==chain.sha256||typeof chain.needle!=="string"||!span.includes(chain.needle))throw new Error(`${receipt.receiptId} Wave8 downstream chain span drift`);}
        return;
      }
      const wave7=TRUSTED_WAVE7_SERVICE_CHAINS[receipt.consumerId as keyof typeof TRUSTED_WAVE7_SERVICE_CHAINS];
      if(wave7!==undefined){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE7_SERVICE_CHAIN_TARGET_PATH||receipt.invocation.exportName!=="executeWave7ServiceChain")throw new Error(`${receipt.receiptId} trusted Wave7 invocation target drift`);
        const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;consumers?:Array<Record<string,unknown>>}>}};
        const parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);
        if(parityCase?.caseId!==wave7.caseId||parityCase.executablePath!==wave7.executablePath||parityCase.transactionPath!==wave7.transactionPath||!consumer)throw new Error(`${receipt.receiptId} trusted Wave7 case/path binding drift`);
        assertTrustedWave7ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);
        const frozenCommit=consumer.frozenSourceCommit as string,locator=consumer.sourceLocator as Record<string,unknown>,current=consumer.currentDispatchLocator as Record<string,unknown>,chains=consumer.chainLocators as Array<Record<string,unknown>>;
        try{execFileSync("git",["merge-base","--is-ancestor",frozenCommit,evidenceCommit],{cwd:repositoryRoot,stdio:"ignore"});}catch{throw new Error(`${receipt.receiptId} frozen source commit is not evidence ancestor`);}
        const frozenBlob=readCommitBlob(repositoryRoot,frozenCommit,locator.file as string);
        if(sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(frozenBlob).slice(locator.start as number,locator.end as number))!==locator.sha256)throw new Error(`${receipt.receiptId} frozen dispatch span hash drift`);
        const currentBlob=readCommitBlob(repositoryRoot,evidenceCommit,current.file as string);
        if(sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(currentBlob).slice(current.start as number,current.end as number))!==current.sha256||current.sha256!==locator.sha256)throw new Error(`${receipt.receiptId} current dispatch span hash drift`);
        for(const chain of chains){const blob=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,chain.file as string)),span=blob.slice(chain.start as number,chain.end as number);if(sha256CanonicalText(span)!==chain.sha256||typeof chain.needle!=="string"||!span.includes(chain.needle))throw new Error(`${receipt.receiptId} downstream service-chain span drift`);}
        return;
      }
      if(receipt.consumerId==="sql-repository-7367fce7053551f3"||receipt.consumerId==="sql-repository-3001ad9fc2f36d01"){
        const expectedExport=receipt.consumerId==="sql-repository-7367fce7053551f3"?"executeWave6ResolveSelf":"executeWave6BagCompare",expectedCase=receipt.consumerId==="sql-repository-7367fce7053551f3"?"MariaPlayerContextProvider.resolveSelf":"BagShadowParityProvider.compare";if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE6_MULTI_QUERY_TARGET_PATH||receipt.invocation.exportName!==expectedExport)throw new Error(`${receipt.receiptId} trusted Wave6 invocation target drift`);const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;consumers?:Array<Record<string,unknown>>}>}},parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);if(parityCase?.executablePath!==expectedCase||parityCase.transactionPath!=="DatabaseClient.query:READ_ONLY"||!consumer)throw new Error(`${receipt.receiptId} trusted Wave6 case/path binding drift`);assertTrustedWave6ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);const locator=consumer.sourceLocator as Record<string,unknown>,sourceBlob=readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string);if(sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number,locator.end as number))!==locator.sha256)throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);return;
      }
      if(receipt.consumerId==="sql-repository-13888c58966b6d56"){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE5_PLACED_FURNITURE_TARGET_PATH||receipt.invocation.exportName!=="executeWave5PlacedFurnitureRead")throw new Error(`${receipt.receiptId} trusted Wave5 invocation target drift`);const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;consumers?:Array<Record<string,unknown>>}>}},parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(candidate=>candidate.consumerId===receipt.consumerId);if(parityCase?.executablePath!=="MariaCanonicalFurnitureHomeRepository.listPlacedFurniture"||parityCase.transactionPath!=="DatabaseClient.query:READ_ONLY"||!consumer)throw new Error(`${receipt.receiptId} trusted Wave5 case/path binding drift`);assertTrustedWave5ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);const locator=consumer.sourceLocator as Record<string,unknown>,sourceBlob=readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string);if(sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number,locator.end as number))!==locator.sha256)throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);return;
      }
      if(receipt.consumerId==="sql-repository-9cfe67ded7b1e5b0"){
        if(receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE4_PET_TITLE_TARGET_PATH||receipt.invocation.exportName!=="executeWave4PetTitleRead")throw new Error(`${receipt.receiptId} trusted Wave4 invocation target drift`);const fixture=JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as {payload?:{cases?:Array<{caseId?:string;executablePath?:string;transactionPath?:string;consumers?:Array<Record<string,unknown>>}>}},parityCase=fixture.payload?.cases?.find(({caseId})=>caseId===receipt.harness.harnessCaseId),consumer=parityCase?.consumers?.find(x=>x.consumerId===receipt.consumerId);if(parityCase?.executablePath!=="PetTitleCanonicalReadProvider.listOwned"||parityCase.transactionPath!=="DatabaseClient.query:READ_ONLY"||!consumer)throw new Error(`${receipt.receiptId} trusted Wave4 case/path binding drift`);assertTrustedWave4ConsumerFixtureMapping(receipt.consumerId,consumer,manifestConsumer);const locator=consumer.sourceLocator as Record<string,unknown>,sourceBlob=readCommitBlob(repositoryRoot,evidenceCommit,locator.file as string);if(sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number,locator.end as number))!==locator.sha256)throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);return;
      }
      if (receipt.consumerId !== "sql-repository-261eb97022941f77") return;
      if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE3_PLAYER_TARGET_PATH || receipt.invocation.exportName !== "executeWave3PlayerTarget") throw new Error(`${receipt.receiptId} trusted Wave3 invocation target drift`);
      const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
      const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
      const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
      if (parityCase?.executablePath !== "MariaPlayerContextProvider.resolveUniqueLegacyDisplayTarget" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave3 case/path binding drift`);
      const locator = consumer.sourceLocator as Record<string, unknown>;
      assertTrustedWave3ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
      const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
      if (sha256CanonicalText(canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number, locator.end as number)) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
      return;
    }
    if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE2_COMPATIBILITY_TARGET_PATH || receipt.invocation.exportName !== "executeWave2CompatibilityResolver") throw new Error(`${receipt.receiptId} trusted Wave2 invocation target drift`);
    const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
    const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
    const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
    if (parityCase?.executablePath !== "ObjectCatalogCompatibilityResolver" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave2 case/path binding drift`);
    assertTrustedWave2ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
    const locator = consumer.sourceLocator as Record<string, unknown>;
    const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
    const sourceSpan = canonicalizeObjectDbConsumerSourceText(sourceBlob).slice(locator.start as number, locator.end as number);
    if (sha256CanonicalText(sourceSpan) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
    return;
  }
  if (receipt.invocation.targetPath !== OBJECT_DB_PARITY_WAVE1_TITLE_TARGET_PATH || receipt.invocation.exportName !== "executeWave1TitleListOwned") throw new Error(`${receipt.receiptId} trusted Wave1 invocation target drift`);
  const fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)) as { payload?: { cases?: Array<{ caseId?: string; executablePath?: string; transactionPath?: string; consumers?: Array<Record<string, unknown>> }> } };
  const parityCase = fixture.payload?.cases?.find(({ caseId }) => caseId === receipt.harness.harnessCaseId);
  const consumer = parityCase?.consumers?.find((candidate) => candidate.consumerId === receipt.consumerId);
  if (parityCase?.executablePath !== "MariaCanonicalTitleRepository.listOwned" || parityCase.transactionPath !== "DatabaseClient.query:READ_ONLY" || consumer === undefined) throw new Error(`${receipt.receiptId} trusted Wave1 case/path binding drift`);
  assertTrustedWave1ConsumerFixtureMapping(receipt.consumerId, consumer, manifestConsumer);
  const locator = consumer.sourceLocator as Record<string, unknown>;
  const sourceBlob = readCommitBlob(repositoryRoot, evidenceCommit, locator.file as string);
  const normalizedSource = canonicalizeObjectDbConsumerSourceText(sourceBlob);
  const sourceSpan = normalizedSource.slice(locator.start as number, locator.end as number);
  if (sha256CanonicalText(sourceSpan) !== locator.sha256) throw new Error(`${receipt.receiptId} evidenceCommit source span hash drift`);
}

function assertReceiptGitProvenance(
  receipt: ObjectDbConsumerExecutionReceipt,
  evidenceCommit: string,
  manifestConsumer: ConsumerManifestInput["consumers"][number],
): void {
  const repositoryRoot = gitRepositoryRoot();
  assertEvidenceCommitAncestry(repositoryRoot, evidenceCommit);
  const receiptWave=/^receipt:(wave\d+):/.exec(receipt.receiptId)?.[1];
  const receiptEvidenceCommit=receiptWave===undefined?evidenceCommit:(OBJECT_DB_PARITY_HISTORICAL_EVIDENCE_COMMITS[receiptWave]??evidenceCommit);
  assertCommitAncestor(repositoryRoot,receiptEvidenceCommit,evidenceCommit,`${receipt.receiptId} historical evidence commit is not bundle evidence ancestor`);
  if(/^receipt:wave(?:[1-9]|10|11):/.test(receipt.receiptId)){
    const pinnedBundle=JSON.parse(readCommitBlob(repositoryRoot,OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_ROOT_COMMIT,OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PATH)) as ObjectDbConsumerExecutionReceiptBundle;
    const compactPrefix=JSON.stringify(pinnedBundle.receipts);
    if(pinnedBundle.evidenceCommit!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_EVIDENCE_COMMIT||pinnedBundle.receipts.length!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_COUNT||Buffer.byteLength(compactPrefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_BYTES||sha256CanonicalText(compactPrefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE11_RECEIPT_PREFIX_SHA256)throw new Error("pinned Wave11 receipt root drift");
    const pinned=pinnedBundle.receipts.find(candidate=>candidate.receiptId===receipt.receiptId);
    if(pinned===undefined||JSON.stringify(pinned)!==JSON.stringify(receipt))throw new Error(`historical receipt fingerprint drift: ${receipt.receiptId}`);
  }
  if(receipt.receiptId.startsWith("receipt:wave12:")){
    const pinnedBundle=JSON.parse(readCommitBlob(repositoryRoot,OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_ROOT_COMMIT,OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PATH)) as ObjectDbConsumerExecutionReceiptBundle;
    const compactPrefix=JSON.stringify(pinnedBundle.receipts);
    if(pinnedBundle.evidenceCommit!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_EVIDENCE_COMMIT||pinnedBundle.receipts.length!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_COUNT||Buffer.byteLength(compactPrefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_BYTES||sha256CanonicalText(compactPrefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE12_RECEIPT_PREFIX_SHA256)throw new Error("pinned Wave12 receipt root drift");
    const pinned=pinnedBundle.receipts.find(candidate=>candidate.receiptId===receipt.receiptId);
    if(pinned===undefined||JSON.stringify(pinned)!==JSON.stringify(receipt))throw new Error(`historical receipt fingerprint drift: ${receipt.receiptId}`);
  }
  if(receipt.receiptId.startsWith("receipt:wave13:")){
    const pinnedBundle=JSON.parse(readCommitBlob(repositoryRoot,OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_ROOT_COMMIT,OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PATH)) as ObjectDbConsumerExecutionReceiptBundle;
    const compactPrefix=JSON.stringify(pinnedBundle.receipts);
    if(pinnedBundle.evidenceCommit!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_EVIDENCE_COMMIT||pinnedBundle.receipts.length!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_COUNT||Buffer.byteLength(compactPrefix,"utf8")!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_BYTES||sha256CanonicalText(compactPrefix)!==OBJECT_DB_EXECUTABLE_PARITY_WAVE13_RECEIPT_PREFIX_SHA256)throw new Error("pinned Wave13 receipt root drift");
    const pinned=pinnedBundle.receipts.find(candidate=>candidate.receiptId===receipt.receiptId);
    if(pinned===undefined||JSON.stringify(pinned)!==JSON.stringify(receipt))throw new Error(`historical receipt fingerprint drift: ${receipt.receiptId}`);
    return;
  }
  for (const evidence of [
    { path: receipt.harness.path, sha256: receipt.harness.sourceSha256 },
    { path: receipt.fixture.path, sha256: receipt.fixture.sha256 },
    { path: receipt.invocation.targetPath, sha256: receipt.invocation.targetSourceSha256 },
  ]) {
    const blob = readCommitBlob(repositoryRoot, receiptEvidenceCommit, evidence.path);
    if (sha256CanonicalText(blob) !== evidence.sha256) throw new Error(`${receipt.receiptId} evidenceCommit blob hash drift: ${evidence.path}`);
  }
  const fixtureBlob = readCommitBlob(repositoryRoot, receiptEvidenceCommit, receipt.fixture.path);
  if(receipt.receiptId.startsWith("receipt:wave29:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>;
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    const bindings=Array.isArray(fixture.bindings)?fixture.bindings:[];
    const binding=bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind) as Record<string,unknown>|undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!OBJECT_DB_PARITY_WAVE29_CONSUMER_IDS.includes(receipt.consumerId)||!OBJECT_DB_PARITY_WAVE29_RECEIPT_IDS.has(receipt.receiptId)
      ||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE29_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE29_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE29_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE29_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS796"||!Array.isArray(fixture.consumerIds)||JSON.stringify(fixture.consumerIds.slice().sort())!==JSON.stringify(OBJECT_DB_PARITY_WAVE29_CONSUMER_IDS)||bindings.length!==10||!binding)throw new Error(`${receipt.receiptId} trusted Wave29 contract drift`);
    const expectedReply=receipt.consumerId==="legacy-bf7edb9e7cee98cd"?"[🏆테스터] 님\n사용법: /홈뱃지오픈2 숫자\n예시: /홈뱃지오픈2 10":"[🏆테스터] 님\n사용법: /홈뱃지오픈3 또는 /홈뱃지오픈3 숫자\n예시: /홈뱃지오픈3 10";
    if(binding.exportName!==OBJECT_DB_PARITY_WAVE29_EXPORT_NAME||binding.expectedReply!==(receipt.scenario.scenarioKind==="NEGATIVE_GUARD"?"NO_REPLY":expectedReply)||receipt.receiptId!==`receipt:wave29:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave29 binding/output drift`);
    const locator=manifestConsumer.sourceSpan;
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,manifestConsumer.file));
    if(source.slice(locator.start,locator.end).length===0||sha256CanonicalText(source.slice(locator.start,locator.end))!==locator.sha256)throw new Error(`${receipt.receiptId} Wave29 legacy source span drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave27:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>;
    assertExactKeys(fixture,["format","fixtureId","sliceId","cohortId","representativeConsumerId","source","runtimeSourcePaths","allowedTables","variants","cohortProjectionSha256","scenarioKinds","observations","wrongRoom","shadowObservation"],`${receipt.receiptId}.fixture`);
    const variants=Array.isArray(fixture.variants)?fixture.variants:[],observations=Array.isArray(fixture.observations)?fixture.observations:[],source=isRecord(fixture.source)?fixture.source:undefined,wrongRoom=isRecord(fixture.wrongRoom)?fixture.wrongRoom:undefined,shadow=isRecord(fixture.shadowObservation)?fixture.shadowObservation:undefined;
    const variant=variants.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId) as Record<string,unknown>|undefined;
    const observation=observations.find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as Record<string,unknown>|undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS.includes(receipt.consumerId)||!OBJECT_DB_PARITY_WAVE27_RECEIPT_IDS.has(receipt.receiptId)
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE27_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE27_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE27_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE27_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS794"||fixture.cohortId!=="PACKAGE-SLOT-NEWBIE-ADMIN-GRANT-01"||fixture.representativeConsumerId!==OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID
      ||variants.length!==4||JSON.stringify(variants.map(candidate=>isRecord(candidate)?candidate.consumerId:null).sort())!==JSON.stringify(OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS)
      ||JSON.stringify(fixture.scenarioKinds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE27_SCENARIOS)||observations.length!==7||!variant||!observation
      ||JSON.stringify(fixture.allowedTables)!==JSON.stringify([...OBJECT_DB_PARITY_WAVE27_ALLOWED_TABLES])
      ||!source||source.path!=="main.js"||source.spanStart!==400947||source.spanEnd!==403777||source.spanSha256!=="b8116501b20b58b9050854d6a2b885e164f6534d8660a8f72a0bef1aa784b9bf"
      ||!wrongRoom||wrongRoom.disposition!=="NOT_APPLICABLE"||wrongRoom.ruleId!=="SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1"
      ||!shadow||shadow.mode!=="SHADOW"||shadow.errorCode!=="WAVE27_SHADOW_ROLLBACK"||shadow.committedRowCount!==0||shadow.beforeSha256!==shadow.afterSha256||shadow.externalNetworkCalls!==0||shadow.replyCalls!==0)throw new Error(`${receipt.receiptId} trusted Wave27 contract drift`);
    assertTrustedWave27SlotNewbieVariantProjection(variant,manifestConsumer);
    if(typeof fixture.cohortProjectionSha256!=="string"||sha256CanonicalText(JSON.stringify(variants))!==fixture.cohortProjectionSha256)throw new Error(`${receipt.receiptId} Wave27 cohort projection seal drift`);
    const direct=receipt.consumerId===OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID;
    if((direct&&(receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null))||(!direct&&(receipt.proofMode!=="EQUIVALENT"||!isRecord(receipt.equivalenceRule)||receipt.equivalenceRule.ruleId!=="SLOT_NEWBIE_PARAMETER_PROJECTION_V1"||receipt.equivalenceRule.ruleVersion!=="1"||receipt.equivalenceRule.mechanical!==true||receipt.equivalenceRule.equivalenceKey!==fixture.cohortProjectionSha256||JSON.stringify(receipt.equivalenceRule.variantConsumerIds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS))))throw new Error(`${receipt.receiptId} Wave27 proof mode/equivalence seal drift`);
    if(receipt.receiptId!==`receipt:wave27:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`||receipt.scenario.scenarioId!==`scenario:wave27:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave27 receipt/scenario binding drift`);
    const currentSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,"main.js"));
    if(source.sha256!==sha256CanonicalText(currentSource)||sha256CanonicalText(currentSource.slice(source.spanStart as number,source.spanEnd as number))!==source.spanSha256||manifestConsumer.file!=="main.js"||manifestConsumer.symbol!=="response"||manifestConsumer.interfaceId!=="item.admin-grant.execute"||manifestConsumer.access!=="READ_WRITE")throw new Error(`${receipt.receiptId} Wave27 source/manifest drift`);
    if(!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==6||!fixture.runtimeSourcePaths.every(path=>typeof path==="string"&&sha256CanonicalText(readCommitBlob(repositoryRoot,evidenceCommit,path))===sha256CanonicalText(readCommitBlob(repositoryRoot,receiptEvidenceCommit,path))))throw new Error(`${receipt.receiptId} Wave27 runtime source chain drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave26:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>;
    assertExactKeys(fixture,["format","fixtureId","sliceId","cohortId","representativeConsumerId","source","runtimeSourcePaths","allowedTables","variants","cohortProjectionSha256","scenarioKinds","observations","wrongRoom","shadowObservation"],`${receipt.receiptId}.fixture`);
    const variants=Array.isArray(fixture.variants)?fixture.variants:[],observations=Array.isArray(fixture.observations)?fixture.observations:[],source=isRecord(fixture.source)?fixture.source:undefined,wrongRoom=isRecord(fixture.wrongRoom)?fixture.wrongRoom:undefined,shadow=isRecord(fixture.shadowObservation)?fixture.shadowObservation:undefined;
    const variant=variants.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId) as Record<string,unknown>|undefined;
    const observation=observations.find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as Record<string,unknown>|undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS.includes(receipt.consumerId)||!OBJECT_DB_PARITY_WAVE26_RECEIPT_IDS.has(receipt.receiptId)
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE26_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE26_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE26_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE26_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS793"||fixture.cohortId!=="ITEM-ROCKET-ADMIN-GRANT-01"||fixture.representativeConsumerId!==OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID
      ||variants.length!==10||JSON.stringify(variants.map(candidate=>isRecord(candidate)?candidate.consumerId:null).sort())!==JSON.stringify(OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS)
      ||JSON.stringify(fixture.scenarioKinds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE26_SCENARIOS)||observations.length!==7||!variant||!observation
      ||JSON.stringify(fixture.allowedTables)!==JSON.stringify([...OBJECT_DB_PARITY_WAVE26_ALLOWED_TABLES])
      ||!source||source.path!=="main.js"||source.spanStart!==469110||source.spanEnd!==470441||source.spanSha256!=="2b7d993d0112180779b2f2e0f37958b5fa590a23b4bac0075b2367cb01f1714f"
      ||!wrongRoom||wrongRoom.disposition!=="NOT_APPLICABLE"||wrongRoom.ruleId!=="SOURCE_CLASSIFICATION_HAS_NO_ROOM_GUARD_V1"||wrongRoom.sourceSpanSha256!==source.spanSha256
      ||!shadow||shadow.mode!=="SHADOW"||shadow.errorCode!=="WAVE26_SHADOW_ROLLBACK"||shadow.committedRowCount!==0||shadow.beforeSha256!==shadow.afterSha256||shadow.externalNetworkCalls!==0||shadow.replyCalls!==0)throw new Error(`${receipt.receiptId} trusted Wave26 contract drift`);
    assertTrustedWave26RocketVariantProjection(variant,manifestConsumer);
    if(typeof fixture.cohortProjectionSha256!=="string"||sha256CanonicalText(JSON.stringify(variants))!==fixture.cohortProjectionSha256)throw new Error(`${receipt.receiptId} Wave26 cohort projection seal drift`);
    const direct=receipt.consumerId===OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID;
    if((direct&&(receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null))||(!direct&&(receipt.proofMode!=="EQUIVALENT"||!isRecord(receipt.equivalenceRule)||receipt.equivalenceRule.ruleId!=="ROCKET_PARAMETER_PROJECTION_V1"||receipt.equivalenceRule.ruleVersion!=="1"||receipt.equivalenceRule.mechanical!==true||receipt.equivalenceRule.equivalenceKey!==fixture.cohortProjectionSha256||JSON.stringify(receipt.equivalenceRule.variantConsumerIds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS))))throw new Error(`${receipt.receiptId} Wave26 proof mode/equivalence seal drift`);
    if(receipt.receiptId!==`receipt:wave26:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`||receipt.scenario.scenarioId!==`scenario:wave26:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave26 receipt/scenario binding drift`);
    const currentSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,"main.js"));
    if(source.sha256!==sha256CanonicalText(currentSource)||sha256CanonicalText(currentSource.slice(source.spanStart as number,source.spanEnd as number))!==source.spanSha256||manifestConsumer.file!=="main.js"||manifestConsumer.symbol!=="response"||manifestConsumer.interfaceId!=="item.admin-grant.execute"||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==source.spanStart||manifestConsumer.sourceSpan.end!==source.spanEnd||manifestConsumer.sourceSpan.sha256!==source.spanSha256)throw new Error(`${receipt.receiptId} Wave26 source/manifest drift`);
    if(!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==6||!fixture.runtimeSourcePaths.every(path=>typeof path==="string"&&sha256CanonicalText(readCommitBlob(repositoryRoot,evidenceCommit,path))===sha256CanonicalText(readCommitBlob(repositoryRoot,receiptEvidenceCommit,path))))throw new Error(`${receipt.receiptId} Wave26 runtime source chain drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave25:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==evidenceCommit||receipt.consumerId!==OBJECT_DB_PARITY_WAVE25_CONSUMER_ID||!OBJECT_DB_PARITY_WAVE25_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE25_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE25_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE25_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE25_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS792"||fixture.consumerId!==OBJECT_DB_PARITY_WAVE25_CONSUMER_ID
      ||!contract||contract.version!=="WBS792_ITEM_BAG_READ_DIRECT_V1"||contract.route!=="SHADOW_EVALUATOR"||contract.transaction!=="READ_ONLY"||contract.sourceDomainDmlCount!==0||contract.restart!=="DISTINCT_NODE_CHILD_PROCESSES_AND_MODULES"||contract.externalNetworkCalls!==0
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==4||!fixture.runtimeSourcePaths.includes("main.js")||!Array.isArray(fixture.bindings)||fixture.bindings.length!==5)throw new Error(`${receipt.receiptId} trusted Wave25 contract drift`);
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE25_EXPORT_NAME);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave25:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave25 scenario/binding mismatch`);
    if(manifestConsumer.file!=="main.js"||manifestConsumer.symbol!=="response"||manifestConsumer.triggerOrPredicate!=='msg === "/가방" || msg === "ㄴㄴㄴ"'||manifestConsumer.access!=="READ")throw new Error(`${receipt.receiptId} Wave25 manifest classification drift`);
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,"main.js"));
    if(sha256CanonicalText(source.slice(manifestConsumer.sourceSpan.start,manifestConsumer.sourceSpan.end))!==manifestConsumer.sourceSpan.sha256)throw new Error(`${receipt.receiptId} Wave25 source span drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave24:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,receiptContract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined,shadowContract=isRecord(fixture.shadowContract)?fixture.shadowContract:undefined,shadowObservation=isRecord(fixture.shadowObservation)?fixture.shadowObservation:undefined;
    const trusted=OBJECT_DB_PARITY_WAVE24_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE24_CONSUMERS];
    const cases=Array.isArray(fixture.cases)?fixture.cases:[],caseFixture=cases.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId) as Record<string,unknown>|undefined;
    const contract=caseFixture?.mutationContract as ObjectDbMutationEvidenceContract|undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!trusted||!OBJECT_DB_PARITY_WAVE24_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE24_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE24_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE24_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE24_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS791"||!receiptContract||receiptContract.version!=="WBS791_WAVE24_MUTATION_DIRECT_V1"||receiptContract.locatorProjectionMode!=="RAW_COMPOSITE_DB_PROJECTION"
      ||!shadowContract||shadowContract.mode!=="ROLLBACK_ONLY_ACTUAL_CONSUMER"||shadowContract.route!=="SHADOW"||shadowContract.expectedCommittedRowCount!==0||!shadowObservation||shadowObservation.consumerId!==receipt.consumerId||shadowObservation.route!=="SHADOW"||shadowObservation.transactionOutcome!=="ROLLBACK"||shadowObservation.committedRowCount!==0||shadowObservation.beforeSha256!==shadowObservation.afterSha256||shadowObservation.externalNetworkCalls!==0||shadowObservation.replyCalls!==0
      ||!caseFixture||caseFixture.wbs!==trusted.wbs||!contract||!Array.isArray(caseFixture.runtimeSourcePaths)||caseFixture.runtimeSourcePaths.length<7||JSON.stringify(contract.allowedTables)!==JSON.stringify(trusted.allowedTables)||!Array.isArray(caseFixture.bindings)||caseFixture.bindings.length!==6||!Array.isArray(caseFixture.sealedObservations)||caseFixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave24 contract drift`);
    const binding=(caseFixture.bindings as unknown[]).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE24_EXPORT_NAME);
    const observation=(caseFixture.sealedObservations as unknown[]).find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as ObjectDbMutationScenarioEvidence|undefined;
    const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||!observation||!oracle||receipt.receiptId!==`receipt:wave24:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave24 scenario binding drift`);
    const verified=validateObjectDbMutationScenarioEvidence(contract,observation),source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,contract.source.path)),currentSpan=deriveUniqueClassMethodSourceSpan(source,trusted.className,trusted.methodName),catalogSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,contract.source.path)),relocationDiff=canonicalizeObjectDbConsumerSourceText(execFileSync("git",["diff","--no-ext-diff","--unified=0",OBJECT_DB_CONSUMER_BASELINE_COMMIT,evidenceCommit,"--",contract.source.path],{cwd:repositoryRoot,encoding:"utf8",maxBuffer:16*1024*1024}));
    if(manifestConsumer.file!==contract.source.path||manifestConsumer.symbol!==trusted.methodName||manifestConsumer.triggerOrPredicate!==`SQL_METHOD:${trusted.methodName}`||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==contract.source.catalogSpanStart||manifestConsumer.sourceSpan.end!==contract.source.catalogSpanEnd||manifestConsumer.sourceSpan.sha256!==contract.source.catalogSpanSha256
      ||currentSpan.start!==contract.source.spanStart||currentSpan.end!==contract.source.spanEnd||currentSpan.sha256!==contract.source.spanSha256||sha256CanonicalText(source)!==contract.source.sha256||sha256CanonicalText(catalogSource.slice(contract.source.catalogSpanStart,contract.source.catalogSpanEnd))!==contract.source.catalogSpanSha256||sha256CanonicalText(relocationDiff)!==contract.source.relocationDiffSha256||verified.primary.committedRowCount!==oracle.expectedCommittedRowCount)throw new Error(`${receipt.receiptId} Wave24 source/observation drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave23:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,receiptContract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    const trusted=OBJECT_DB_PARITY_WAVE23_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE23_CONSUMERS];
    const cases=Array.isArray(fixture.cases)?fixture.cases:[],caseFixture=cases.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId) as Record<string,unknown>|undefined;
    const contract=caseFixture?.mutationContract as ObjectDbMutationEvidenceContract|undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!trusted||!OBJECT_DB_PARITY_WAVE23_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE23_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE23_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE23_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE23_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS791"||!receiptContract||receiptContract.version!=="WBS791_WAVE23_MUTATION_DIRECT_V1"||receiptContract.locatorProjectionMode!=="RAW_COMPOSITE_DB_PROJECTION"
      ||!caseFixture||caseFixture.wbs!==trusted.wbs||!contract||!Array.isArray(caseFixture.runtimeSourcePaths)||caseFixture.runtimeSourcePaths.length<7||JSON.stringify(contract.allowedTables)!==JSON.stringify(trusted.allowedTables)||!Array.isArray(caseFixture.bindings)||caseFixture.bindings.length!==6||!Array.isArray(caseFixture.sealedObservations)||caseFixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave23 contract drift`);
    const binding=(caseFixture.bindings as unknown[]).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE23_EXPORT_NAME);
    const observation=(caseFixture.sealedObservations as unknown[]).find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as ObjectDbMutationScenarioEvidence|undefined;
    const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||!observation||!oracle||receipt.receiptId!==`receipt:wave23:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave23 scenario binding drift`);
    const verified=validateObjectDbMutationScenarioEvidence(contract,observation),source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,contract.source.path)),currentSpan=deriveUniqueClassMethodSourceSpan(source,trusted.className,trusted.methodName),catalogSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,contract.source.path)),relocationDiff=canonicalizeObjectDbConsumerSourceText(execFileSync("git",["diff","--no-ext-diff","--unified=0",OBJECT_DB_CONSUMER_BASELINE_COMMIT,evidenceCommit,"--",contract.source.path],{cwd:repositoryRoot,encoding:"utf8",maxBuffer:16*1024*1024}));
    if(manifestConsumer.file!==contract.source.path||manifestConsumer.symbol!==trusted.methodName||manifestConsumer.triggerOrPredicate!==`SQL_METHOD:${trusted.methodName}`||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==contract.source.catalogSpanStart||manifestConsumer.sourceSpan.end!==contract.source.catalogSpanEnd||manifestConsumer.sourceSpan.sha256!==contract.source.catalogSpanSha256
      ||currentSpan.start!==contract.source.spanStart||currentSpan.end!==contract.source.spanEnd||currentSpan.sha256!==contract.source.spanSha256||sha256CanonicalText(source)!==contract.source.sha256||sha256CanonicalText(catalogSource.slice(contract.source.catalogSpanStart,contract.source.catalogSpanEnd))!==contract.source.catalogSpanSha256||sha256CanonicalText(relocationDiff)!==contract.source.relocationDiffSha256||verified.primary.committedRowCount!==oracle.expectedCommittedRowCount)throw new Error(`${receipt.receiptId} Wave23 source/observation drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave22:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=fixture.mutationContract as ObjectDbMutationEvidenceContract|undefined,receiptContract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==OBJECT_DB_PARITY_WAVE22_EVIDENCE_COMMIT||receipt.consumerId!==OBJECT_DB_PARITY_WAVE22_CONSUMER_ID||!OBJECT_DB_PARITY_WAVE22_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE22_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE22_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE22_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE22_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS786"||fixture.consumerId!==receipt.consumerId||!contract||!receiptContract
      ||receiptContract.version!=="WBS786_FURNITURE_GRANT_MUTATION_DIRECT_V1"||receiptContract.sourceMethod!=="MariaCanonicalFurnitureHomeRepository.grantOwnedFurniture"||receiptContract.locatorProjectionMode!=="RAW_COMPOSITE_DB_PROJECTION"
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==7||JSON.stringify(contract.allowedTables)!==JSON.stringify(OBJECT_DB_PARITY_WAVE22_ALLOWED_TABLES)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==6||!Array.isArray(fixture.sealedObservations)||fixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave22 contract drift`);
    const binding=(fixture.bindings as unknown[]).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE22_EXPORT_NAME);
    const observation=(fixture.sealedObservations as unknown[]).find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as ObjectDbMutationScenarioEvidence|undefined;
    const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||!observation||!oracle||receipt.receiptId!==`receipt:wave22:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave22 scenario binding drift`);
    const verified=validateObjectDbMutationScenarioEvidence(contract,observation),source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,receiptEvidenceCommit,contract.source.path)),currentSpan=deriveUniqueClassMethodSourceSpan(source,"MariaCanonicalFurnitureHomeRepository","grantOwnedFurniture"),catalogSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,contract.source.path)),relocationDiff=canonicalizeObjectDbConsumerSourceText(execFileSync("git",["diff","--no-ext-diff","--unified=0",OBJECT_DB_CONSUMER_BASELINE_COMMIT,receiptEvidenceCommit,"--",contract.source.path],{cwd:repositoryRoot,encoding:"utf8",maxBuffer:16*1024*1024}));
    if(manifestConsumer.file!==contract.source.path||manifestConsumer.symbol!=="grantOwnedFurniture"||manifestConsumer.triggerOrPredicate!=="SQL_METHOD:grantOwnedFurniture"||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==contract.source.catalogSpanStart||manifestConsumer.sourceSpan.end!==contract.source.catalogSpanEnd||manifestConsumer.sourceSpan.sha256!==contract.source.catalogSpanSha256
      ||currentSpan.start!==contract.source.spanStart||currentSpan.end!==contract.source.spanEnd||currentSpan.sha256!==contract.source.spanSha256||sha256CanonicalText(source)!==contract.source.sha256||sha256CanonicalText(catalogSource.slice(contract.source.catalogSpanStart,contract.source.catalogSpanEnd))!==contract.source.catalogSpanSha256||sha256CanonicalText(relocationDiff)!==contract.source.relocationDiffSha256||verified.primary.committedRowCount!==oracle.expectedCommittedRowCount)throw new Error(`${receipt.receiptId} Wave22 source/observation drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave21:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=fixture.mutationContract as ObjectDbMutationEvidenceContract|undefined,receiptContract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==OBJECT_DB_PARITY_WAVE21_EVIDENCE_COMMIT||receipt.consumerId!==OBJECT_DB_PARITY_WAVE21_CONSUMER_ID||!OBJECT_DB_PARITY_WAVE21_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE21_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE21_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE21_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE21_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS785"||fixture.consumerId!==receipt.consumerId||!contract||!receiptContract
      ||receiptContract.version!=="WBS785_PET_EQUIPMENT_ASSIGN_MUTATION_DIRECT_V1"||receiptContract.sourceMethod!=="MariaCanonicalPetEquipmentRepository.assign"||JSON.stringify(receiptContract.locatorModes)!==JSON.stringify(["LEGACY_RAW","SHA256_OVERFLOW"])
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==8||JSON.stringify(contract.allowedTables)!==JSON.stringify(OBJECT_DB_PARITY_WAVE21_ALLOWED_TABLES)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==6||!Array.isArray(fixture.sealedObservations)||fixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave21 contract drift`);
    const binding=(fixture.bindings as unknown[]).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE21_EXPORT_NAME);
    const observation=(fixture.sealedObservations as unknown[]).find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as ObjectDbMutationScenarioEvidence|undefined;
    const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||!observation||!oracle||receipt.receiptId!==`receipt:wave21:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} Wave21 scenario binding drift`);
    const verified=validateObjectDbMutationScenarioEvidence(contract,observation),source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,contract.source.path)),currentSpan=deriveUniqueClassMethodSourceSpan(source,"MariaCanonicalPetEquipmentRepository","assign"),catalogSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,contract.source.path)),relocationDiff=canonicalizeObjectDbConsumerSourceText(execFileSync("git",["diff","--no-ext-diff","--unified=0",OBJECT_DB_CONSUMER_BASELINE_COMMIT,evidenceCommit,"--",contract.source.path],{cwd:repositoryRoot,encoding:"utf8",maxBuffer:16*1024*1024}));
    if(manifestConsumer.file!==contract.source.path||manifestConsumer.symbol!=="assign"||manifestConsumer.triggerOrPredicate!=="SQL_METHOD:assign"||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==contract.source.catalogSpanStart||manifestConsumer.sourceSpan.end!==contract.source.catalogSpanEnd||manifestConsumer.sourceSpan.sha256!==contract.source.catalogSpanSha256
      ||currentSpan.start!==contract.source.spanStart||currentSpan.end!==contract.source.spanEnd||currentSpan.sha256!==contract.source.spanSha256||sha256CanonicalText(source)!==contract.source.sha256||sha256CanonicalText(catalogSource.slice(contract.source.catalogSpanStart,contract.source.catalogSpanEnd))!==contract.source.catalogSpanSha256||sha256CanonicalText(relocationDiff)!==contract.source.relocationDiffSha256||verified.primary.committedRowCount!==oracle.expectedCommittedRowCount)throw new Error(`${receipt.receiptId} Wave21 source/observation drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave20:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=fixture.mutationContract as ObjectDbMutationEvidenceContract|undefined,receiptContract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==OBJECT_DB_PARITY_WAVE20_EVIDENCE_COMMIT||receipt.consumerId!==OBJECT_DB_PARITY_WAVE20_CONSUMER_ID||!OBJECT_DB_PARITY_WAVE20_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE20_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE20_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE20_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE20_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS784"||fixture.consumerId!==receipt.consumerId||!contract
      ||!receiptContract||receiptContract.version!=="WBS784_PACKAGE_IMPORT_MUTATION_DIRECT_V1"||receiptContract.transaction!=="MUTATION"||receiptContract.externalNetworkCalls!==0||receiptContract.replyCalls!==0||receiptContract.restart!=="DISTINCT_NODE_CHILD_PROCESSES"||receiptContract.concurrency!=="EXACTLY_ONE_COMMITTED_WRITER"
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==8||!fixture.runtimeSourcePaths.includes("개발환경_고도화/runtime/migrations/444_canonical_item_inventory.sql")||JSON.stringify(contract.allowedTables)!==JSON.stringify(OBJECT_DB_PARITY_WAVE20_ALLOWED_TABLES)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==6||!Array.isArray(fixture.sealedObservations)||fixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave20 contract drift`);
    const binding=(fixture.bindings as unknown[]).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE20_EXPORT_NAME);
    const observation=(fixture.sealedObservations as unknown[]).find(candidate=>isRecord(candidate)&&candidate.scenarioKind===receipt.scenario.scenarioKind) as ObjectDbMutationScenarioEvidence|undefined;
    const oracle=contract.scenarios.find(candidate=>candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||observation===undefined||oracle===undefined||receipt.receiptId!==`receipt:wave20:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave20 scenario/binding mismatch`);
    const verified=validateObjectDbMutationScenarioEvidence(contract,observation);
    const tableSequence=(receipt.expectedActual.dml.expectedNormalizedStatements??[]).map(statement=>/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i.exec(statement)?.[1]);
    const timeline=Array.from({length:oracle.primaryTransactionAttempts},(_,index)=>[`ATTEMPT_${index+1}_BEGIN`,`ATTEMPT_${index+1}_${index+1===oracle.primaryTransactionAttempts?oracle.primaryTransactionOutcome:"ROLLBACK"}`]).flat();
    if(JSON.stringify(tableSequence)!==JSON.stringify(oracle.expectedDmlTableSequence)||receipt.expectedActual.dml.expectedRowCount!==oracle.expectedCommittedRowCount||JSON.stringify(receipt.expectedActual.lockOrder.expected)!==JSON.stringify(oracle.expectedLockOrder)
      ||receipt.expectedActual.transaction.expected!==oracle.primaryTransactionOutcome||JSON.stringify(receipt.expectedActual.transaction.expectedTimeline)!==JSON.stringify(timeline)
      ||receipt.expectedActual.result.expectedSha256!==sha256CanonicalText(JSON.stringify(projectObjectDbMutationOracleResult(oracle)))||receipt.expectedActual.reply.expectedSha256!==sha256CanonicalText("NO_REPLY"))throw new Error(`${receipt.receiptId} independent Wave20 oracle mismatch`);
    if(manifestConsumer.file!==contract.source.path||manifestConsumer.symbol!=="importDefinition"||manifestConsumer.triggerOrPredicate!=="SQL_METHOD:importDefinition"||manifestConsumer.access!=="READ_WRITE"||manifestConsumer.sourceSpan.start!==contract.source.catalogSpanStart||manifestConsumer.sourceSpan.end!==contract.source.catalogSpanEnd||manifestConsumer.sourceSpan.sha256!==contract.source.catalogSpanSha256)throw new Error(`${receipt.receiptId} Wave20 manifest classification drift`);
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,contract.source.path));
    const currentSpan=deriveUniqueClassMethodSourceSpan(source,"MariaCanonicalPackageRewardRepository","importDefinition");
    const catalogSource=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,OBJECT_DB_CONSUMER_BASELINE_COMMIT,contract.source.path));
    const relocationDiff=canonicalizeObjectDbConsumerSourceText(execFileSync("git",["diff","--no-ext-diff","--unified=0",OBJECT_DB_CONSUMER_BASELINE_COMMIT,evidenceCommit,"--",contract.source.path],{cwd:repositoryRoot,encoding:"utf8",maxBuffer:16*1024*1024}));
    if(currentSpan.start!==contract.source.spanStart||currentSpan.end!==contract.source.spanEnd||currentSpan.sha256!==contract.source.spanSha256
      ||sha256CanonicalText(catalogSource.slice(contract.source.catalogSpanStart,contract.source.catalogSpanEnd))!==contract.source.catalogSpanSha256||sha256CanonicalText(relocationDiff)!==contract.source.relocationDiffSha256
      ||sha256CanonicalText(source)!==contract.source.sha256||sha256CanonicalText(source.slice(contract.source.spanStart,contract.source.spanEnd))!==contract.source.spanSha256||verified.primary.committedRowCount!==oracle.expectedCommittedRowCount)throw new Error(`${receipt.receiptId} Wave20 source/observation drift`);
    for(const path of fixture.runtimeSourcePaths as unknown[]){if(typeof path!=="string"||sha256CanonicalText(readCommitBlob(repositoryRoot,evidenceCommit,path)).length!==64)throw new Error(`${receipt.receiptId} Wave20 runtime source-chain drift`);}
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave19:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==evidenceCommit||receipt.consumerId!==OBJECT_DB_PARITY_WAVE19_CONSUMER_ID||!OBJECT_DB_PARITY_WAVE19_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE19_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE19_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE19_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE19_EXPORT_NAME
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS783"||fixture.consumerId!==OBJECT_DB_PARITY_WAVE19_CONSUMER_ID
      ||!contract||contract.version!=="WBS783_PACKAGE_WIZARD_STATUS_DIRECT_V1"||contract.route!=="MODERN"||contract.transaction!=="READ_ONLY"||contract.sourceDomainDmlCount!==0||contract.restart!=="DISTINCT_NODE_CHILD_PROCESSES_AND_MODULES"||contract.externalNetworkCalls!==0
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==7||!fixture.runtimeSourcePaths.includes("개발환경_고도화/runtime/src/app.ts")||!Array.isArray(fixture.bindings)||fixture.bindings.length!==5)throw new Error(`${receipt.receiptId} trusted Wave19 contract drift`);
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===OBJECT_DB_PARITY_WAVE19_EXPORT_NAME);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave19:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave19 scenario/binding mismatch`);
    if(manifestConsumer.file!=="개발환경_고도화/runtime/src/app.ts"||manifestConsumer.symbol!=="handlerKey=PACKAGE_CATALOG_WIZARD_STATUS"||manifestConsumer.triggerOrPredicate!=="handlerKey=PACKAGE_CATALOG_WIZARD_STATUS"||manifestConsumer.access!=="READ")throw new Error(`${receipt.receiptId} Wave19 manifest classification drift`);
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,manifestConsumer.file)),span=source.slice(manifestConsumer.sourceSpan.start,manifestConsumer.sourceSpan.end);
    if(sha256CanonicalText(span)!==manifestConsumer.sourceSpan.sha256)throw new Error(`${receipt.receiptId} Wave19 source span drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave18:")){
    const trusted=OBJECT_DB_PARITY_WAVE18_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE18_CONSUMERS],fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==evidenceCommit||trusted===undefined||!OBJECT_DB_PARITY_WAVE18_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE18_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE18_FIXTURE_PATH||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE18_TARGET_PATH||receipt.invocation.exportName!==trusted.exportName
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS781"||!Array.isArray(fixture.consumerIds)||JSON.stringify(fixture.consumerIds)!==JSON.stringify(Object.keys(OBJECT_DB_PARITY_WAVE18_CONSUMERS))
      ||!contract||contract.version!=="WBS781_READ4_DIRECT_V1"||contract.transaction!=="READ_ONLY"||contract.sourceDomainDmlCount!==0||contract.restart!=="DISTINCT_NODE_CHILD_PROCESSES"||contract.bagSelectCount!==10||contract.petEvaluateSnapshotCount!==1||contract.petEvaluateInSnapshotCount!==0||contract.readinessEnvironment!=="VERIFIED_DATABASE_IDENTITY"
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==10||!fixture.runtimeSourcePaths.includes(trusted.file)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==20)throw new Error(`${receipt.receiptId} trusted Wave18 contract drift`);
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===trusted.exportName);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave18:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave18 scenario/binding mismatch`);
    if(manifestConsumer.file!==trusted.file||manifestConsumer.symbol!==trusted.symbol||manifestConsumer.access!=="READ")throw new Error(`${receipt.receiptId} Wave18 manifest classification drift`);
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,trusted.file)),span=source.slice(manifestConsumer.sourceSpan.start,manifestConsumer.sourceSpan.end);
    if(sha256CanonicalText(span)!==manifestConsumer.sourceSpan.sha256)throw new Error(`${receipt.receiptId} Wave18 source span drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave17:")){
    const trusted=OBJECT_DB_PARITY_WAVE17_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE17_CONSUMERS],fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==evidenceCommit||trusted===undefined||!OBJECT_DB_PARITY_WAVE17_RECEIPT_IDS.has(receipt.receiptId)||receipt.proofMode!=="DIRECT"||receipt.equivalenceRule!==null
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE17_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE17_FIXTURE_PATH
      ||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE17_TARGET_PATH||receipt.invocation.exportName!==trusted.exportName
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS776"
      ||!Array.isArray(fixture.consumerIds)||JSON.stringify(fixture.consumerIds)!==JSON.stringify(Object.keys(OBJECT_DB_PARITY_WAVE17_CONSUMERS))
      ||!contract||contract.version!=="ITEM_BAG_READ_PROVIDERS_DIRECT_V1"||contract.transaction!=="READ_ONLY"||contract.sourceDomainDmlCount!==0||contract.restart!=="DISTINCT_NODE_CHILD_PROCESSES"
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==5||!fixture.runtimeSourcePaths.includes(trusted.file)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==15)throw new Error(`${receipt.receiptId} trusted Wave17 contract drift`);
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&candidate.exportName===trusted.exportName);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave17:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave17 scenario/binding mismatch`);
    if(manifestConsumer.file!==trusted.file||manifestConsumer.symbol!==trusted.symbol||manifestConsumer.access!=="READ")throw new Error(`${receipt.receiptId} Wave17 manifest classification drift`);
    const source=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,evidenceCommit,trusted.file)),span=source.slice(manifestConsumer.sourceSpan.start,manifestConsumer.sourceSpan.end);
    if(sha256CanonicalText(span)!==manifestConsumer.sourceSpan.sha256)throw new Error(`${receipt.receiptId} Wave17 source span drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave16:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,seal=isRecord(fixture.historicalShadowReceiptSeal)?fixture.historicalShadowReceiptSeal:undefined,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==evidenceCommit||!OBJECT_DB_PARITY_WAVE16_RECEIPT_IDS.has(receipt.receiptId)||receipt.consumerId!==OBJECT_DB_PARITY_WAVE16_CONSUMER_ID||receipt.proofMode!=="DIRECT"
      ||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE16_HARNESS_PATH||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE16_FIXTURE_PATH
      ||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE16_TARGET_PATH||receipt.invocation.exportName!=="executeWave16PetSkillInfoDirectReply"
      ||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="SL-PET-SKILL-INFO-DIRECT-REPLY-01"
      ||fixture.consumerId!==OBJECT_DB_PARITY_WAVE16_CONSUMER_ID||fixture.supersedesFixtureId!=="fixture:object-db-executable-parity:wave15:pet-skill-info-private-dev:v1"
      ||!seal||seal.path!=="개발환경_고도화/migration-control/fixtures/synthetic-relational/object-db-consumer-execution-receipts-wave15-v1.json"
      ||seal.receiptCount!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_COUNT||seal.compactReceiptBytes!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_BYTES||seal.compactReceiptSha256!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_SHA256
      ||!contract||contract.version!=="PET_SKILL_INFO_DIRECT_REPLY_V1"||contract.route!=="MODERN"||contract.deliveryOwner!=="OUTBOX_WORKER_ONLY"||contract.externalNetworkCalls!==0
      ||!Array.isArray(fixture.runtimeSourcePaths)||fixture.runtimeSourcePaths.length!==10||!Array.isArray(fixture.bindings)||fixture.bindings.length!==7)throw new Error(`${receipt.receiptId} trusted Wave16 contract drift`);
    const historical=JSON.parse(readCommitBlob(repositoryRoot,evidenceCommit,seal.path as string)) as ObjectDbConsumerExecutionReceiptBundle,compact=JSON.stringify(historical.receipts);
    if(historical.receipts.length!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_COUNT||Buffer.byteLength(compact,"utf8")!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_BYTES||sha256CanonicalText(compact)!==OBJECT_DB_PARITY_WAVE15_FULL_RECEIPT_SHA256)throw new Error(`${receipt.receiptId} historical Wave15 receipt seal drift`);
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave16:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave16 scenario/binding mismatch`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave15:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>,frozen=isRecord(fixture.frozenLegacySource)?fixture.frozenLegacySource:undefined,contract=isRecord(fixture.receiptContract)?fixture.receiptContract:undefined;
    if(receiptEvidenceCommit!==OBJECT_DB_PARITY_WAVE15_EVIDENCE_COMMIT||!OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.has(receipt.receiptId)||receipt.consumerId!==OBJECT_DB_PARITY_WAVE15_CONSUMER_ID||receipt.proofMode!=="DIRECT"||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE15_HARNESS_PATH||receipt.harness.sourceSha256!==OBJECT_DB_PARITY_WAVE15_HARNESS_SHA256||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE15_FIXTURE_PATH||receipt.fixture.sha256!==OBJECT_DB_PARITY_WAVE15_FIXTURE_SHA256||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE15_TARGET_PATH||receipt.invocation.targetSourceSha256!==OBJECT_DB_PARITY_WAVE15_TARGET_SHA256||receipt.invocation.exportName!=="executeWave15PetSkillInfoPrivateDev"||fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="SL-PET-SKILL-INFO-PRIVATE-DEV-FORMAL-RECEIPTS-01"||fixture.baselineCommit!=="f10816ab7398f34979e64073325e118dd4e29e41"||!frozen||frozen.file!=="main.js"||frozen.gitBlobSha1!=="451730e955e1ed47fc2ec6ce24845ea511bc0f21"||!Array.isArray(frozen.spans)||!contract||contract.version!=="PET_SKILL_INFO_PRIVATE_DEV_FORMAL_RECEIPT_V1"||contract.terminalResult!=="NO_REPLY"||contract.transaction!=="ONE_CONSISTENT_ROOT_TRANSACTION"||!Array.isArray(fixture.bindings)||fixture.bindings.length!==7)throw new Error(`${receipt.receiptId} trusted Wave15 contract drift`);
    const legacy=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,fixture.baselineCommit as string,"main.js")),lines=legacy.split("\n");
    for(const span of frozen.spans){if(!isRecord(span)||typeof span.startLine!=="number"||typeof span.endLine!=="number"||typeof span.sha256!=="string"||span.startLine<1||span.endLine<span.startLine||sha256CanonicalText(lines.slice(span.startLine-1,span.endLine).join("\n"))!==span.sha256)throw new Error(`${receipt.receiptId} Wave15 frozen legacy span drift`);}
    const binding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||receipt.receiptId!==`receipt:wave15:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave15 scenario/binding mismatch`);
    for(const source of OBJECT_DB_PARITY_WAVE15_RUNTIME_SOURCE_HASHES)if(sha256CanonicalText(readCommitBlob(repositoryRoot,receiptEvidenceCommit,source.path))!==source.sha256)throw new Error(`${receipt.receiptId} Wave15 runtime import-chain drift`);
    return;
  }
  if(receipt.receiptId.startsWith("receipt:wave14:")){
    const fixture=JSON.parse(fixtureBlob) as Record<string,unknown>;
    const oracle=isRecord(fixture.legacyOracle)?fixture.legacyOracle:undefined,legacy=canonicalizeObjectDbConsumerSourceText(readCommitBlob(repositoryRoot,"8f075b4ef249543563e3338e8f3dd32046344880","main.js")),span=oracle&&typeof oracle.sourceStart==="number"&&typeof oracle.sourceEnd==="number"?legacy.slice(oracle.sourceStart,oracle.sourceEnd):"";
    if(receiptEvidenceCommit!==OBJECT_DB_PARITY_WAVE14_EVIDENCE_COMMIT||!OBJECT_DB_PARITY_WAVE14_RECEIPT_IDS.has(receipt.receiptId)||receipt.consumerId!=="legacy-e038a86d8e885624"||receipt.proofMode!=="DIRECT"||receipt.harness.runner!==OBJECT_DB_PARITY_RUNNER||receipt.harness.path!==OBJECT_DB_PARITY_WAVE14_HARNESS_PATH||receipt.harness.sourceSha256!==OBJECT_DB_PARITY_WAVE14_HARNESS_SHA256||receipt.fixture.path!==OBJECT_DB_PARITY_WAVE14_FIXTURE_PATH||receipt.fixture.sha256!==OBJECT_DB_PARITY_WAVE14_FIXTURE_SHA256||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE14_PET_SKILL_PROBABILITY_TARGET_PATH||receipt.invocation.targetSourceSha256!==OBJECT_DB_PARITY_WAVE14_TARGET_SHA256||receipt.invocation.exportName!=="executeWave14PetSkillProbability"||fixture.format!=="hoibot-object-db-consumer-executable-parity-wave14-v1"||oracle?.sourcePath!=="main.js"||oracle.sourceStart!==201195||oracle.sourceEnd!==202371||oracle.sourceSpanSha256!=="31d66373b98ac5e1fcc5ae3a416c3af775c682ade4b3cd3571851fec53ba0945"||sha256CanonicalText(span)!==oracle.sourceSpanSha256||!span.includes(String(oracle.sourceNeedle))||!Array.isArray(fixture.runtimeSourceHashes))throw new Error(`${receipt.receiptId} trusted Wave14 contract/oracle source drift`);
    const bindings=Array.isArray(fixture.bindings)?fixture.bindings:[],binding=bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(binding)||binding.harnessId!==receipt.harness.harnessId||binding.harnessCaseId!==receipt.harness.harnessCaseId||binding.fixtureId!==receipt.fixture.fixtureId||receipt.receiptId!==`receipt:wave14:${receipt.consumerId}:${receipt.scenario.scenarioKind.toLowerCase()}`)throw new Error(`${receipt.receiptId} pinned Wave14 scenario/binding mismatch`);
    const expectedEvidence=isRecord(fixture.expectedEvidence)?fixture.expectedEvidence:undefined,dmlTemplates=expectedEvidence&&isRecord(expectedEvidence.dmlTemplates)?expectedEvidence.dmlTemplates:undefined,scenarios=expectedEvidence&&isRecord(expectedEvidence.scenarios)?expectedEvidence.scenarios:undefined,expected=scenarios&&isRecord(scenarios[receipt.scenario.scenarioKind])?scenarios[receipt.scenario.scenarioKind] as Record<string,unknown>:undefined,template=expected&&typeof expected.dmlTemplate==="string"&&dmlTemplates&&Array.isArray(dmlTemplates[expected.dmlTemplate])?dmlTemplates[expected.dmlTemplate] as unknown[]:undefined;
    if(expected===undefined||template===undefined||!template.every(statement=>typeof statement==="string")||!Number.isSafeInteger(expected.dmlRepeat)||(expected.dmlRepeat as number)<1||typeof expected.replySha256!=="string"||!isRecord(expected.result)||!Number.isSafeInteger(expected.rowCount)||!Array.isArray(expected.lockOrder)||typeof expected.transaction!=="string"||!Array.isArray(expected.timeline))throw new Error(`${receipt.receiptId} pinned Wave14 expected evidence invalid`);
    const expectedStatements=Array.from({length:expected.dmlRepeat as number},()=>template as string[]).flat();
    if(!receipt.expectedActual.dml.actualNormalizedStatements?.every(statement=>/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\b/i.test(statement)))throw new Error(`${receipt.receiptId} observed DML verb must be INSERT or UPDATE`);
    const expectedDmlHash=normalizedDmlFingerprint(expectedStatements,expected.rowCount as number),expectedResultHash=sha256CanonicalText(JSON.stringify(expected.result));
    if(receipt.expectedActual.reply.expectedSha256!==expected.replySha256||receipt.expectedActual.result.expectedSha256!==expectedResultHash||receipt.expectedActual.dml.expectedSha256!==expectedDmlHash||JSON.stringify(receipt.expectedActual.dml.expectedNormalizedStatements)!==JSON.stringify(expectedStatements)||receipt.expectedActual.dml.expectedRowCount!==expected.rowCount||JSON.stringify(receipt.expectedActual.lockOrder.expected)!==JSON.stringify(expected.lockOrder)||receipt.expectedActual.transaction.expected!==expected.transaction||JSON.stringify(receipt.expectedActual.transaction.expectedTimeline)!==JSON.stringify(expected.timeline))throw new Error(`${receipt.receiptId} pinned Wave14 expected evidence mismatch`);
    for(const source of fixture.runtimeSourceHashes){if(!isRecord(source)||typeof source.path!=="string"||typeof source.sha256!=="string"||sha256CanonicalText(readCommitBlob(repositoryRoot,receiptEvidenceCommit,source.path))!==source.sha256)throw new Error(`${receipt.receiptId} Wave14 runtime import-chain drift`);}
    return;
  }
  assertTrustedWave1FixtureBinding(receipt, fixtureBlob, manifestConsumer, repositoryRoot, evidenceCommit);
}

function assertReceiptExecutableBinding(
  receipt: ObjectDbConsumerExecutionReceipt,
  evidenceFileTexts: Readonly<Record<string, string>>,
  executionReceiptsPath: string,
  evidenceCommit: string,
): void {
  assertRepoRelativeEvidencePath(receipt.harness.path, `${receipt.receiptId}.harness.path`);
  assertRepoRelativeEvidencePath(receipt.fixture.path, `${receipt.receiptId}.fixture.path`);
  assertRepoRelativeEvidencePath(receipt.invocation.targetPath, `${receipt.receiptId}.invocation.targetPath`);
  const evidencePaths = [receipt.harness.path, receipt.fixture.path, receipt.invocation.targetPath];
  if (evidencePaths.includes(executionReceiptsPath) || new Set(evidencePaths).size !== evidencePaths.length) throw new Error(`${receipt.receiptId} self-hash or shared unrelated evidence path is forbidden`);
  const harnessText = evidenceFileTexts[receipt.harness.path];
  const fixtureText = evidenceFileTexts[receipt.fixture.path];
  const targetText = evidenceFileTexts[receipt.invocation.targetPath];
  if (harnessText === undefined || fixtureText === undefined || targetText === undefined) throw new Error(`${receipt.receiptId} executable harness/fixture/target file was not supplied`);
  if (sha256CanonicalText(harnessText) !== receipt.harness.sourceSha256) throw new Error(`${receipt.receiptId} harness source hash drift`);
  if (sha256CanonicalText(fixtureText) !== receipt.fixture.sha256) throw new Error(`${receipt.receiptId} fixture hash drift`);
  if (sha256CanonicalText(targetText) !== receipt.invocation.targetSourceSha256) throw new Error(`${receipt.receiptId} invocation target source hash drift`);
  const binding = receiptBinding(receipt);
  let fixture: unknown;
  try { fixture = JSON.parse(canonicalizeObjectDbConsumerSourceText(fixtureText)); } catch { throw new Error(`${receipt.receiptId} fixture must be JSON`); }
  if (!isRecord(fixture)) throw new Error(`${receipt.receiptId} fixture must be an object`);
  const wave29Binding=receipt.receiptId.startsWith("receipt:wave29:")?undefined:undefined;
  const wave30Binding=receipt.receiptId.startsWith("receipt:wave30:")?undefined:undefined;
  const wave27Binding=receipt.receiptId.startsWith("receipt:wave27:")?[binding]:undefined;
  const wave26Binding=receipt.receiptId.startsWith("receipt:wave26:")?[binding]:undefined;
  const wave24Case=receipt.receiptId.startsWith("receipt:wave24:")&&Array.isArray(fixture.cases)?fixture.cases.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId):undefined;
  const wave23Case=receipt.receiptId.startsWith("receipt:wave23:")&&Array.isArray(fixture.cases)?fixture.cases.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId):undefined;
  const currentMutationCase=isRecord(wave24Case)?wave24Case:wave23Case;
  const fixtureBindings=wave30Binding??wave29Binding??wave27Binding??wave26Binding??(isRecord(currentMutationCase)&&Array.isArray(currentMutationCase.bindings)?currentMutationCase.bindings:Array.isArray(fixture.bindings)?fixture.bindings:[]);
  if(receipt.receiptId.startsWith("receipt:wave32:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS799"||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||JSON.stringify([...fixture.consumerIds].sort())!==JSON.stringify(OBJECT_DB_PARITY_WAVE32_CONSUMER_IDS)||!Array.isArray(fixture.runtimeSourcePaths)||!fixture.runtimeSourcePaths.includes("main.js")||!fixture.runtimeSourcePaths.includes("개발환경_고도화/runtime/src/player/player-title-read-service.ts")||!Array.isArray(fixture.bindings)||fixture.bindings.length!==5||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE32_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE32_EXPORT_NAME||!OBJECT_DB_PARITY_WAVE32_RECEIPT_IDS.has(receipt.receiptId))throw new Error(`${receipt.receiptId} trusted Wave32 fixture drift`);
    const currentBinding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(currentBinding)||currentBinding.exportName!==OBJECT_DB_PARITY_WAVE32_EXPORT_NAME||typeof currentBinding.expectedReply!=="string"||!isRecord(currentBinding.legacy)||!isRecord(currentBinding.modern))throw new Error(`${receipt.receiptId} trusted Wave32 binding drift`);
    if(receipt.scenario.scenarioKind==="NEGATIVE_GUARD"&&(currentBinding.castleSiegeFlag!==true||currentBinding.expectedReply!=="NO_REPLY"))throw new Error(`${receipt.receiptId} Wave32 castle siege guard drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave31:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS798"||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||JSON.stringify([...fixture.consumerIds].sort())!==JSON.stringify(OBJECT_DB_PARITY_WAVE31_CONSUMER_IDS)||!Array.isArray(fixture.runtimeSourcePaths)||!fixture.runtimeSourcePaths.includes("Info.js")||!Array.isArray(fixture.bindings)||fixture.bindings.length!==10||receipt.invocation.targetPath!==OBJECT_DB_PARITY_WAVE31_TARGET_PATH||receipt.invocation.exportName!==OBJECT_DB_PARITY_WAVE31_EXPORT_NAME||!OBJECT_DB_PARITY_WAVE31_RECEIPT_IDS.has(receipt.receiptId))throw new Error(`${receipt.receiptId} trusted Wave31 fixture drift`);
    const currentBinding=fixture.bindings.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind);
    if(!isRecord(currentBinding)||currentBinding.exportName!==OBJECT_DB_PARITY_WAVE31_EXPORT_NAME||typeof currentBinding.expectedReply!=="string"||!isRecord(currentBinding.legacy)||!isRecord(currentBinding.modern))throw new Error(`${receipt.receiptId} trusted Wave31 binding drift`);
    if(receipt.consumerId==="legacy-d04b5224bde6be54"&&receipt.scenario.scenarioKind==="NEGATIVE_GUARD"&&(currentBinding.authorized!==false||currentBinding.expectedReply!=="NO_REPLY"))throw new Error(`${receipt.receiptId} Wave31 admin authorization guard drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave30:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS797"||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==10)throw new Error(`${receipt.receiptId} trusted Wave30 fixture drift`);
  }else
  if(receipt.receiptId.startsWith("receipt:wave29:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS796"||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==10)throw new Error(`${receipt.receiptId} trusted Wave29 fixture drift`);
  }else   if(receipt.receiptId.startsWith("receipt:wave27:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","cohortId","representativeConsumerId","source","runtimeSourcePaths","allowedTables","variants","cohortProjectionSha256","scenarioKinds","observations","wrongRoom","shadowObservation"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS794"||!Array.isArray(fixture.variants)||fixture.variants.length!==4||!Array.isArray(fixture.observations)||fixture.observations.length!==7)throw new Error(`${receipt.receiptId} trusted Wave27 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave26:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","cohortId","representativeConsumerId","source","runtimeSourcePaths","allowedTables","variants","cohortProjectionSha256","scenarioKinds","observations","wrongRoom","shadowObservation"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.sliceId!=="WBS793"||!Array.isArray(fixture.variants)||fixture.variants.length!==10||!Array.isArray(fixture.observations)||fixture.observations.length!==7)throw new Error(`${receipt.receiptId} trusted Wave26 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave25:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerId","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.consumerId!==receipt.consumerId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==5)throw new Error(`${receipt.receiptId} trusted Wave25 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave24:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","receiptContract","shadowContract","shadowObservation","cases"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!Array.isArray(fixture.consumerIds)||fixture.consumerIds.length!==1||!isRecord(wave24Case)||fixtureBindings.length!==6)throw new Error(`${receipt.receiptId} trusted Wave24 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave23:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","receiptContract","cases"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!Array.isArray(fixture.consumerIds)||fixture.consumerIds.length!==3||!isRecord(wave23Case)||fixtureBindings.length!==6)throw new Error(`${receipt.receiptId} trusted Wave23 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerId","runtimeSourcePaths","receiptContract","mutationContract","bindings","sealedObservations"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.consumerId!==receipt.consumerId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==6||!Array.isArray(fixture.sealedObservations)||fixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave21 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave20:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerId","runtimeSourcePaths","receiptContract","mutationContract","bindings","sealedObservations"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.consumerId!==receipt.consumerId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==6||!Array.isArray(fixture.sealedObservations)||fixture.sealedObservations.length!==6)throw new Error(`${receipt.receiptId} trusted Wave20 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave19:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerId","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.consumerId!==receipt.consumerId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==5)throw new Error(`${receipt.receiptId} trusted Wave19 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave18:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==20)throw new Error(`${receipt.receiptId} trusted Wave18 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave17:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerIds","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!Array.isArray(fixture.consumerIds)||!fixture.consumerIds.includes(receipt.consumerId)||!Array.isArray(fixture.bindings)||fixture.bindings.length!==15)throw new Error(`${receipt.receiptId} trusted Wave17 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave16:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","consumerId","supersedesFixtureId","historicalShadowReceiptSeal","runtimeSourcePaths","receiptContract","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||fixture.consumerId!==receipt.consumerId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==7)throw new Error(`${receipt.receiptId} trusted Wave16 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave15:")){
    assertExactKeys(fixture,["format","fixtureId","sliceId","executionId","baselineCommit","frozenLegacySource","receiptContract","bindings","explicitDivergences"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-parity-case-fixture-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!Array.isArray(fixture.bindings)||fixture.bindings.length!==7)throw new Error(`${receipt.receiptId} trusted Wave15 fixture drift`);
  }else if(receipt.receiptId.startsWith("receipt:wave14:")){
    assertExactKeys(fixture,["format","fixtureId","legacyOracle","expectedEvidence","runtimeSourceHashes","payload","bindings"],`${receipt.receiptId}.fixture`);
    if(fixture.format!=="hoibot-object-db-consumer-executable-parity-wave14-v1"||fixture.fixtureId!==receipt.fixture.fixtureId||!isRecord(fixture.legacyOracle)||!isRecord(fixture.expectedEvidence)||!isRecord(fixture.expectedEvidence.dmlTemplates)||!isRecord(fixture.expectedEvidence.scenarios)||fixture.legacyOracle.sourceRef!=="8f075b4ef249543563e3338e8f3dd32046344880"||fixture.legacyOracle.sourcePath!=="main.js"||fixture.legacyOracle.sourceStart!==201195||fixture.legacyOracle.sourceEnd!==202371||fixture.legacyOracle.sourceSpanSha256!=="31d66373b98ac5e1fcc5ae3a416c3af775c682ade4b3cd3571851fec53ba0945"||fixture.legacyOracle.sourceNeedle!=="if (msg === \"/펫스킬확률\")"||fixture.legacyOracle.displayedDefinitionCount!==92||fixture.legacyOracle.utf16CodeUnitCount!==2630||fixture.legacyOracle.utf8ByteCount!==5494||fixture.legacyOracle.replySha256!=="4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a"||!Array.isArray(fixture.bindings))throw new Error(`${receipt.receiptId} trusted Wave14 fixture/oracle drift`);
  }else{
    assertExactKeys(fixture, ["format", "fixtureId", "bindings", "payload"], `${receipt.receiptId}.fixture`);
    if (fixture.format !== "hoibot-object-db-consumer-parity-case-fixture-v1" || fixture.fixtureId !== receipt.fixture.fixtureId || !Array.isArray(fixture.bindings)) throw new Error(`${receipt.receiptId} fixture contract/binding mismatch`);
  }
  const exactBinding = JSON.stringify(binding);
  const hasExactBinding=(receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave30:")||receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")||receipt.receiptId.startsWith("receipt:wave15:")||receipt.receiptId.startsWith("receipt:wave16:")||receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))
    ? fixtureBindings.some(candidate=>isRecord(candidate)&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&(!(receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))||candidate.consumerId===receipt.consumerId))
    : receipt.receiptId.startsWith("receipt:wave14:")
    ? fixtureBindings.some((candidate)=>isRecord(candidate)&&Object.keys(candidate).length===Object.keys(binding).length&&Object.entries(binding).every(([key,value])=>candidate[key]===value))
    : fixtureBindings.some((candidate) => isRecord(candidate) && JSON.stringify(candidate) === exactBinding);
  if (!hasExactBinding) throw new Error(`${receipt.receiptId} unrelated fixture lacks exact receipt binding`);
  if (receipt.harness.runner !== OBJECT_DB_PARITY_RUNNER) throw new Error(`${receipt.receiptId} runner metadata is not allowlisted`);
  const expectedHarnessPath = receipt.receiptId.startsWith("receipt:wave33:")
    ? OBJECT_DB_PARITY_WAVE33_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave32:")
    ? OBJECT_DB_PARITY_WAVE32_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave31:")
    ? OBJECT_DB_PARITY_WAVE31_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave30:")
    ? OBJECT_DB_PARITY_WAVE30_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave29:")
    ? OBJECT_DB_PARITY_WAVE29_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave27:")
    ? OBJECT_DB_PARITY_WAVE27_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave26:")
    ? OBJECT_DB_PARITY_WAVE26_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave25:")
    ? OBJECT_DB_PARITY_WAVE25_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave24:")
    ? OBJECT_DB_PARITY_WAVE24_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave23:")
    ? OBJECT_DB_PARITY_WAVE23_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave22:")
    ? OBJECT_DB_PARITY_WAVE22_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave21:")
    ? OBJECT_DB_PARITY_WAVE21_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave20:")
    ? OBJECT_DB_PARITY_WAVE20_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave19:")
    ? OBJECT_DB_PARITY_WAVE19_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave18:")
    ? OBJECT_DB_PARITY_WAVE18_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave17:")
    ? OBJECT_DB_PARITY_WAVE17_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave16:")
    ? OBJECT_DB_PARITY_WAVE16_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave15:")
    ? OBJECT_DB_PARITY_WAVE15_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave14:")
    ? OBJECT_DB_PARITY_WAVE14_HARNESS_PATH
    : receipt.receiptId.startsWith("receipt:wave13:")
    ? OBJECT_DB_PARITY_WAVE13_HARNESS_PATH
    : receipt.consumerId in TRUSTED_WAVE12_CHARACTER_COUNT_READS
    ? OBJECT_DB_PARITY_WAVE12_HARNESS_PATH
    : receipt.consumerId in TRUSTED_WAVE11_HOME_FURNITURE_READS
    ? OBJECT_DB_PARITY_WAVE11_HARNESS_PATH
    : receipt.consumerId in TRUSTED_WAVE10_PENDANT_READS
    ? OBJECT_DB_PARITY_WAVE10_HARNESS_PATH
    : receipt.consumerId in TRUSTED_WAVE9_RANK_CHAINS
    ? OBJECT_DB_PARITY_WAVE9_HARNESS_PATH
    : receipt.consumerId in TRUSTED_WAVE8_ADMIN_CHAINS
    ? OBJECT_DB_PARITY_WAVE8_HARNESS_PATH
    : OBJECT_DB_PARITY_HARNESS_PATH;
  if (receipt.harness.path !== expectedHarnessPath) throw new Error(`${receipt.receiptId} runner entrypoint is not allowlisted`);
  // 이전 Wave 영수증은 해당 Wave의 고정 evidenceCommit 소스와 자체 해시로 이미 실행 검증됐다.
  // 현재 소스에서 재실행하면 무관한 후속 삽입으로 span 위치가 변하므로, 누적 묶음에서는
  // 위 provenance 검증과 불변 receipt/fixture/harness/target 해시만 재검증한다.
  const currentExecutableReceipt=receipt.receiptId.startsWith("receipt:wave32:");
  if (!currentExecutableReceipt) return;
  const harnessPath = resolveEvidenceFile(receipt.harness.path, harnessText);
  const targetPath = resolveEvidenceFile(receipt.invocation.targetPath, targetText);
  const runDirectory = mkdtempSync(join(tmpdir(), "hoibot-parity-"));
  try {
    const inputPath = join(runDirectory, "input.json");
    const executableBinding=(receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave30:")||receipt.receiptId.startsWith("receipt:wave29:"))?{...(fixtureBindings as Array<Record<string,unknown>>).find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId&&candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind),...binding}:receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")?binding:(receipt.receiptId.startsWith("receipt:wave15:")||receipt.receiptId.startsWith("receipt:wave16:")||receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))?{...(fixtureBindings as Array<Record<string,unknown>>).find(candidate=>candidate.scenarioId===receipt.scenario.scenarioId&&candidate.scenarioKind===receipt.scenario.scenarioKind&&(!(receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))||candidate.consumerId===receipt.consumerId)),...binding}:binding;
    const runtimeSourcePaths=isRecord(currentMutationCase)&&Array.isArray(currentMutationCase.runtimeSourcePaths)?currentMutationCase.runtimeSourcePaths:fixture.runtimeSourcePaths;
    const currentRuntimeSourceHashes=(receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave30:")||receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")||receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))&&Array.isArray(runtimeSourcePaths)
      ?runtimeSourcePaths.map(path=>{if(typeof path!=="string")throw new Error(`${receipt.receiptId} current runtime source path invalid`);return{path,sha256:sha256CanonicalText(readCommitBlob(gitRepositoryRoot(),evidenceCommit,path))};})
      :undefined;
    writeFileSync(inputPath, `${JSON.stringify({ binding:executableBinding, fixturePayload: (receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave30:")||receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))?fixture:fixture.payload, ...((receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave30:")||receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")||receipt.receiptId.startsWith("receipt:wave17:")||receipt.receiptId.startsWith("receipt:wave18:")||receipt.receiptId.startsWith("receipt:wave19:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))?{evidenceCommit,runtimeSourceHashes:currentRuntimeSourceHashes}:receipt.receiptId.startsWith("receipt:wave15:")?{evidenceCommit:OBJECT_DB_PARITY_WAVE15_EVIDENCE_COMMIT,runtimeSourceHashes:OBJECT_DB_PARITY_WAVE15_RUNTIME_SOURCE_HASHES}:receipt.receiptId.startsWith("receipt:wave14:")?{evidenceCommit:OBJECT_DB_PARITY_WAVE14_EVIDENCE_COMMIT,runtimeSourceHashes:fixture.runtimeSourceHashes}:{}), invocation: receipt.invocation }, null, 2)}\n`, "utf8");
    const stdout = executeObjectDbParityHarnessChild(
      (receipt.receiptId.startsWith("receipt:wave32:")||receipt.receiptId.startsWith("receipt:wave31:")||receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")||receipt.receiptId.startsWith("receipt:wave20:")||receipt.receiptId.startsWith("receipt:wave21:")||receipt.receiptId.startsWith("receipt:wave22:")||receipt.receiptId.startsWith("receipt:wave25:")||receipt.receiptId.startsWith("receipt:wave24:")||receipt.receiptId.startsWith("receipt:wave23:"))?["--import","tsx",harnessPath,inputPath,runDirectory,targetPath]:[harnessPath, inputPath, runDirectory, targetPath],
      objectDbParityHarnessTimeoutMs(receipt.harness.path),
    );
    if (stdout.length !== 0) throw new Error(`${receipt.receiptId} print-only/stdout harness is forbidden`);
    const caseResult = JSON.parse(readFileSync(join(runDirectory, "case-result.json"), "utf8")) as unknown;
    if (!isRecord(caseResult)) throw new Error(`${receipt.receiptId} machine case-result invalid`);
    assertExactKeys(caseResult, ["format", "passed", "assertionCount", "executedConsumerId", "executedCaseId", "fixtureId", "scenarioId", "scenarioKind", "invocation", "artifacts"], `${receipt.receiptId}.caseResult`);
    if (caseResult.format !== "hoibot-object-db-consumer-parity-case-result-v1" || caseResult.passed !== true || !Number.isSafeInteger(caseResult.assertionCount) || (caseResult.assertionCount as number) <= 0) throw new Error(`${receipt.receiptId} machine case-result did not pass assertions`);
    if (caseResult.executedConsumerId !== receipt.consumerId || caseResult.executedCaseId !== receipt.harness.harnessCaseId || caseResult.fixtureId !== receipt.fixture.fixtureId || caseResult.scenarioId !== receipt.scenario.scenarioId || caseResult.scenarioKind !== receipt.scenario.scenarioKind) throw new Error(`${receipt.receiptId} machine case-result binding mismatch`);
    if (!isRecord(caseResult.invocation) || JSON.stringify(caseResult.invocation) !== JSON.stringify(receipt.invocation)) throw new Error(`${receipt.receiptId} invocation target path/source hash mismatch`);
    if (!isRecord(caseResult.artifacts)) throw new Error(`${receipt.receiptId} raw artifact registry invalid`);
    assertExactKeys(caseResult.artifacts, ["replyPath", "resultPath", "tracePath"], `${receipt.receiptId}.artifacts`);
    const artifactPath = (name: unknown): string => {
      if (typeof name !== "string" || name.length === 0 || isAbsolute(name) || name.includes("..") || name.includes("\\") || name.includes("/")) throw new Error(`${receipt.receiptId} raw artifact path invalid`);
      return join(runDirectory, name);
    };
    const replyHash = sha256Raw(readFileSync(artifactPath(caseResult.artifacts.replyPath)));
    const resultHash = sha256Raw(readFileSync(artifactPath(caseResult.artifacts.resultPath)));
    if (replyHash !== receipt.expectedActual.reply.actualSha256 || resultHash !== receipt.expectedActual.result.actualSha256) throw new Error(`${receipt.receiptId} raw reply/result capture hash mismatch`);
    const trace = JSON.parse(readFileSync(artifactPath(caseResult.artifacts.tracePath), "utf8")) as unknown;
    if (!isRecord(trace)) throw new Error(`${receipt.receiptId} raw execution trace invalid`);
    if(receipt.receiptId.startsWith("receipt:wave29:")||receipt.receiptId.startsWith("receipt:wave27:")||receipt.receiptId.startsWith("receipt:wave26:")){
      assertExactKeys(trace,["normalizedStatements","rowCount","lockOrder","transaction","timeline"],`${receipt.receiptId}.trace`);
      assertStringArray(trace.normalizedStatements,`${receipt.receiptId}.trace.normalizedStatements`);assertUniqueStrings(trace.lockOrder,`${receipt.receiptId}.trace.lockOrder`);assertStringArray(trace.timeline,`${receipt.receiptId}.trace.timeline`);
      if(!Number.isSafeInteger(trace.rowCount)||(trace.rowCount as number)<0||normalizedDmlFingerprint(trace.normalizedStatements,trace.rowCount as number)!==receipt.expectedActual.dml.actualSha256||JSON.stringify(trace.normalizedStatements)!==JSON.stringify(receipt.expectedActual.dml.actualNormalizedStatements)||trace.rowCount!==receipt.expectedActual.dml.actualRowCount||JSON.stringify(trace.lockOrder)!==JSON.stringify(receipt.expectedActual.lockOrder.actual)||trace.transaction!==receipt.expectedActual.transaction.actual||JSON.stringify(trace.timeline)!==JSON.stringify(receipt.expectedActual.transaction.actualTimeline))throw new Error(`${receipt.receiptId} raw current execution trace mismatch`);
      return;
    }
    const wave32Trace=receipt.receiptId.startsWith("receipt:wave32:"),wave31Trace=receipt.receiptId.startsWith("receipt:wave31:"),wave30Trace=receipt.receiptId.startsWith("receipt:wave30:"),wave25Trace=receipt.receiptId.startsWith("receipt:wave25:"),wave24Trace=receipt.receiptId.startsWith("receipt:wave24:"),wave23Trace=receipt.receiptId.startsWith("receipt:wave23:"),wave22Trace=receipt.receiptId.startsWith("receipt:wave22:"),wave21Trace=receipt.receiptId.startsWith("receipt:wave21:"),wave20Trace=receipt.receiptId.startsWith("receipt:wave20:"),wave19Trace=receipt.receiptId.startsWith("receipt:wave19:"),wave18Trace=receipt.receiptId.startsWith("receipt:wave18:"),wave17Trace=receipt.receiptId.startsWith("receipt:wave17:"),sourceDmlTrace=wave32Trace||wave31Trace||wave30Trace||wave25Trace||wave19Trace||wave18Trace||wave17Trace||receipt.receiptId.startsWith("receipt:wave14:")||receipt.receiptId.startsWith("receipt:wave15:")||receipt.receiptId.startsWith("receipt:wave16:"),wave8Trace=sourceDmlTrace||receipt.receiptId.startsWith("receipt:wave13:")||receipt.consumerId in TRUSTED_WAVE8_ADMIN_CHAINS||receipt.consumerId in TRUSTED_WAVE9_RANK_CHAINS||receipt.consumerId in TRUSTED_WAVE10_PENDANT_READS||receipt.consumerId in TRUSTED_WAVE11_HOME_FURNITURE_READS||receipt.consumerId in TRUSTED_WAVE12_CHARACTER_COUNT_READS;
    if(wave24Trace||wave23Trace||wave22Trace||wave21Trace||wave20Trace){
      assertExactKeys(trace,["scenarioKind","traces"],`${receipt.receiptId}.trace`);
      const contract=((wave24Trace||wave23Trace)&&isRecord(currentMutationCase)?currentMutationCase.mutationContract:fixture.mutationContract) as ObjectDbMutationEvidenceContract|undefined;
      if(!contract)throw new Error(`${receipt.receiptId} mutation contract missing`);
      const evidence=trace as unknown as ObjectDbMutationScenarioEvidence;
      const verified=validateObjectDbMutationScenarioEvidence(contract,evidence);
      const primary=verified.primary;
      const actualTimeline=primary.transactionAttempts.flatMap(attempt=>[`ATTEMPT_${attempt.attempt}_BEGIN`,`ATTEMPT_${attempt.attempt}_${attempt.outcome}`]);
      if(normalizedDmlFingerprint(primary.committedDmlStatements,primary.committedRowCount)!==receipt.expectedActual.dml.actualSha256
        ||JSON.stringify(primary.committedDmlStatements)!==JSON.stringify(receipt.expectedActual.dml.actualNormalizedStatements)||primary.committedRowCount!==receipt.expectedActual.dml.actualRowCount
        ||JSON.stringify(primary.lockOrder)!==JSON.stringify(receipt.expectedActual.lockOrder.actual)||primary.transactionAttempts.at(-1)?.outcome!==receipt.expectedActual.transaction.actual
        ||JSON.stringify(actualTimeline)!==JSON.stringify(receipt.expectedActual.transaction.actualTimeline))throw new Error(`${receipt.receiptId} raw mutation trace mismatch`);
      return;
    }
    assertExactKeys(trace, (wave32Trace||wave31Trace||wave30Trace||wave25Trace||wave19Trace)?["queryTrace","dmlTrace","normalizedStatements","rowCount","lockOrder","transaction","transactionAttempts","timeline","sourceDomainDmlCount","restartProcessIds","restartModuleIds","restartResults"]:wave18Trace?["queryTrace","dmlTrace","normalizedStatements","rowCount","lockOrder","transaction","transactionAttempts","timeline","sourceDomainDmlCount","restartProcessIds","snapshotCount","verifiedEnvironment","databaseIdentity"]:wave17Trace?["queryTrace","dmlTrace","normalizedStatements","rowCount","lockOrder","transaction","transactionAttempts","timeline","sourceDomainDmlCount","restartProcessIds"]:sourceDmlTrace?["queryTrace","dmlTrace","normalizedStatements","rowCount","lockOrder","transaction","transactionAttempts","timeline","sourceDomainDmlCount"]:wave8Trace?["queryTrace", "dmlTrace", "normalizedStatements", "rowCount", "lockOrder", "transaction", "transactionAttempts", "timeline"]:["queryTrace", "dmlTrace", "normalizedStatements", "rowCount", "lockOrder", "transaction", "timeline"], `${receipt.receiptId}.trace`);
    if(sourceDmlTrace&&trace.sourceDomainDmlCount!==0)throw new Error(`${receipt.receiptId} canonical source DML detected`);
    if(wave17Trace&&(!Array.isArray(trace.restartProcessIds)||trace.restartProcessIds.length!==(receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"?2:1)||!trace.restartProcessIds.every(value=>Number.isSafeInteger(value))))throw new Error(`${receipt.receiptId} Wave17 restart process evidence drift`);
    if(wave18Trace&&(!Array.isArray(trace.restartProcessIds)||trace.restartProcessIds.length!==(receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"?2:1)||!trace.restartProcessIds.every(value=>Number.isSafeInteger(value))))throw new Error(`${receipt.receiptId} Wave18 restart process evidence drift`);
    if((wave32Trace||wave31Trace||wave30Trace||wave25Trace||wave19Trace)&&(!Array.isArray(trace.restartProcessIds)||trace.restartProcessIds.length!==(receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"?2:1)||!trace.restartProcessIds.every(value=>Number.isSafeInteger(value))||!Array.isArray(trace.restartModuleIds)||trace.restartModuleIds.length!==trace.restartProcessIds.length||!trace.restartModuleIds.every(value=>typeof value==="string")||!Array.isArray(trace.restartResults)||trace.restartResults.length!==trace.restartProcessIds.length||!trace.restartResults.every(value=>typeof value==="string")||(receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"&&(new Set(trace.restartProcessIds).size!==2||new Set(trace.restartModuleIds).size!==2||new Set(trace.restartResults).size!==1))))throw new Error(`${receipt.receiptId} restart process/module/result evidence drift`);
    if (!Array.isArray(trace.queryTrace)) throw new Error(`${receipt.receiptId} trace queryTrace invalid`);
    for (const [index, query] of trace.queryTrace.entries()) {
      if (!isRecord(query)) throw new Error(`${receipt.receiptId} trace queryTrace[${index}] invalid`);
      assertExactKeys(query, ["channel", "normalizedSql", "values", "rowCount"], `${receipt.receiptId}.trace.queryTrace[${index}]`);
      if (query.channel !== "query" || typeof query.normalizedSql !== "string" || !Array.isArray(query.values) || !Number.isSafeInteger(query.rowCount) || (query.rowCount as number) < 0) throw new Error(`${receipt.receiptId} trace queryTrace[${index}] invalid`);
    }
    if(!Array.isArray(trace.dmlTrace))throw new Error(`${receipt.receiptId} trace dmlTrace invalid`);
    for(const[index,mutation]of trace.dmlTrace.entries()){if(!isRecord(mutation))throw new Error(`${receipt.receiptId} trace dmlTrace[${index}] invalid`);assertExactKeys(mutation,["channel","normalizedSql","values","rowCount"],`${receipt.receiptId}.trace.dmlTrace[${index}]`);if(mutation.channel!=="execute"||typeof mutation.normalizedSql!=="string"||!Array.isArray(mutation.values)||!Number.isSafeInteger(mutation.rowCount)||(mutation.rowCount as number)<0)throw new Error(`${receipt.receiptId} trace dmlTrace[${index}] invalid`);if(sourceDmlTrace&&!/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\b/i.test(mutation.normalizedSql))throw new Error(`${receipt.receiptId} observed DML verb must be INSERT or UPDATE`);}
    if(wave8Trace){if(!Array.isArray(trace.transactionAttempts))throw new Error(`${receipt.receiptId} trace transactionAttempts invalid`);for(const[index,attempt]of trace.transactionAttempts.entries()){if(!isRecord(attempt))throw new Error(`${receipt.receiptId} trace transactionAttempts[${index}] invalid`);assertExactKeys(attempt,["attemptNumber","outcome","committed","dmlStatements","dmlRowCount"],`${receipt.receiptId}.trace.transactionAttempts[${index}]`);if(attempt.attemptNumber!==index+1||(attempt.outcome!=="COMMIT"&&attempt.outcome!=="ROLLBACK")||attempt.committed!==(attempt.outcome==="COMMIT")||!Array.isArray(attempt.dmlStatements)||!attempt.dmlStatements.every(statement=>typeof statement==="string")||!Number.isSafeInteger(attempt.dmlRowCount)||(attempt.dmlRowCount as number)<0)throw new Error(`${receipt.receiptId} trace transactionAttempts[${index}] invalid`);}}
    if((wave32Trace||wave31Trace||wave30Trace)&&(trace.transaction!=="COMMIT"||trace.queryTrace.length===0||trace.dmlTrace.length===0||!Array.isArray(trace.transactionAttempts)||trace.transactionAttempts.length===0))throw new Error(`${receipt.receiptId} Wave30 actual ingress trace incomplete`);
    if(receipt.consumerId in TRUSTED_WAVE8_ADMIN_CHAINS||receipt.consumerId in TRUSTED_WAVE9_RANK_CHAINS||receipt.consumerId in TRUSTED_WAVE10_PENDANT_READS||receipt.consumerId in TRUSTED_WAVE11_HOME_FURNITURE_READS||receipt.consumerId in TRUSTED_WAVE12_CHARACTER_COUNT_READS){
      const payload=isRecord(fixture.payload)?fixture.payload:undefined,cases=payload&&Array.isArray(payload.cases)?payload.cases:[],parityCase=cases.find(candidate=>isRecord(candidate)&&candidate.caseId===receipt.harness.harnessCaseId),consumers=isRecord(parityCase)&&Array.isArray(parityCase.consumers)?parityCase.consumers:[],consumer=consumers.find(candidate=>isRecord(candidate)&&candidate.consumerId===receipt.consumerId);
      if(!isRecord(consumer)||!isRecord(consumer.queryPlanByScenario)||!isRecord(consumer.mutationPlanByScenario))throw new Error(`${receipt.receiptId} trusted Wave8 trace plan invalid`);
      const queries=consumer.queryPlanByScenario[receipt.scenario.scenarioKind],mutations=consumer.mutationPlanByScenario[receipt.scenario.scenarioKind],repeat=receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"?2:1;
      if(!Array.isArray(queries)||!Array.isArray(mutations))throw new Error(`${receipt.receiptId} trusted Wave8 scenario trace missing`);
      const expectedQueries=Array.from({length:repeat},()=>queries).flat().map(step=>{if(!isRecord(step)||typeof step.expectedNormalizedSql!=="string"||!Array.isArray(step.expectedValues)||!Array.isArray(step.rows))throw new Error(`${receipt.receiptId} trusted Wave8 query step invalid`);return{channel:"query",normalizedSql:step.expectedNormalizedSql,values:step.expectedValues,rowCount:step.rows.length};});
      if(trace.queryTrace.length!==expectedQueries.length)throw new Error(`${receipt.receiptId} trusted Wave8 query count drift`);
      for(let index=0;index<expectedQueries.length;index++){const actual=trace.queryTrace[index] as Record<string,unknown>,expected=expectedQueries[index]!;if(actual.channel!==expected.channel||actual.normalizedSql!==expected.normalizedSql||actual.rowCount!==expected.rowCount||!Array.isArray(actual.values)||actual.values.length!==expected.values.length||!actual.values.every((value,valueIndex)=>matchesTrustedTraceValue(value,expected.values[valueIndex])))throw new Error(`${receipt.receiptId} trusted Wave8 exact query trace mismatch`);}
      const expectedMutations=Array.from({length:repeat},()=>mutations).flat();if(trace.dmlTrace.length!==expectedMutations.length)throw new Error(`${receipt.receiptId} trusted Wave8 mutation count drift`);
      for(let index=0;index<expectedMutations.length;index++){const step=expectedMutations[index],actual=trace.dmlTrace[index] as Record<string,unknown>;if(!isRecord(step)||typeof step.expectedNormalizedSql!=="string"||!Array.isArray(step.expectedValues)||!Array.isArray(actual.values))throw new Error(`${receipt.receiptId} trusted Wave8 mutation step invalid`);const expectedValues=step.expectedValues;if(actual.normalizedSql!==step.expectedNormalizedSql||actual.rowCount!==step.affectedRows||actual.values.length!==expectedValues.length||!actual.values.every((value,valueIndex)=>matchesTrustedTraceValue(value,expectedValues[valueIndex])))throw new Error(`${receipt.receiptId} trusted Wave8 exact mutation trace mismatch`);}
      const expectedLocks:string[]=[];for(const step of queries){if(!isRecord(step)||typeof step.expectedNormalizedSql!=="string"||!/\bFOR UPDATE\b/i.test(step.expectedNormalizedSql))continue;for(const match of step.expectedNormalizedSql.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z0-9_]+)/gi))if(!expectedLocks.includes(match[1]!))expectedLocks.push(match[1]!);}if(JSON.stringify(trace.lockOrder)!==JSON.stringify(expectedLocks))throw new Error(`${receipt.receiptId} trusted Wave8 lock order drift`);
      if(receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"){const operationKeys=(trace.dmlTrace as Array<Record<string,unknown>>).filter(entry=>typeof entry.normalizedSql==="string"&&/^INSERT(?: IGNORE)? INTO operations/.test(entry.normalizedSql)).map(entry=>(entry.values as unknown[])[0]);if(operationKeys.length!==2||!operationKeys.every(value=>typeof value==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))||operationKeys[0]===operationKeys[1])throw new Error(`${receipt.receiptId} trusted full-ingress restart UUID drift`);}
    } else if (!wave18Trace && (receipt.consumerId === "sql-repository-7367fce7053551f3" || receipt.consumerId === "sql-repository-3001ad9fc2f36d01" || receipt.consumerId in TRUSTED_WAVE7_SERVICE_CHAINS)) {
      const fixturePayload = isRecord(fixture.payload) ? fixture.payload : undefined;
      const cases = fixturePayload !== undefined && Array.isArray(fixturePayload.cases) ? fixturePayload.cases : [];
      const parityCase = cases.find((candidate) => isRecord(candidate) && candidate.caseId === receipt.harness.harnessCaseId);
      const consumers = isRecord(parityCase) && Array.isArray(parityCase.consumers) ? parityCase.consumers : [];
      const consumer = consumers.find((candidate) => isRecord(candidate) && candidate.consumerId === receipt.consumerId);
      if (!isRecord(consumer) || !Array.isArray(consumer.orderedQueries) || !isRecord(consumer.queryRowsByScenario)) throw new Error(`${receipt.receiptId} trusted ordered-query trace fixture invalid`);
      const orderedQueries = consumer.orderedQueries;
      const scenarioRows = consumer.queryRowsByScenario[receipt.scenario.scenarioKind];
      if (!Array.isArray(scenarioRows)) throw new Error(`${receipt.receiptId} trusted ordered-query scenario rows invalid`);
      const oneExecution = scenarioRows.map((rows, index) => {
        const query = orderedQueries[index];
        if (!Array.isArray(rows) || !isRecord(query) || typeof query.expectedNormalizedSql !== "string" || !Array.isArray(query.expectedQueryValues)) throw new Error(`${receipt.receiptId} trusted ordered-query trace plan invalid`);
        return { channel: "query", normalizedSql: query.expectedNormalizedSql, values: query.expectedQueryValues, rowCount: rows.length };
      });
      const expectedTrace = receipt.scenario.scenarioKind === "RESTART_CONSISTENCY" ? [...oneExecution, ...oneExecution] : oneExecution;
      if (JSON.stringify(trace.queryTrace) !== JSON.stringify(expectedTrace)) throw new Error(`${receipt.receiptId} trusted ordered-query exact query trace mismatch`);
      if(receipt.consumerId in TRUSTED_WAVE7_SERVICE_CHAINS){
        const contract=consumer.queueReplyContract,handlerResults=consumer.expectedResultsByScenario,input=consumer.input;
        if(!isRecord(contract)||!Array.isArray(contract.queueScenarios)||!isRecord(handlerResults)||!isRecord(input))throw new Error(`${receipt.receiptId} trusted Wave7 queue contract invalid`);
        const handlerResult=handlerResults[receipt.scenario.scenarioKind],queue=contract.queueScenarios.includes(receipt.scenario.scenarioKind);
        let oneMutation:Array<{channel:string;normalizedSql:unknown;values:unknown[];rowCount:number}>=[];
        if(queue){if(!isRecord(handlerResult)||typeof handlerResult.commandCode!=="string"||typeof handlerResult.message!=="string")throw new Error(`${receipt.receiptId} trusted Wave7 handler result invalid`);oneMutation=[
          {channel:"execute",normalizedSql:contract.operationSql,values:[{matcher:contract.operationKeyMatcher}],rowCount:1},
          {channel:"execute",normalizedSql:contract.commandExecutionSql,values:[input.eventId,handlerResult.commandCode,contract.operationInsertId],rowCount:1},
          {channel:"execute",normalizedSql:contract.outboxSql,values:[contract.operationInsertId,input.channelId,JSON.stringify({data:handlerResult.message})],rowCount:1},
        ];}
        const expectedMutations=receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"?[...oneMutation,...oneMutation]:oneMutation;
        if(trace.dmlTrace.length!==expectedMutations.length)throw new Error(`${receipt.receiptId} trusted Wave7 exact mutation count mismatch`);
        for(let index=0;index<expectedMutations.length;index++){const actual=trace.dmlTrace[index] as Record<string,unknown>,expected=expectedMutations[index]!;if(actual.channel!==expected.channel||actual.normalizedSql!==expected.normalizedSql||actual.rowCount!==expected.rowCount||!Array.isArray(actual.values)||actual.values.length!==expected.values.length||!actual.values.every((value,valueIndex)=>matchesTrustedTraceValue(value,expected.values[valueIndex])))throw new Error(`${receipt.receiptId} trusted Wave7 exact mutation trace mismatch`);}
        if(queue&&receipt.scenario.scenarioKind==="RESTART_CONSISTENCY"){const first=trace.dmlTrace[0] as Record<string,unknown>,second=trace.dmlTrace[3] as Record<string,unknown>,firstValues=first.values as unknown[],secondValues=second.values as unknown[];if(firstValues[0]===secondValues[0])throw new Error(`${receipt.receiptId} trusted Wave7 restart reused operation UUID`);}
      }
    }
    assertStringArray(trace.normalizedStatements, `${receipt.receiptId}.trace.normalizedStatements`);
    if (!Number.isSafeInteger(trace.rowCount) || (trace.rowCount as number) < 0) throw new Error(`${receipt.receiptId} trace rowCount invalid`);
    assertUniqueStrings(trace.lockOrder, `${receipt.receiptId}.trace.lockOrder`);
    assertStringArray(trace.timeline, `${receipt.receiptId}.trace.timeline`);
    if (normalizedDmlFingerprint(trace.normalizedStatements, trace.rowCount as number) !== receipt.expectedActual.dml.actualSha256 || JSON.stringify(trace.normalizedStatements) !== JSON.stringify(receipt.expectedActual.dml.actualNormalizedStatements) || trace.rowCount !== receipt.expectedActual.dml.actualRowCount) throw new Error(`${receipt.receiptId} raw DML trace mismatch`);
    if (JSON.stringify(trace.lockOrder) !== JSON.stringify(receipt.expectedActual.lockOrder.actual) || trace.transaction !== receipt.expectedActual.transaction.actual || JSON.stringify(trace.timeline) !== JSON.stringify(receipt.expectedActual.transaction.actualTimeline)) throw new Error(`${receipt.receiptId} raw lock/transaction trace mismatch`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(receipt.receiptId)) throw error;
    throw new Error(`${receipt.receiptId} allowlisted harness execution failed: ${error instanceof Error?error.message:String(error)}`);
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}

function validateExecutionReceipt(
  value: unknown,
  manifestById: ReadonlyMap<string, ConsumerManifestInput["consumers"][number]>,
  evidenceFileTexts: Readonly<Record<string, string>>,
  executionReceiptsPath: string,
  evidenceCommit: string,
): ObjectDbConsumerExecutionReceipt {
  if (!isRecord(value)) throw new Error("execution receipt must be an object");
  assertExactKeys(value, ["receiptId", "consumerId", "proofMode", "harness", "fixture", "invocation", "scenario", "expectedActual", "equivalenceRule", "verdict", "receiptSha256"], "execution receipt");
  const receipt = value as unknown as ObjectDbConsumerExecutionReceipt;
  if (typeof receipt.receiptId !== "string" || !/^receipt:[a-z0-9._:-]+$/i.test(receipt.receiptId)) throw new Error("execution receiptId invalid");
  const manifestConsumer = manifestById.get(receipt.consumerId);
  if (manifestConsumer === undefined) throw new Error(`${receipt.receiptId} attributes unknown consumerId`);
  if (receipt.proofMode !== "DIRECT" && receipt.proofMode !== "EQUIVALENT") throw new Error(`${receipt.receiptId} proofMode invalid`);
  if (!isRecord(receipt.harness)) throw new Error(`${receipt.receiptId}.harness invalid`);
  assertExactKeys(receipt.harness, ["harnessId", "harnessCaseId", "runner", "path", "sourceSha256"], `${receipt.receiptId}.harness`);
  for (const key of ["harnessId", "harnessCaseId", "runner", "path"] as const) if (typeof receipt.harness[key] !== "string" || receipt.harness[key].length === 0) throw new Error(`${receipt.receiptId}.harness.${key} invalid`);
  assertHash(receipt.harness.sourceSha256, `${receipt.receiptId}.harness.sourceSha256`);
  if (!isRecord(receipt.fixture)) throw new Error(`${receipt.receiptId}.fixture invalid`);
  assertExactKeys(receipt.fixture, ["fixtureId", "path", "sha256"], `${receipt.receiptId}.fixture`);
  for (const key of ["fixtureId", "path"] as const) if (typeof receipt.fixture[key] !== "string" || receipt.fixture[key].length === 0) throw new Error(`${receipt.receiptId}.fixture.${key} invalid`);
  assertHash(receipt.fixture.sha256, `${receipt.receiptId}.fixture.sha256`);
  if (!isRecord(receipt.invocation)) throw new Error(`${receipt.receiptId}.invocation invalid`);
  assertExactKeys(receipt.invocation, ["targetPath", "targetSourceSha256", "exportName"], `${receipt.receiptId}.invocation`);
  if (typeof receipt.invocation.targetPath !== "string" || receipt.invocation.targetPath.length === 0 || typeof receipt.invocation.exportName !== "string" || receipt.invocation.exportName.length === 0) throw new Error(`${receipt.receiptId}.invocation metadata invalid`);
  assertHash(receipt.invocation.targetSourceSha256, `${receipt.receiptId}.invocation.targetSourceSha256`);
  if (!isRecord(receipt.scenario)) throw new Error(`${receipt.receiptId}.scenario invalid`);
  assertExactKeys(receipt.scenario, ["scenarioId", "scenarioKind"], `${receipt.receiptId}.scenario`);
  if (typeof receipt.scenario.scenarioId !== "string" || receipt.scenario.scenarioId.length === 0 || !new Set<string>([...OBJECT_DB_PARITY_READ_SCENARIOS, ...OBJECT_DB_PARITY_MUTATION_SCENARIOS]).has(receipt.scenario.scenarioKind)) throw new Error(`${receipt.receiptId}.scenario invalid`);
  assertExpectedActual(receipt.expectedActual, `${receipt.receiptId}.expectedActual`, true);
  if (receipt.verdict !== "PASS") throw new Error(`${receipt.receiptId} verdict must be PASS`);
  assertHash(receipt.receiptSha256, `${receipt.receiptId}.receiptSha256`);
  if (receiptFingerprint(receipt) !== receipt.receiptSha256) throw new Error(`${receipt.receiptId} receipt fingerprint drift`);
  const forbiddenSelfHashes = new Set([receipt.receiptSha256, receipt.harness.sourceSha256, receipt.fixture.sha256, receipt.invocation.targetSourceSha256]);
  for (const comparison of [receipt.expectedActual.reply, receipt.expectedActual.result, receipt.expectedActual.dml]) if (comparison.expectedSha256 !== null && forbiddenSelfHashes.has(comparison.expectedSha256)) throw new Error(`${receipt.receiptId} self-hash cannot stand in for reply/result/DML evidence`);
  const dml = receipt.expectedActual.dml;
  if (dml.expectedNormalizedStatements === null || dml.actualNormalizedStatements === null || dml.expectedRowCount === null || dml.actualRowCount === null) throw new Error(`${receipt.receiptId} DML statements and row counts are required`);
  if (normalizedDmlFingerprint(dml.expectedNormalizedStatements, dml.expectedRowCount) !== dml.expectedSha256 || normalizedDmlFingerprint(dml.actualNormalizedStatements, dml.actualRowCount) !== dml.actualSha256) throw new Error(`${receipt.receiptId} normalized DML fingerprint drift`);
  const wave14Receipt=receipt.receiptId.startsWith("receipt:wave14:");
  if(wave14Receipt)assertReceiptGitProvenance(receipt,evidenceCommit,manifestConsumer);
  const transaction = receipt.expectedActual.transaction;
  if (transaction.expectedTimeline === null || transaction.actualTimeline === null) throw new Error(`${receipt.receiptId} transaction timeline is required`);
  if (receipt.scenario.scenarioKind === "DOMAIN_FAILURE_ROLLBACK" || receipt.scenario.scenarioKind === "PAYLOAD_DRIFT_FAIL_CLOSED") {
    if (transaction.actual !== "ROLLBACK") throw new Error(`${receipt.receiptId} failure scenario must rollback`);
  }
  const trustedWave7InfrastructureDml=receipt.consumerId in TRUSTED_WAVE7_SERVICE_CHAINS&&receipt.harness.path===OBJECT_DB_PARITY_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE7_SERVICE_CHAIN_TARGET_PATH;
  const trustedWave8AdminDml=receipt.consumerId in TRUSTED_WAVE8_ADMIN_CHAINS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE8_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE8_ADMIN_CHAIN_TARGET_PATH;
  const trustedWave9RankDml=receipt.consumerId in TRUSTED_WAVE9_RANK_CHAINS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE9_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE9_RANK_CHAIN_TARGET_PATH;
  const trustedWave10PendantDml=receipt.consumerId in TRUSTED_WAVE10_PENDANT_READS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE10_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE10_PENDANT_READ_TARGET_PATH;
  const trustedWave11HomeFurnitureDml=receipt.consumerId in TRUSTED_WAVE11_HOME_FURNITURE_READS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE11_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE11_HOME_FURNITURE_READ_TARGET_PATH;
  const trustedWave12CharacterCountDml=receipt.consumerId in TRUSTED_WAVE12_CHARACTER_COUNT_READS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE12_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE12_CHARACTER_COUNT_TARGET_PATH;
  const trustedWave13ServerStatsDml=receipt.consumerId in TRUSTED_WAVE13_SERVER_STATS_READS&&receipt.harness.path===OBJECT_DB_PARITY_WAVE13_HARNESS_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE13_SERVER_STATS_TARGET_PATH;
  const trustedWave14PetSkillProbabilityDml=receipt.consumerId==="legacy-e038a86d8e885624"&&OBJECT_DB_PARITY_WAVE14_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE14_HARNESS_PATH&&receipt.harness.sourceSha256===OBJECT_DB_PARITY_WAVE14_HARNESS_SHA256&&receipt.fixture.sha256===OBJECT_DB_PARITY_WAVE14_FIXTURE_SHA256&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE14_PET_SKILL_PROBABILITY_TARGET_PATH&&receipt.invocation.targetSourceSha256===OBJECT_DB_PARITY_WAVE14_TARGET_SHA256;
  const trustedWave15PetSkillInfoDml=receipt.consumerId===OBJECT_DB_PARITY_WAVE15_CONSUMER_ID&&OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.has(receipt.receiptId)&&evidenceCommit===OBJECT_DB_PARITY_WAVE15_EVIDENCE_COMMIT&&receipt.harness.path===OBJECT_DB_PARITY_WAVE15_HARNESS_PATH&&receipt.harness.sourceSha256===OBJECT_DB_PARITY_WAVE15_HARNESS_SHA256&&receipt.fixture.sha256===OBJECT_DB_PARITY_WAVE15_FIXTURE_SHA256&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE15_TARGET_PATH&&receipt.invocation.targetSourceSha256===OBJECT_DB_PARITY_WAVE15_TARGET_SHA256;
  const trustedWave16PetSkillInfoDml=receipt.consumerId===OBJECT_DB_PARITY_WAVE16_CONSUMER_ID&&OBJECT_DB_PARITY_WAVE16_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE16_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE16_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE16_TARGET_PATH;
  const trustedWave20PackageImportDml=receipt.consumerId===OBJECT_DB_PARITY_WAVE20_CONSUMER_ID&&OBJECT_DB_PARITY_WAVE20_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE20_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE20_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE20_TARGET_PATH;
  const trustedWave21PetEquipmentDml=receipt.consumerId===OBJECT_DB_PARITY_WAVE21_CONSUMER_ID&&OBJECT_DB_PARITY_WAVE21_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE21_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE21_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE21_TARGET_PATH;
  const trustedWave22FurnitureGrantDml=receipt.consumerId===OBJECT_DB_PARITY_WAVE22_CONSUMER_ID&&OBJECT_DB_PARITY_WAVE22_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE22_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE22_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE22_TARGET_PATH;
  const trustedWave23MutationDml=receipt.consumerId in OBJECT_DB_PARITY_WAVE23_CONSUMERS&&OBJECT_DB_PARITY_WAVE23_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE23_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE23_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE23_TARGET_PATH;
  const trustedWave24MutationDml=receipt.consumerId in OBJECT_DB_PARITY_WAVE24_CONSUMERS&&OBJECT_DB_PARITY_WAVE24_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE24_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE24_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE24_TARGET_PATH;
  const trustedWave26RocketDml=OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS.includes(receipt.consumerId)&&OBJECT_DB_PARITY_WAVE26_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE26_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE26_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE26_TARGET_PATH;
  const trustedWave27SlotNewbieDml=OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS.includes(receipt.consumerId)&&OBJECT_DB_PARITY_WAVE27_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE27_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE27_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE27_TARGET_PATH;
  const trustedWave30PlayerTitleReadDml=OBJECT_DB_PARITY_WAVE30_CONSUMER_IDS.includes(receipt.consumerId)&&OBJECT_DB_PARITY_WAVE30_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE30_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE30_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE30_TARGET_PATH;
  const trustedWave31MemberTitleLegacyListDml=OBJECT_DB_PARITY_WAVE31_CONSUMER_IDS.includes(receipt.consumerId)&&OBJECT_DB_PARITY_WAVE31_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE31_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE31_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE31_TARGET_PATH;
  const trustedWave32MemberTitleLegacyInfoDml=OBJECT_DB_PARITY_WAVE32_CONSUMER_IDS.includes(receipt.consumerId)&&OBJECT_DB_PARITY_WAVE32_RECEIPT_IDS.has(receipt.receiptId)&&receipt.harness.path===OBJECT_DB_PARITY_WAVE32_HARNESS_PATH&&receipt.fixture.path===OBJECT_DB_PARITY_WAVE32_FIXTURE_PATH&&receipt.invocation.targetPath===OBJECT_DB_PARITY_WAVE32_TARGET_PATH;
  const wave7InfrastructureStatements=new Set(["INSERT INTO operations (operation_key, actor_type, source_code, status, created_at, completed_at) VALUES (?, 'external_identity', 'iris', 'completed', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))","INSERT INTO command_executions (event_id, command_code, operation_id, execution_status, result_code, created_at, completed_at) VALUES (?, ?, ?, 'completed', 'reply_queued', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))","INSERT INTO outbox_messages (operation_id, provider_code, destination_id, message_type, payload_json, status, available_at, created_at) VALUES (?, 'iris', ?, 'text', ?, 'pending', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))"]);
  const onlyTrustedWave7Infrastructure=dml.actualNormalizedStatements.every(statement=>wave7InfrastructureStatements.has(statement));
  const wave8AllowedTables=new Set(["command_routing_decisions","operations","outbox_messages","command_executions","command_audit","admin_server_stat_snapshot_sets","admin_server_stat_snapshot_rows","admin_server_stat_read_executions"]);
  const onlyTrustedWave8EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave8AllowedTables.has(match[1]!);});
  const wave9AllowedTables=new Set(["operations","outbox_messages","command_executions","command_audit"]);
  const onlyTrustedWave9EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave9AllowedTables.has(match[1]!);});
  const wave10AllowedTables=new Set(["command_routing_decisions","channels","external_identities","channel_memberships","event_inbox","normalized_provider_events","operations","outbox_messages","command_executions","command_audit","delivery_attempts"]);
  const onlyTrustedWave10EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave10AllowedTables.has(match[1]!);});
  const onlyTrustedWave11EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave10AllowedTables.has(match[1]!);});
  const wave12AllowedTables=new Set([...wave10AllowedTables,"admin_character_count_stat_executions"]);
  const onlyTrustedWave12EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?: IGNORE)? INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave12AllowedTables.has(match[1]!);});
  const wave13AllowedTables=new Set([...wave10AllowedTables,"admin_server_stat_read_executions","admin_server_stat_snapshot_sets","admin_server_stat_snapshot_rows"]),onlyTrustedWave13EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?: IGNORE)? INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave13AllowedTables.has(match[1]!);});
  const wave14AllowedTables=new Set([...wave10AllowedTables,"external_identity_names","channel_activity_daily"]),onlyTrustedWave14EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave14AllowedTables.has(match[1]!);});
  const onlyTrustedWave30EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave14AllowedTables.has(match[1]!);});
  const onlyTrustedWave31EvidenceDml=onlyTrustedWave30EvidenceDml;
  const onlyTrustedWave32EvidenceDml=onlyTrustedWave31EvidenceDml;
  const wave15AllowedTables=new Set([...wave14AllowedTables,"canonical_app_wiring_operations"]),onlyTrustedWave15EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave15AllowedTables.has(match[1]!);});
  const onlyTrustedWave16EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave15AllowedTables.has(match[1]!);});
  const onlyTrustedWave20EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&new Set<string>(OBJECT_DB_PARITY_WAVE20_ALLOWED_TABLES).has(match[1]!);});
  const onlyTrustedWave21EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&new Set<string>(OBJECT_DB_PARITY_WAVE21_ALLOWED_TABLES).has(match[1]!);});
  const onlyTrustedWave22EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&new Set<string>(OBJECT_DB_PARITY_WAVE22_ALLOWED_TABLES).has(match[1]!);});
  const wave23AllowedTables=trustedWave23MutationDml?new Set<string>(OBJECT_DB_PARITY_WAVE23_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE23_CONSUMERS].allowedTables):new Set<string>();
  const onlyTrustedWave23EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave23AllowedTables.has(match[1]!);});
  const wave24AllowedTables=trustedWave24MutationDml?new Set<string>(OBJECT_DB_PARITY_WAVE24_CONSUMERS[receipt.consumerId as keyof typeof OBJECT_DB_PARITY_WAVE24_CONSUMERS].allowedTables):new Set<string>();
  const onlyTrustedWave24EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&wave24AllowedTables.has(match[1]!);});
  const onlyTrustedWave26EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&OBJECT_DB_PARITY_WAVE26_ALLOWED_TABLES.has(match[1]!);});
  const onlyTrustedWave27EvidenceDml=dml.actualNormalizedStatements.every(statement=>{const match=statement.match(/^(?:INSERT(?:\s+IGNORE)?\s+INTO|UPDATE|DELETE\s+FROM)\s+([A-Za-z0-9_]+)/i);return match!==null&&OBJECT_DB_PARITY_WAVE27_ALLOWED_TABLES.has(match[1]!);});
  if (receipt.scenario.scenarioKind === "DUPLICATE_REPLAY_DML_ZERO" || receipt.scenario.scenarioKind === "SOURCE_DOMAIN_DML_ZERO") {
    if ((!trustedWave32MemberTitleLegacyInfoDml||!onlyTrustedWave32EvidenceDml)&&(!trustedWave31MemberTitleLegacyListDml||!onlyTrustedWave31EvidenceDml)&&(!trustedWave30PlayerTitleReadDml||!onlyTrustedWave30EvidenceDml)&&(!trustedWave7InfrastructureDml||!onlyTrustedWave7Infrastructure)&&(!trustedWave8AdminDml||!onlyTrustedWave8EvidenceDml)&&(!trustedWave9RankDml||!onlyTrustedWave9EvidenceDml)&&(!trustedWave10PendantDml||!onlyTrustedWave10EvidenceDml)&&(!trustedWave11HomeFurnitureDml||!onlyTrustedWave11EvidenceDml)&&(!trustedWave12CharacterCountDml||!onlyTrustedWave12EvidenceDml)&&(!trustedWave13ServerStatsDml||!onlyTrustedWave13EvidenceDml)&&(!trustedWave14PetSkillProbabilityDml||!onlyTrustedWave14EvidenceDml)&&(!trustedWave15PetSkillInfoDml||!onlyTrustedWave15EvidenceDml)&&(!trustedWave16PetSkillInfoDml||!onlyTrustedWave16EvidenceDml)&&(dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0)) throw new Error(`${receipt.receiptId} DML-zero scenario mutated source domain`);
  }
  const zeroDmlMutationKinds = new Set<ObjectDbParityScenarioKind>(["AUTH_DENIED", "WRONG_ROOM_REJECTED", "PAYLOAD_DRIFT_FAIL_CLOSED", "DUPLICATE_REPLAY_DML_ZERO", "RESTART_REPLAY"]);
  const accessClass: AccessClass = manifestConsumer.access === "READ" ? "READ" : "MUTATION";
  if(trustedWave27SlotNewbieDml){
    if(!onlyTrustedWave27EvidenceDml)throw new Error(`${receipt.receiptId} Wave27 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==9||dml.actualNormalizedStatements.length!==9))throw new Error(`${receipt.receiptId} Wave27 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&(transaction.actual!=="ROLLBACK"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave27 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY"||receipt.scenario.scenarioKind==="AUTH_DENIED")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave27 replay/auth evidence invalid`);
  }
  if(trustedWave26RocketDml){
    if(!onlyTrustedWave26EvidenceDml)throw new Error(`${receipt.receiptId} Wave26 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==9||dml.actualNormalizedStatements.length!==9))throw new Error(`${receipt.receiptId} Wave26 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&(transaction.actual!=="ROLLBACK"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave26 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY"||receipt.scenario.scenarioKind==="AUTH_DENIED")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave26 replay/auth evidence invalid`);
  }
  if(trustedWave20PackageImportDml){
    if(!onlyTrustedWave20EvidenceDml)throw new Error(`${receipt.receiptId} Wave20 non-allowlisted package mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==26||dml.actualNormalizedStatements.length!==26))throw new Error(`${receipt.receiptId} Wave20 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&transaction.actual!=="ROLLBACK")throw new Error(`${receipt.receiptId} Wave20 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave20 replay evidence invalid`);
  }
  if(trustedWave21PetEquipmentDml){
    if(!onlyTrustedWave21EvidenceDml)throw new Error(`${receipt.receiptId} Wave21 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==6||dml.actualNormalizedStatements.length!==6))throw new Error(`${receipt.receiptId} Wave21 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&transaction.actual!=="ROLLBACK")throw new Error(`${receipt.receiptId} Wave21 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave21 replay evidence invalid`);
  }
  if(trustedWave22FurnitureGrantDml){
    if(!onlyTrustedWave22EvidenceDml)throw new Error(`${receipt.receiptId} Wave22 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==2||dml.actualNormalizedStatements.length!==2))throw new Error(`${receipt.receiptId} Wave22 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&transaction.actual!=="ROLLBACK")throw new Error(`${receipt.receiptId} Wave22 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave22 replay evidence invalid`);
  }
  if(trustedWave24MutationDml){
    if(!onlyTrustedWave24EvidenceDml)throw new Error(`${receipt.receiptId} Wave24 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==4||dml.actualNormalizedStatements.length!==4))throw new Error(`${receipt.receiptId} Wave24 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&transaction.actual!=="ROLLBACK")throw new Error(`${receipt.receiptId} Wave24 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave24 replay evidence invalid`);
  }
  if(trustedWave23MutationDml){
    const expectedWriterCount=receipt.consumerId==="sql-repository-818137c4fb22037a"?4:2;
    if(!onlyTrustedWave23EvidenceDml)throw new Error(`${receipt.receiptId} Wave23 non-allowlisted mutation`);
    if((receipt.scenario.scenarioKind==="MUTATION_SUCCESS"||receipt.scenario.scenarioKind==="CONCURRENCY_SINGLE_WRITER")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==expectedWriterCount||dml.actualNormalizedStatements.length!==expectedWriterCount))throw new Error(`${receipt.receiptId} Wave23 committed writer evidence invalid`);
    if((receipt.scenario.scenarioKind==="DOMAIN_FAILURE_ROLLBACK"||receipt.scenario.scenarioKind==="PAYLOAD_DRIFT_FAIL_CLOSED")&&transaction.actual!=="ROLLBACK")throw new Error(`${receipt.receiptId} Wave23 fail-closed transaction invalid`);
    if((receipt.scenario.scenarioKind==="DUPLICATE_REPLAY_DML_ZERO"||receipt.scenario.scenarioKind==="RESTART_REPLAY")&&(transaction.actual!=="COMMIT"||dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave23 replay evidence invalid`);
  }
  if (accessClass === "READ") {
    if(trustedWave32MemberTitleLegacyInfoDml){if(!onlyTrustedWave32EvidenceDml||transaction.actual!=="COMMIT"||dml.actualNormalizedStatements.length===0)throw new Error(`${receipt.receiptId} Wave32 READ ingress evidence mutation invalid`);}
    else if(trustedWave31MemberTitleLegacyListDml){if(!onlyTrustedWave31EvidenceDml||transaction.actual!=="COMMIT"||dml.actualNormalizedStatements.length===0)throw new Error(`${receipt.receiptId} Wave31 READ ingress evidence mutation invalid`);}
    else if(trustedWave30PlayerTitleReadDml){if(!onlyTrustedWave30EvidenceDml||transaction.actual!=="COMMIT"||dml.actualNormalizedStatements.length===0)throw new Error(`${receipt.receiptId} Wave30 READ ingress evidence mutation invalid`);}
    else if(trustedWave16PetSkillInfoDml){if(!onlyTrustedWave16EvidenceDml||!(transaction.actual==="COMMIT"||transaction.actual==="READ_ONLY"))throw new Error(`${receipt.receiptId} Wave16 READ pet-skill-info evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave16 READ_ONLY mutated evidence tables`);}
    else if(trustedWave15PetSkillInfoDml){if(!onlyTrustedWave15EvidenceDml||transaction.actual!=="COMMIT")throw new Error(`${receipt.receiptId} Wave15 READ pet-skill-info evidence mutation invalid`);}
    else if(trustedWave14PetSkillProbabilityDml){if(!onlyTrustedWave14EvidenceDml||transaction.actual!=="COMMIT")throw new Error(`${receipt.receiptId} Wave14 READ probability evidence mutation invalid`);}
    else if(trustedWave13ServerStatsDml){if(!onlyTrustedWave13EvidenceDml||!(["READ_ONLY","COMMIT"]as const).includes(transaction.actual as"READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave13 READ server-stats evidence mutation invalid`);}
    else if(trustedWave12CharacterCountDml){if(!onlyTrustedWave12EvidenceDml||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave12 READ character-count evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave12 READ_ONLY mutated evidence tables`);if(transaction.actual==="COMMIT"&&dml.actualNormalizedStatements.length!==6&&dml.actualNormalizedStatements.length!==15&&dml.actualNormalizedStatements.length!==30)throw new Error(`${receipt.receiptId} Wave12 full-ingress evidence DML count invalid`);}
    else if(trustedWave11HomeFurnitureDml){if(!onlyTrustedWave11EvidenceDml||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave11 READ home-furniture evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave11 READ_ONLY mutated evidence tables`);if(transaction.actual==="COMMIT"&&dml.actualNormalizedStatements.length!==6&&dml.actualNormalizedStatements.length!==14&&dml.actualNormalizedStatements.length!==28)throw new Error(`${receipt.receiptId} Wave11 full-ingress evidence DML count invalid`);}
    else if(trustedWave10PendantDml){if(!onlyTrustedWave10EvidenceDml||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave10 READ pendant evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave10 READ_ONLY mutated evidence tables`);if(transaction.actual==="COMMIT"&&dml.actualNormalizedStatements.length!==6&&dml.actualNormalizedStatements.length!==14&&dml.actualNormalizedStatements.length!==28)throw new Error(`${receipt.receiptId} Wave10 full-ingress evidence DML count invalid`);}
    else if(trustedWave9RankDml){if(!onlyTrustedWave9EvidenceDml||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave9 READ rank evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave9 READ_ONLY mutated evidence tables`);if(transaction.actual==="COMMIT"&&dml.actualNormalizedStatements.length!==5&&dml.actualNormalizedStatements.length!==10)throw new Error(`${receipt.receiptId} Wave9 rank evidence DML count invalid`);}
    else if(trustedWave8AdminDml){if(!onlyTrustedWave8EvidenceDml||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave8 READ admin evidence mutation invalid`);if(transaction.actual==="READ_ONLY"&&dml.actualNormalizedStatements.length!==0)throw new Error(`${receipt.receiptId} Wave8 READ_ONLY mutated evidence tables`);}
    else if(trustedWave7InfrastructureDml){if(!onlyTrustedWave7Infrastructure||!(["READ_ONLY","COMMIT"] as const).includes(transaction.actual as "READ_ONLY"|"COMMIT"))throw new Error(`${receipt.receiptId} Wave7 READ dispatch infrastructure mutation invalid`);if(transaction.actual==="READ_ONLY"&&(dml.actualRowCount!==0||dml.actualNormalizedStatements.length!==0))throw new Error(`${receipt.receiptId} Wave7 READ_ONLY dispatch mutated infrastructure`);if(transaction.actual==="COMMIT"&&dml.actualNormalizedStatements.length===0)throw new Error(`${receipt.receiptId} Wave7 COMMIT dispatch missing infrastructure mutation`);}
    else{if (transaction.actual !== "READ_ONLY") throw new Error(`${receipt.receiptId} READ scenario must be READ_ONLY`);if (dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0) throw new Error(`${receipt.receiptId} READ scenario must have business DML0`);}
  } else if (zeroDmlMutationKinds.has(receipt.scenario.scenarioKind) && (dml.actualRowCount !== 0 || dml.actualNormalizedStatements.length !== 0)) {
    throw new Error(`${receipt.receiptId} ${receipt.scenario.scenarioKind} must have business DML0`);
  }
  if(!wave14Receipt)assertReceiptGitProvenance(receipt, evidenceCommit, manifestConsumer);
  assertReceiptExecutableBinding(receipt, evidenceFileTexts, executionReceiptsPath, evidenceCommit);
  return receipt;
}

function deriveRegistrySourceMismatchResolution(
  manifest: ConsumerManifestInput,
  classificationSourceTexts: Readonly<Record<string, string>>,
): ExecutableParityLedger["registrySourceMismatchResolution"] {
  const bindings: ExecutableParityLedger["registrySourceMismatchResolution"]["bindings"] = [];
  const unattributed: string[] = [];
  for (const mismatch of manifest.audit.registrySourceMismatches) {
    const separator = mismatch.indexOf(":");
    const file = mismatch.slice(0, separator);
    const command = mismatch.slice(separator + 1);
    const sourceText = classificationSourceTexts[file];
    if (sourceText === undefined) throw new Error(`classification source was not supplied: ${file}`);
    const source = canonicalizeObjectDbConsumerSourceText(sourceText);
    const indexes: number[] = [];
    for (let index = source.indexOf(command); index >= 0; index = source.indexOf(command, index + command.length)) indexes.push(index);
    const candidates = new Map<string, ConsumerManifestInput["consumers"][number]>();
    for (const index of indexes) for (const consumer of manifest.consumers) {
      if (consumer.kind !== "LEGACY_COMMAND" || consumer.file !== file || consumer.sourceSpan === undefined) continue;
      if (!predicateAcceptsRegistryCommand(consumer.triggerOrPredicate, command)) continue;
      const fullConsumer = consumer as ConsumerManifestInput["consumers"][number] & { sourceSpan: { start?: number; end?: number; sha256: string } };
      if (!Number.isSafeInteger(fullConsumer.sourceSpan.start) || !Number.isSafeInteger(fullConsumer.sourceSpan.end)) continue;
      if (fullConsumer.sourceSpan.start! <= index && index < fullConsumer.sourceSpan.end!) {
        const span = source.slice(fullConsumer.sourceSpan.start!, fullConsumer.sourceSpan.end!);
        if (sha256CanonicalText(span) !== fullConsumer.sourceSpan.sha256) throw new Error(`registry mismatch source span drift: ${mismatch}:${consumer.consumerId}`);
        candidates.set(consumer.consumerId, consumer);
      }
    }
    if (candidates.size === 0) { unattributed.push(mismatch); continue; }
    if (candidates.size !== 1) throw new Error(`registry mismatch maps ambiguously to consumer IDs: ${mismatch}`);
    const consumer = [...candidates.values()][0]!;
    bindings.push({ registrySourceMismatch: mismatch, consumerId: consumer.consumerId, sourceSpanSha256: consumer.sourceSpan.sha256 });
  }
  bindings.sort((left, right) => left.registrySourceMismatch.localeCompare(right.registrySourceMismatch));
  unattributed.sort();
  return { bindings, unattributed };
}

export function buildObjectDbConsumerExecutableParityLedger(input: {
  consumerManifestText: string;
  consumerIdRegistryText: string;
  transitionContractText: string;
  executionReceiptsText: string;
  ledgerSchemaText: string;
  executionReceiptSchemaText: string;
  classificationSourceTexts: Readonly<Record<string, string>>;
  sourcePaths: {
    consumerManifest: string;
    consumerIdRegistry: string;
    transitionContract: string;
    executionReceipts: string;
    ledgerSchema: string;
    executionReceiptSchema: string;
  };
  evidenceFileTexts?: Readonly<Record<string, string>>;
}): ExecutableParityLedger {
  const manifest = JSON.parse(canonicalizeObjectDbConsumerSourceText(input.consumerManifestText)) as ConsumerManifestInput;
  if (manifest.format !== "hoibot-object-db-consumer-manifest-v1") throw new Error("unsupported consumer manifest format");
  assertCommit(manifest.baseCommit, "consumer manifest baseCommit");
  assertHash(manifest.consumerSetSha256, "consumer manifest consumerSetSha256");
  if (!Array.isArray(manifest.consumers)) throw new Error("consumer manifest consumers must be an array");
  if (!isRecord(manifest.audit) || !Number.isSafeInteger(manifest.audit.registrySourceMismatchCount) || manifest.audit.registrySourceMismatchCount < 0) throw new Error("invalid registrySourceMismatchCount");
  if (!Array.isArray(manifest.audit.registrySourceMismatches) || manifest.audit.registrySourceMismatches.length !== manifest.audit.registrySourceMismatchCount) throw new Error("registry source mismatch detail/count drift");
  if (sha256CanonicalJson(manifest.consumers) !== manifest.consumerSetSha256) throw new Error("consumer manifest consumerSetSha256 drift");
  const effectiveManifest = applyCompatibleClassificationDeltas(manifest, input.classificationSourceTexts);

  const registry = parseConsumerIdRegistry(JSON.parse(canonicalizeObjectDbConsumerSourceText(input.consumerIdRegistryText)), manifest.baseCommit);
  const resolveStableId = createConsumerIdResolver(registry);
  const receiptBundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(input.executionReceiptsText)));
  if (receiptBundle.classificationBaseCommit !== manifest.baseCommit) throw new Error("classificationBaseCommit drift between manifest and execution receipts");
  const transition = JSON.parse(canonicalizeObjectDbConsumerSourceText(input.transitionContractText)) as Record<string, unknown>;
  if (transition.format !== "hoibot-object-db-consumer-transition-v1" || transition.catalogVersion !== receiptBundle.catalogVersion || transition.baseCommit !== manifest.baseCommit) throw new Error("transition/receipt/manifest provenance drift");

  const manifestIds = new Set<string>();
  for (const consumer of manifest.consumers) {
    if (!CONSUMER_ID_PATTERN.test(consumer.consumerId) || manifestIds.has(consumer.consumerId)) throw new Error(`invalid or duplicate manifest consumerId: ${consumer.consumerId}`);
    manifestIds.add(consumer.consumerId);
    if (resolveStableId(consumer) !== consumer.consumerId) throw new Error(`stable consumer ID registry drift: ${consumer.consumerId}`);
  }
  const manifestById = new Map(effectiveManifest.consumers.map((consumer) => [consumer.consumerId, consumer]));
  const mismatchResolution = deriveRegistrySourceMismatchResolution(manifest, input.classificationSourceTexts);
  const mismatchLabelsByConsumer = new Map<string, string[]>();
  for (const binding of mismatchResolution.bindings) mismatchLabelsByConsumer.set(binding.consumerId, [...(mismatchLabelsByConsumer.get(binding.consumerId) ?? []), binding.registrySourceMismatch].sort());

  const receiptIds = new Set<string>();
  const receiptScenarioKeys = new Set<string>();
  const receiptsByConsumer = new Map<string, ObjectDbConsumerExecutionReceipt[]>();
  for (const rawReceipt of receiptBundle.receipts) {
    const receipt = validateExecutionReceipt(rawReceipt, manifestById, input.evidenceFileTexts ?? {}, input.sourcePaths.executionReceipts, receiptBundle.evidenceCommit);
    if (receiptIds.has(receipt.receiptId)) throw new Error(`duplicate execution receiptId: ${receipt.receiptId}`);
    receiptIds.add(receipt.receiptId);
    // Wave8 직접 서비스 호출은 역사 자료로 검증·보존하되, 현행 판정은 Wave13 actual ingress 보정 cohort만 소비합니다.
    if(receipt.consumerId==="admin-command-5e04d0767d4c2abc"&&!receipt.receiptId.startsWith("receipt:wave13:"))continue;
    // Wave6 가방 compare 영수증은 불변 이력으로 남지만, WBS743 이후 source span이 달라졌으므로 현행 DIRECT 증거로 승계하지 않습니다.
    if(receipt.consumerId==="sql-repository-3001ad9fc2f36d01"&&receipt.receiptId.startsWith("receipt:wave6:")&&manifestById.get(receipt.consumerId)?.sourceSpan.sha256!=="b19de38cf45d65786fa679411313cf3249c159d685af0a4b6c64b4e565656144")continue;
    const scenarioKey = `${receipt.consumerId}|${receipt.scenario.scenarioKind}`;
    if (receiptScenarioKeys.has(scenarioKey)) throw new Error(`duplicate consumer scenario receipt: ${scenarioKey}`);
    receiptScenarioKeys.add(scenarioKey);
    receiptsByConsumer.set(receipt.consumerId, [...(receiptsByConsumer.get(receipt.consumerId) ?? []), receipt]);
  }

  const entries = effectiveManifest.consumers.map((consumer): ExecutableParityLedgerEntry => {
    const mismatchLabels = mismatchLabelsByConsumer.get(consumer.consumerId) ?? [];
    const classification = classificationProjection(consumer, mismatchLabels);
    const requirements = scenarioRequirementsFor(consumer, classification.classificationSha256,consumer.consumerId);
    const receipts = (receiptsByConsumer.get(consumer.consumerId) ?? []).sort((left, right) => left.scenario.scenarioKind.localeCompare(right.scenario.scenarioKind));
    const correctiveWave15=consumer.consumerId===OBJECT_DB_PARITY_WAVE15_CONSUMER_ID&&receipts.length===OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.size&&receipts.every(receipt=>OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.has(receipt.receiptId));
    if (mismatchLabels.length > 0 || (consumer.unresolvedDynamicCallCount > 0&&!correctiveWave15)) {
      if (receipts.length > 0) throw new Error(`${consumer.consumerId} cannot consume receipts while source classification blocker remains`);
      return { consumerId: consumer.consumerId, classification, verdict: baselineVerdict(consumer, mismatchLabels), ...emptyExecutionEvidence(requirements) };
    }
    if (receipts.length === 0) return { consumerId: consumer.consumerId, classification, verdict: "STATIC_ONLY", ...emptyExecutionEvidence(requirements) };
    const first = receipts[0]!;
    for (const receipt of receipts) {
      if (receipt.harness.harnessId !== first.harness.harnessId || receipt.harness.path !== first.harness.path || receipt.harness.sourceSha256 !== first.harness.sourceSha256 || receipt.fixture.fixtureId !== first.fixture.fixtureId || receipt.fixture.path !== first.fixture.path || receipt.fixture.sha256 !== first.fixture.sha256 || JSON.stringify(receipt.invocation) !== JSON.stringify(first.invocation) || receipt.proofMode !== first.proofMode || JSON.stringify(receipt.equivalenceRule) !== JSON.stringify(first.equivalenceRule)) throw new Error(`${consumer.consumerId} receipt binding drift within consumer`);
    }
    const requiredKinds = requirements.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind).sort();
    const receivedKinds = receipts.map(({ scenario }) => scenario.scenarioKind).sort();
    for (const scenarioKind of receivedKinds) if (!requiredKinds.includes(scenarioKind)) throw new Error(`${consumer.consumerId} receipt scenario is not source-required: ${scenarioKind}`);
    const complete = receiptMatrixComplete(consumer.consumerId,requiredKinds,receivedKinds,{receiptIds:receipts.map(({receiptId})=>receiptId).sort(),harnessPath:first.harness.path,fixtureId:first.fixture.fixtureId,fixturePath:first.fixture.path,targetPath:first.invocation.targetPath,exportName:first.invocation.exportName});
    const verdict: ObjectDbExecutableParityVerdict = correctiveWave15&&consumer.unresolvedDynamicCallCount>0?"BLOCKED_DYNAMIC":complete ? (first.proofMode === "DIRECT" ? "DIRECT_PASS" : "EQUIVALENT_PASS") : "PARTIAL";
    if (first.proofMode === "DIRECT" && first.equivalenceRule !== null) throw new Error(`${consumer.consumerId} DIRECT receipts cannot declare equivalenceRule`);
    if (first.proofMode === "EQUIVALENT" && first.equivalenceRule === null) throw new Error(`${consumer.consumerId} EQUIVALENT receipts require equivalenceRule`);
    return {
      consumerId: consumer.consumerId,
      classification,
      verdict,
      harness: { harnessId: first.harness.harnessId, runner: first.harness.runner, path: first.harness.path, sha256: first.harness.sourceSha256 },
      fixture: { fixtureId: first.fixture.fixtureId, path: first.fixture.path, sha256: first.fixture.sha256 },
      invocation: { ...first.invocation },
      scenarioRequirements: requirements,
      scenarios: receipts.map((receipt) => ({ receiptId: receipt.receiptId, scenarioId: receipt.scenario.scenarioId, scenarioKind: receipt.scenario.scenarioKind, harnessCaseId: receipt.harness.harnessCaseId, attributedConsumerIds: [receipt.consumerId], expectedActual: receipt.expectedActual })),
      evidence: { evidenceIds: receipts.map(({ receiptId }) => receiptId).sort(), attributedConsumerIds: [consumer.consumerId], hashes: [{ path: first.harness.path, sha256: first.harness.sourceSha256 }, { path: first.fixture.path, sha256: first.fixture.sha256 }, { path: first.invocation.targetPath, sha256: first.invocation.targetSourceSha256 }].sort((left, right) => left.path.localeCompare(right.path)) },
      equivalenceRule: first.equivalenceRule,
    };
  }).sort((left, right) => left.consumerId.localeCompare(right.consumerId));

  const verdicts = Object.fromEntries(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS.map((verdict) => [verdict, entries.filter((entry) => entry.verdict === verdict).length])) as Record<ObjectDbExecutableParityVerdict, number>;
  const coverage: ExecutableParityCoverage = {
    manifestConsumers: effectiveManifest.consumers.length, ledgerEntries: entries.length, missingConsumerIds: 0, duplicateConsumerIds: 0, unknownConsumerIds: 0,
    readConsumers: entries.filter(({ classification }) => classification.accessClass === "READ").length,
    mutationConsumers: entries.filter(({ classification }) => classification.accessClass === "MUTATION").length,
    unresolvedDynamicConsumers: entries.filter(({ classification }) => classification.unresolvedDynamicCallCount > 0).length,
    unresolvedDynamicCallCount: entries.reduce((sum, { classification }) => sum + classification.unresolvedDynamicCallCount, 0),
    registrySourceMismatchCount: manifest.audit.registrySourceMismatchCount,
    registrySourceMismatchAttributedCount: mismatchResolution.bindings.length,
    registrySourceMismatchUnattributedCount: mismatchResolution.unattributed.length,
    provenConsumers: verdicts.DIRECT_PASS + verdicts.EQUIVALENT_PASS,
    unprovenConsumers: entries.length - verdicts.DIRECT_PASS - verdicts.EQUIVALENT_PASS,
    directPassConsumers: verdicts.DIRECT_PASS, equivalentPassConsumers: verdicts.EQUIVALENT_PASS, verdicts,
  };
  const classificationSources = Object.entries(input.classificationSourceTexts).map(([path, text]) => ({ path, sha256: sha256CanonicalText(text) })).sort((left, right) => left.path.localeCompare(right.path));
  const ledger: ExecutableParityLedger = {
    format: OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT, catalogVersion: receiptBundle.catalogVersion, classificationBaseCommit: manifest.baseCommit, evidenceCommit: receiptBundle.evidenceCommit,
    sourceTextNormalization: "CRLF_AND_CR_TO_LF_BEFORE_HASH",
    sources: {
      ledgerSchema: { path: input.sourcePaths.ledgerSchema, sha256: sha256CanonicalText(input.ledgerSchemaText) },
      executionReceiptSchema: { path: input.sourcePaths.executionReceiptSchema, sha256: sha256CanonicalText(input.executionReceiptSchemaText) },
      consumerManifest: { path: input.sourcePaths.consumerManifest, sha256: sha256CanonicalText(input.consumerManifestText), consumerSetSha256: manifest.consumerSetSha256 },
      consumerIdRegistry: { path: input.sourcePaths.consumerIdRegistry, sha256: sha256CanonicalText(input.consumerIdRegistryText) },
      transitionContract: { path: input.sourcePaths.transitionContract, sha256: sha256CanonicalText(input.transitionContractText) },
      executionReceipts: { path: input.sourcePaths.executionReceipts, sha256: sha256CanonicalText(input.executionReceiptsText) },
      classificationSources,
    },
    registrySourceMismatchResolution: mismatchResolution, coverage, entries, entrySetSha256: sha256CanonicalJson(entries),
  };
  validateObjectDbConsumerExecutableParityLedger(ledger, {
    manifest,
    registry,
    evidenceFileTexts: input.evidenceFileTexts ?? {},
    executionReceiptsText: input.executionReceiptsText,
    executionReceiptsPath: input.sourcePaths.executionReceipts,
    classificationSourceTexts: input.classificationSourceTexts,
  });
  return ledger;
}

function assertExpectedActual(value: unknown, label: string, requireMatch: boolean): asserts value is ExpectedActualEvidence {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["reply", "result", "dml", "lockOrder", "transaction"], label);
  for (const key of ["reply", "result"] as const) {
    const part = value[key];
    if (!isRecord(part)) throw new Error(`${label}.${key} must be an object`);
    assertExactKeys(part, ["expectedSha256", "actualSha256", "match"], `${label}.${key}`);
    assertHash(part.expectedSha256, `${label}.${key}.expectedSha256`, true);
    assertHash(part.actualSha256, `${label}.${key}.actualSha256`, true);
    if (part.match !== null && typeof part.match !== "boolean") throw new Error(`${label}.${key}.match invalid`);
    if (requireMatch && (part.match !== true || part.expectedSha256 === null || part.actualSha256 === null)) throw new Error(`${label}.${key} is not executable PASS evidence`);
    if (requireMatch && part.expectedSha256 !== part.actualSha256) throw new Error(`${label}.${key} expected/actual hash mismatch`);
  }
  const dml = value.dml;
  if (!isRecord(dml)) throw new Error(`${label}.dml must be an object`);
  assertExactKeys(dml, ["expectedSha256", "actualSha256", "match", "expectedNormalizedStatements", "actualNormalizedStatements", "expectedRowCount", "actualRowCount"], `${label}.dml`);
  assertHash(dml.expectedSha256, `${label}.dml.expectedSha256`, true);
  assertHash(dml.actualSha256, `${label}.dml.actualSha256`, true);
  if (dml.match !== null && typeof dml.match !== "boolean") throw new Error(`${label}.dml.match invalid`);
  for (const key of ["expectedNormalizedStatements", "actualNormalizedStatements"] as const) if (dml[key] !== null) assertStringArray(dml[key], `${label}.dml.${key}`);
  for (const key of ["expectedRowCount", "actualRowCount"] as const) {
    const rowCount = dml[key];
    if (rowCount !== null && (typeof rowCount !== "number" || !Number.isSafeInteger(rowCount) || rowCount < 0)) throw new Error(`${label}.dml.${key} invalid`);
  }
  if (requireMatch && (dml.match !== true || dml.expectedSha256 === null || dml.actualSha256 === null || dml.expectedNormalizedStatements === null || dml.actualNormalizedStatements === null || dml.expectedRowCount === null || dml.actualRowCount === null)) throw new Error(`${label}.dml is not executable PASS evidence`);
  if (requireMatch && (dml.expectedSha256 !== dml.actualSha256 || JSON.stringify(dml.expectedNormalizedStatements) !== JSON.stringify(dml.actualNormalizedStatements) || dml.expectedRowCount !== dml.actualRowCount)) throw new Error(`${label}.dml expected/actual mismatch`);
  const lockOrder = value.lockOrder;
  if (!isRecord(lockOrder)) throw new Error(`${label}.lockOrder must be an object`);
  assertExactKeys(lockOrder, ["expected", "actual", "match"], `${label}.lockOrder`);
  for (const key of ["expected", "actual"] as const) {
    if (lockOrder[key] !== null) assertUniqueStrings(lockOrder[key], `${label}.lockOrder.${key}`);
  }
  if (lockOrder.match !== null && typeof lockOrder.match !== "boolean") throw new Error(`${label}.lockOrder.match invalid`);
  if (requireMatch && (lockOrder.match !== true || lockOrder.expected === null || lockOrder.actual === null)) throw new Error(`${label}.lockOrder is not executable PASS evidence`);
  if (requireMatch && JSON.stringify(lockOrder.expected) !== JSON.stringify(lockOrder.actual)) throw new Error(`${label}.lockOrder expected/actual mismatch`);
  const transaction = value.transaction;
  if (!isRecord(transaction)) throw new Error(`${label}.transaction must be an object`);
  assertExactKeys(transaction, ["expected", "actual", "match", "expectedTimeline", "actualTimeline"], `${label}.transaction`);
  const transactionModes = new Set(["READ_ONLY", "COMMIT", "ROLLBACK", null]);
  if (!transactionModes.has(transaction.expected as string | null) || !transactionModes.has(transaction.actual as string | null)) throw new Error(`${label}.transaction mode invalid`);
  if (transaction.match !== null && typeof transaction.match !== "boolean") throw new Error(`${label}.transaction.match invalid`);
  for (const key of ["expectedTimeline", "actualTimeline"] as const) if (transaction[key] !== null) assertStringArray(transaction[key], `${label}.transaction.${key}`);
  if (requireMatch && (transaction.match !== true || transaction.expected === null || transaction.actual === null || transaction.expectedTimeline === null || transaction.actualTimeline === null)) throw new Error(`${label}.transaction is not executable PASS evidence`);
  if (requireMatch && (transaction.expected !== transaction.actual || JSON.stringify(transaction.expectedTimeline) !== JSON.stringify(transaction.actualTimeline))) throw new Error(`${label}.transaction expected/actual mismatch`);
}

function assertHarness(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityHarness {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["harnessId", "runner", "path", "sha256"], label);
  for (const key of ["harnessId", "runner", "path"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.sha256, `${label}.sha256`, true);
  if (requireEvidence && (value.harnessId === null || value.runner === null || value.path === null || value.sha256 === null)) throw new Error(`${label} incomplete for PASS`);
}

function assertFixture(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityFixture {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["fixtureId", "path", "sha256"], label);
  for (const key of ["fixtureId", "path"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.sha256, `${label}.sha256`, true);
  if (requireEvidence && (value.fixtureId === null || value.path === null || value.sha256 === null)) throw new Error(`${label} incomplete for PASS`);
}

function assertInvocation(value: unknown, label: string, requireEvidence: boolean): asserts value is ParityInvocation {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertExactKeys(value, ["targetPath", "targetSourceSha256", "exportName"], label);
  for (const key of ["targetPath", "exportName"] as const) if (value[key] !== null && (typeof value[key] !== "string" || value[key].length === 0)) throw new Error(`${label}.${key} invalid`);
  assertHash(value.targetSourceSha256, `${label}.targetSourceSha256`, true);
  if (requireEvidence && (value.targetPath === null || value.targetSourceSha256 === null || value.exportName === null)) throw new Error(`${label} incomplete for receipt evidence`);
}

function validateEntryEvidence(entry: ExecutableParityLedgerEntry, manifestIds: Set<string>, evidenceFileTexts: Readonly<Record<string, string>>): void {
  const pass = PASS_VERDICTS.has(entry.verdict);
  const hasReceipts = entry.scenarios.length > 0;
  assertHarness(entry.harness, `${entry.consumerId}.harness`, hasReceipts);
  assertFixture(entry.fixture, `${entry.consumerId}.fixture`, hasReceipts);
  assertInvocation(entry.invocation, `${entry.consumerId}.invocation`, hasReceipts);
  if (!Array.isArray(entry.scenarioRequirements)) throw new Error(`${entry.consumerId}.scenarioRequirements must be an array`);
  const expectedRequirements = scenarioRequirementsFor(entry.classification as unknown as ConsumerManifestInput["consumers"][number], entry.classification.classificationSha256,entry.consumerId);
  if (JSON.stringify(entry.scenarioRequirements) !== JSON.stringify(expectedRequirements)) throw new Error(`${entry.consumerId} source-derived scenario requirement drift`);
  if (!Array.isArray(entry.scenarios)) throw new Error(`${entry.consumerId}.scenarios must be an array`);
  const scenarioIds = new Set<string>();
  const receiptIds = new Set<string>();
  const scenarioKinds = new Set<string>();
  for (const [index, scenario] of entry.scenarios.entries()) {
    if (!isRecord(scenario)) throw new Error(`${entry.consumerId}.scenarios[${index}] invalid`);
    assertExactKeys(scenario, ["receiptId", "scenarioId", "scenarioKind", "harnessCaseId", "attributedConsumerIds", "expectedActual"], `${entry.consumerId}.scenarios[${index}]`);
    if (typeof scenario.receiptId !== "string" || scenario.receiptId.length === 0 || receiptIds.has(scenario.receiptId)) throw new Error(`${entry.consumerId} duplicate/invalid receiptId`);
    receiptIds.add(scenario.receiptId);
    if (typeof scenario.scenarioId !== "string" || scenario.scenarioId.length === 0 || scenarioIds.has(scenario.scenarioId)) throw new Error(`${entry.consumerId} duplicate/invalid scenarioId`);
    scenarioIds.add(scenario.scenarioId);
    if (!new Set<string>([...OBJECT_DB_PARITY_READ_SCENARIOS, ...OBJECT_DB_PARITY_MUTATION_SCENARIOS]).has(scenario.scenarioKind) || scenarioKinds.has(scenario.scenarioKind)) throw new Error(`${entry.consumerId} duplicate/invalid scenarioKind`);
    scenarioKinds.add(scenario.scenarioKind);
    if (typeof scenario.harnessCaseId !== "string" || scenario.harnessCaseId.length === 0) throw new Error(`${entry.consumerId} invalid harnessCaseId`);
    assertSortedUniqueStrings(scenario.attributedConsumerIds, `${entry.consumerId}.scenario.attributedConsumerIds`, false);
    for (const id of scenario.attributedConsumerIds) if (!manifestIds.has(id)) throw new Error(`${entry.consumerId} scenario attributes unknown consumerId: ${id}`);
    if (JSON.stringify(scenario.attributedConsumerIds) !== JSON.stringify([entry.consumerId])) throw new Error(`${entry.consumerId} receipt scenario must bind exactly this consumer ID`);
    assertExpectedActual(scenario.expectedActual, `${entry.consumerId}.scenario.${scenario.scenarioId}.expectedActual`, true);
  }
  if (!isRecord(entry.evidence)) throw new Error(`${entry.consumerId}.evidence must be an object`);
  assertExactKeys(entry.evidence, ["evidenceIds", "attributedConsumerIds", "hashes"], `${entry.consumerId}.evidence`);
  assertSortedUniqueStrings(entry.evidence.evidenceIds, `${entry.consumerId}.evidence.evidenceIds`, !hasReceipts);
  assertSortedUniqueStrings(entry.evidence.attributedConsumerIds, `${entry.consumerId}.evidence.attributedConsumerIds`, !hasReceipts);
  for (const id of entry.evidence.attributedConsumerIds) if (!manifestIds.has(id)) throw new Error(`${entry.consumerId} evidence attributes unknown consumerId: ${id}`);
  if (!Array.isArray(entry.evidence.hashes) || (hasReceipts && entry.evidence.hashes.length !== 3) || (!hasReceipts && entry.evidence.hashes.length !== 0)) throw new Error(`${entry.consumerId}.evidence.hashes invalid`);
  const hashPaths = new Set<string>();
  for (const hash of entry.evidence.hashes) {
    if (!isRecord(hash)) throw new Error(`${entry.consumerId}.evidence.hash invalid`);
    assertExactKeys(hash, ["path", "sha256"], `${entry.consumerId}.evidence.hash`);
    if (typeof hash.path !== "string" || hash.path.length === 0 || hashPaths.has(hash.path)) throw new Error(`${entry.consumerId}.evidence.hash path invalid/duplicate`);
    hashPaths.add(hash.path);
    assertHash(hash.sha256, `${entry.consumerId}.evidence.hash.sha256`);
  }
  if (hasReceipts) {
    if (JSON.stringify(entry.evidence.attributedConsumerIds) !== JSON.stringify([entry.consumerId])) throw new Error(`${entry.consumerId} evidence must bind exactly this consumer ID`);
    if (JSON.stringify(entry.evidence.evidenceIds) !== JSON.stringify([...receiptIds].sort())) throw new Error(`${entry.consumerId} evidence IDs must equal receipt IDs`);
    const files = [
      { path: entry.harness.path!, sha256: entry.harness.sha256! },
      { path: entry.fixture.path!, sha256: entry.fixture.sha256! },
      { path: entry.invocation.targetPath!, sha256: entry.invocation.targetSourceSha256! },
    ];
    if (JSON.stringify(entry.evidence.hashes) !== JSON.stringify(files.slice().sort((left, right) => left.path.localeCompare(right.path)))) throw new Error(`${entry.consumerId} evidence hashes must equal exact harness and fixture hashes`);
    for (const file of files) {
      assertRepoRelativeEvidencePath(file.path, `${entry.consumerId} evidence path`);
      const text = evidenceFileTexts[file.path];
      if (text === undefined) throw new Error(`${entry.consumerId} executable evidence file was not supplied: ${file.path}`);
      if (sha256CanonicalText(text) !== file.sha256) throw new Error(`${entry.consumerId} executable evidence file hash drift: ${file.path}`);
    }
  }
  const requiredKinds = entry.scenarioRequirements.filter(({ disposition }) => disposition === "REQUIRED").map(({ scenarioKind }) => scenarioKind).sort();
  const receivedKinds = [...scenarioKinds].sort();
  for (const scenarioKind of receivedKinds) if (!requiredKinds.includes(scenarioKind as ObjectDbParityScenarioKind)) throw new Error(`${entry.consumerId} receipt scenario is not source-required: ${scenarioKind}`);
  const complete = receiptMatrixComplete(entry.consumerId,requiredKinds,receivedKinds,{receiptIds:[...receiptIds].sort(),harnessPath:entry.harness.path,fixtureId:entry.fixture.fixtureId,fixturePath:entry.fixture.path,targetPath:entry.invocation.targetPath,exportName:entry.invocation.exportName});
  const hasMismatch = entry.classification.registrySourceMismatchLabels.length > 0;
  const hasDynamic = entry.classification.unresolvedDynamicCallCount > 0;
  const correctiveWave15=entry.consumerId===OBJECT_DB_PARITY_WAVE15_CONSUMER_ID&&entry.scenarios.length===OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.size&&entry.scenarios.every(scenario=>OBJECT_DB_PARITY_WAVE15_RECEIPT_IDS.has(scenario.receiptId));
  if (hasMismatch && entry.verdict !== "BLOCKED_REGISTRY_MISMATCH") throw new Error(`${entry.consumerId} registry mismatch verdict must take precedence`);
  if (!hasMismatch && hasDynamic && entry.verdict !== "BLOCKED_DYNAMIC") throw new Error(`${entry.consumerId} unresolved dynamic consumer verdict drift`);
  if (!hasMismatch && !hasDynamic && !hasReceipts && entry.verdict !== "STATIC_ONLY") throw new Error(`${entry.consumerId} evidence-free static consumer verdict drift`);
  if (!hasMismatch && !hasDynamic && hasReceipts && !complete && entry.verdict !== "PARTIAL") throw new Error(`${entry.consumerId} incomplete receipt matrix must be PARTIAL`);
  if (!hasMismatch && !hasDynamic && hasReceipts && complete && !pass) throw new Error(`${entry.consumerId} complete receipt matrix must be PASS`);
  if ((hasMismatch || (hasDynamic&&!correctiveWave15)) && hasReceipts) throw new Error(`${entry.consumerId} blocked consumer must not contain execution receipts`);
  if (entry.verdict === "DIRECT_PASS" && entry.equivalenceRule !== null) throw new Error(`${entry.consumerId} DIRECT_PASS must not declare equivalenceRule`);
  if (entry.verdict !== "EQUIVALENT_PASS" && entry.equivalenceRule !== null) throw new Error(`${entry.consumerId} non-equivalent verdict must not declare equivalenceRule`);
}

export function validateObjectDbConsumerExecutableParityLedger(
  value: unknown,
  inputs?: {
    manifest: ConsumerManifestInput;
    registry: ConsumerIdRegistry;
    evidenceFileTexts?: Readonly<Record<string, string>>;
    executionReceiptsText?: string;
    executionReceiptsPath?: string;
    classificationSourceTexts?: Readonly<Record<string, string>>;
  },
): ExecutableParityLedger {
  const effectiveInputManifest = inputs === undefined ? undefined : applyCompatibleClassificationDeltas(inputs.manifest, inputs.classificationSourceTexts ?? {});
  if (!isRecord(value)) throw new Error("executable parity ledger must be an object");
  assertExactKeys(value, ["format", "catalogVersion", "classificationBaseCommit", "evidenceCommit", "sourceTextNormalization", "sources", "registrySourceMismatchResolution", "coverage", "entries", "entrySetSha256"], "ledger");
  if (value.format !== OBJECT_DB_EXECUTABLE_PARITY_LEDGER_FORMAT) throw new Error("unsupported executable parity ledger format");
  if (value.catalogVersion !== "SC-20260902-1") throw new Error("unsupported executable parity ledger catalogVersion");
  assertCommit(value.classificationBaseCommit, "classificationBaseCommit");
  assertCommit(value.evidenceCommit, "evidenceCommit");
  if (value.sourceTextNormalization !== "CRLF_AND_CR_TO_LF_BEFORE_HASH") throw new Error("unsupported source text normalization");
  if (!isRecord(value.sources)) throw new Error("sources must be an object");
  assertExactKeys(value.sources, ["ledgerSchema", "executionReceiptSchema", "consumerManifest", "consumerIdRegistry", "transitionContract", "executionReceipts", "classificationSources"], "sources");
  for (const [key, source] of Object.entries(value.sources)) {
    if (key === "classificationSources") {
      if (!Array.isArray(source)) throw new Error("sources.classificationSources invalid");
      const paths = new Set<string>();
      for (const item of source) {
        if (!isRecord(item)) throw new Error("sources.classificationSources item invalid");
        assertExactKeys(item, ["path", "sha256"], "sources.classificationSources item");
        if (typeof item.path !== "string" || item.path.length === 0 || paths.has(item.path)) throw new Error("sources.classificationSources path invalid/duplicate");
        paths.add(item.path);
        assertHash(item.sha256, "sources.classificationSources sha256");
      }
      if (JSON.stringify([...paths]) !== JSON.stringify([...paths].sort())) throw new Error("sources.classificationSources must be sorted");
      continue;
    }
    if (!isRecord(source)) throw new Error(`sources.${key} invalid`);
    const expectedKeys = key === "consumerManifest" ? ["path", "sha256", "consumerSetSha256"] : ["path", "sha256"];
    assertExactKeys(source, expectedKeys, `sources.${key}`);
    if (typeof source.path !== "string" || source.path.length === 0) throw new Error(`sources.${key}.path invalid`);
    assertHash(source.sha256, `sources.${key}.sha256`);
    if (key === "consumerManifest") assertHash(source.consumerSetSha256, "sources.consumerManifest.consumerSetSha256");
  }
  const sources = value.sources as unknown as ExecutableParityLedger["sources"];
  if (!isRecord(value.registrySourceMismatchResolution)) throw new Error("registrySourceMismatchResolution must be an object");
  assertExactKeys(value.registrySourceMismatchResolution, ["bindings", "unattributed"], "registrySourceMismatchResolution");
  if (!Array.isArray(value.registrySourceMismatchResolution.bindings)) throw new Error("registrySourceMismatchResolution.bindings invalid");
  const mismatchResolution = value.registrySourceMismatchResolution as unknown as ExecutableParityLedger["registrySourceMismatchResolution"];
  const mismatchLabels = new Set<string>();
  for (const binding of mismatchResolution.bindings) {
    if (!isRecord(binding)) throw new Error("registrySourceMismatchResolution binding invalid");
    assertExactKeys(binding, ["registrySourceMismatch", "consumerId", "sourceSpanSha256"], "registrySourceMismatchResolution binding");
    if (typeof binding.registrySourceMismatch !== "string" || typeof binding.consumerId !== "string" || mismatchLabels.has(binding.registrySourceMismatch)) throw new Error("registrySourceMismatchResolution binding duplicate/invalid");
    mismatchLabels.add(binding.registrySourceMismatch);
    assertHash(binding.sourceSpanSha256, "registrySourceMismatchResolution sourceSpanSha256");
  }
  assertSortedUniqueStrings(mismatchResolution.unattributed, "registrySourceMismatchResolution.unattributed");
  for (const label of mismatchResolution.unattributed) {
    if (mismatchLabels.has(label)) throw new Error("registry source mismatch cannot be both bound and unattributed");
    mismatchLabels.add(label);
  }
  if (inputs !== undefined && JSON.stringify([...mismatchLabels].sort()) !== JSON.stringify(inputs.manifest.audit.registrySourceMismatches.slice().sort())) throw new Error("registry source mismatch resolution coverage drift");
  if (inputs?.classificationSourceTexts !== undefined && JSON.stringify(mismatchResolution) !== JSON.stringify(deriveRegistrySourceMismatchResolution(inputs.manifest, inputs.classificationSourceTexts))) throw new Error("registry source mismatch derivation drift");
  if (!Array.isArray(value.entries)) throw new Error("entries must be an array");
  const entries = value.entries as ExecutableParityLedgerEntry[];
  const ids = entries.map(({ consumerId }) => consumerId);
  assertSortedUniqueStrings(ids, "ledger consumerIds");
  const manifestIds = effectiveInputManifest === undefined ? new Set(ids) : new Set(effectiveInputManifest.consumers.map(({ consumerId }) => consumerId));
  for (const binding of mismatchResolution.bindings) if (!manifestIds.has(binding.consumerId)) throw new Error(`registry source mismatch binds unknown consumerId: ${binding.consumerId}`);
  for (const [index, entry] of entries.entries()) {
    if (!isRecord(entry)) throw new Error(`ledger entry ${index} invalid`);
    assertExactKeys(entry, ["consumerId", "classification", "verdict", "harness", "fixture", "invocation", "scenarioRequirements", "scenarios", "evidence", "equivalenceRule"], `entry ${index}`);
    if (typeof entry.consumerId !== "string" || !CONSUMER_ID_PATTERN.test(entry.consumerId)) throw new Error(`entry ${index} consumerId invalid`);
    if (!VERDICTS.has(entry.verdict)) throw new Error(`${entry.consumerId} verdict invalid`);
    if (!isRecord(entry.classification)) throw new Error(`${entry.consumerId}.classification invalid`);
    assertExactKeys(entry.classification, ["kind", "file", "symbol", "triggerOrPredicate", "access", "accessClass", "interfaceId", "unresolvedDynamicCallCount", "registrySourceMismatchLabels", "sourceSpanSha256", "classificationSha256"], `${entry.consumerId}.classification`);
    const classification = entry.classification;
    for (const key of ["kind", "file", "symbol", "triggerOrPredicate", "interfaceId"] as const) if (typeof classification[key] !== "string" || classification[key].length === 0) throw new Error(`${entry.consumerId}.classification.${key} invalid`);
    if (!new Set(["READ", "WRITE", "READ_WRITE"]).has(classification.access as string)) throw new Error(`${entry.consumerId}.classification.access invalid`);
    if (classification.accessClass !== (classification.access === "READ" ? "READ" : "MUTATION")) throw new Error(`${entry.consumerId}.classification.accessClass drift`);
    if (!Number.isSafeInteger(classification.unresolvedDynamicCallCount) || classification.unresolvedDynamicCallCount < 0) throw new Error(`${entry.consumerId}.classification.unresolvedDynamicCallCount invalid`);
    assertSortedUniqueStrings(classification.registrySourceMismatchLabels, `${entry.consumerId}.classification.registrySourceMismatchLabels`);
    const expectedMismatchLabels = mismatchResolution.bindings.filter(({ consumerId }) => consumerId === entry.consumerId).map(({ registrySourceMismatch }) => registrySourceMismatch).sort();
    if (JSON.stringify(classification.registrySourceMismatchLabels) !== JSON.stringify(expectedMismatchLabels)) throw new Error(`${entry.consumerId} registry source mismatch binding drift`);
    assertHash(classification.sourceSpanSha256, `${entry.consumerId}.classification.sourceSpanSha256`);
    const { classificationSha256, ...projection } = classification;
    assertHash(classificationSha256, `${entry.consumerId}.classification.classificationSha256`);
    if (sha256CanonicalJson(projection) !== classificationSha256) throw new Error(`${entry.consumerId} classification drift`);
    if (entry.verdict === "STATIC_ONLY" && classification.unresolvedDynamicCallCount > 0) throw new Error(`${entry.consumerId} dynamic consumer cannot be STATIC_ONLY`);
    if (entry.verdict === "BLOCKED_DYNAMIC" && classification.unresolvedDynamicCallCount === 0) throw new Error(`${entry.consumerId} static consumer cannot be BLOCKED_DYNAMIC`);
    validateEntryEvidence(entry, manifestIds, inputs?.evidenceFileTexts ?? {});
  }
  for (const entry of entries.filter(({ verdict }) => verdict === "EQUIVALENT_PASS")) {
    const rule = entry.equivalenceRule;
    if (!isRecord(rule)) throw new Error(`${entry.consumerId} EQUIVALENT_PASS requires mechanical equivalenceRule`);
    assertExactKeys(rule, ["ruleId", "ruleVersion", "mechanical", "equivalenceKey", "variantConsumerIds"], `${entry.consumerId}.equivalenceRule`);
    if (rule.ruleId !== "SAME_INTERFACE_ACCESS_V1" && rule.ruleId !== "ROCKET_PARAMETER_PROJECTION_V1" && rule.ruleId !== "SLOT_NEWBIE_PARAMETER_PROJECTION_V1") throw new Error(`${entry.consumerId} unsupported mechanical equivalence rule`);
    if(rule.ruleVersion!=="1")throw new Error(`${entry.consumerId} unsupported mechanical equivalence rule version`);
    if (typeof rule.equivalenceKey !== "string" || rule.equivalenceKey.length === 0) throw new Error(`${entry.consumerId}.equivalenceRule.equivalenceKey invalid`);
    if (rule.mechanical !== true) throw new Error(`${entry.consumerId} equivalence must be mechanical`);
    assertSortedUniqueStrings(rule.variantConsumerIds, `${entry.consumerId}.equivalenceRule.variantConsumerIds`, false);
    if (!rule.variantConsumerIds.includes(entry.consumerId)) throw new Error(`${entry.consumerId} equivalence variants omit self`);
    if(rule.ruleId==="ROCKET_PARAMETER_PROJECTION_V1"){
      assertHash(rule.equivalenceKey,`${entry.consumerId}.equivalenceRule.equivalenceKey`);
      if(JSON.stringify(rule.variantConsumerIds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS))throw new Error(`${entry.consumerId} Wave26 equivalence variants drift`);
      const representative=entries.find(({consumerId})=>consumerId===OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID);
      if(representative?.verdict!=="DIRECT_PASS"||representative.equivalenceRule!==null||representative.scenarios.length!==7||!representative.scenarios.every(scenario=>scenario.receiptId.startsWith(`receipt:wave26:${OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID}:`)))throw new Error(`${entry.consumerId} Wave26 representative DIRECT proof drift`);
      for(const variantId of OBJECT_DB_PARITY_WAVE26_CONSUMER_IDS.filter(id=>id!==OBJECT_DB_PARITY_WAVE26_REPRESENTATIVE_ID)){
        const variant=entries.find(({consumerId})=>consumerId===variantId);
        if(variant?.verdict!=="EQUIVALENT_PASS"||variant.equivalenceRule?.ruleId!==rule.ruleId||variant.equivalenceRule.equivalenceKey!==rule.equivalenceKey||JSON.stringify(variant.equivalenceRule.variantConsumerIds)!==JSON.stringify(rule.variantConsumerIds)||variant.scenarios.length!==7||!variant.scenarios.every(scenario=>scenario.receiptId.startsWith(`receipt:wave26:${variantId}:`)))throw new Error(`${entry.consumerId} Wave26 equivalence rule lacks sealed variant: ${variantId}`);
      }
      continue;
    }
    if(rule.ruleId==="SLOT_NEWBIE_PARAMETER_PROJECTION_V1"){
      assertHash(rule.equivalenceKey,`${entry.consumerId}.equivalenceRule.equivalenceKey`);
      if(JSON.stringify(rule.variantConsumerIds)!==JSON.stringify(OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS))throw new Error(`${entry.consumerId} Wave27 equivalence variants drift`);
      const representative=entries.find(({consumerId})=>consumerId===OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID);
      if(representative?.verdict!=="DIRECT_PASS"||representative.equivalenceRule!==null||representative.scenarios.length!==7||!representative.scenarios.every(scenario=>scenario.receiptId.startsWith(`receipt:wave27:${OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID}:`)))throw new Error(`${entry.consumerId} Wave27 representative DIRECT proof drift`);
      for(const variantId of OBJECT_DB_PARITY_WAVE27_CONSUMER_IDS.filter(id=>id!==OBJECT_DB_PARITY_WAVE27_REPRESENTATIVE_ID)){
        const variant=entries.find(({consumerId})=>consumerId===variantId);
        if(variant?.verdict!=="EQUIVALENT_PASS"||variant.equivalenceRule?.ruleId!==rule.ruleId||variant.equivalenceRule.equivalenceKey!==rule.equivalenceKey||JSON.stringify(variant.equivalenceRule.variantConsumerIds)!==JSON.stringify(rule.variantConsumerIds)||variant.scenarios.length!==7||!variant.scenarios.every(scenario=>scenario.receiptId.startsWith(`receipt:wave27:${variantId}:`)))throw new Error(`${entry.consumerId} Wave27 equivalence rule lacks sealed variant: ${variantId}`);
      }
      continue;
    }
    const expectedEquivalenceKey = deriveSameInterfaceAccessEquivalenceKey(entry.classification);
    if (rule.equivalenceKey !== expectedEquivalenceKey) throw new Error(`${entry.consumerId} mechanical equivalence key drift`);
    const expectedVariantIds = entries
      .filter(({ classification }) => classification.interfaceId === entry.classification.interfaceId && classification.accessClass === entry.classification.accessClass)
      .map(({ consumerId }) => consumerId)
      .sort();
    if (expectedVariantIds.length < 2 || JSON.stringify(rule.variantConsumerIds) !== JSON.stringify(expectedVariantIds)) throw new Error(`${entry.consumerId} mechanical equivalence rule does not enumerate all ID variants`);
    for (const variantId of rule.variantConsumerIds) {
      const variant = entries.find(({ consumerId }) => consumerId === variantId);
      if (variant?.verdict !== "EQUIVALENT_PASS" || variant.equivalenceRule?.ruleId !== rule.ruleId || JSON.stringify(variant.equivalenceRule.variantConsumerIds) !== JSON.stringify(rule.variantConsumerIds)) {
        throw new Error(`${entry.consumerId} equivalence rule lacks all proven ID variants: ${variantId}`);
      }
    }
  }
  assertHash(value.entrySetSha256, "entrySetSha256");
  if (sha256CanonicalJson(entries) !== value.entrySetSha256) throw new Error("entrySetSha256 drift");
  if (!isRecord(value.coverage)) throw new Error("coverage must be an object");
  const coverageKeys = ["manifestConsumers", "ledgerEntries", "missingConsumerIds", "duplicateConsumerIds", "unknownConsumerIds", "readConsumers", "mutationConsumers", "unresolvedDynamicConsumers", "unresolvedDynamicCallCount", "registrySourceMismatchCount", "registrySourceMismatchAttributedCount", "registrySourceMismatchUnattributedCount", "provenConsumers", "unprovenConsumers", "directPassConsumers", "equivalentPassConsumers", "verdicts"];
  assertExactKeys(value.coverage, coverageKeys, "coverage");
  const coverage = value.coverage as unknown as ExecutableParityCoverage;
  const verdicts = Object.fromEntries(OBJECT_DB_EXECUTABLE_PARITY_VERDICTS.map((verdict) => [verdict, entries.filter((entry) => entry.verdict === verdict).length])) as Record<ObjectDbExecutableParityVerdict, number>;
  const calculated: ExecutableParityCoverage = {
    manifestConsumers: effectiveInputManifest?.consumers.length ?? entries.length,
    ledgerEntries: entries.length,
    missingConsumerIds: inputs === undefined ? 0 : [...manifestIds].filter((id) => !ids.includes(id)).length,
    duplicateConsumerIds: ids.length - new Set(ids).size,
    unknownConsumerIds: inputs === undefined ? 0 : ids.filter((id) => !manifestIds.has(id)).length,
    readConsumers: entries.filter(({ classification }) => classification.accessClass === "READ").length,
    mutationConsumers: entries.filter(({ classification }) => classification.accessClass === "MUTATION").length,
    unresolvedDynamicConsumers: entries.filter(({ classification }) => classification.unresolvedDynamicCallCount > 0).length,
    unresolvedDynamicCallCount: entries.reduce((sum, { classification }) => sum + classification.unresolvedDynamicCallCount, 0),
    registrySourceMismatchCount: inputs?.manifest.audit.registrySourceMismatchCount ?? coverage.registrySourceMismatchCount,
    registrySourceMismatchAttributedCount: mismatchResolution.bindings.length,
    registrySourceMismatchUnattributedCount: mismatchResolution.unattributed.length,
    provenConsumers: verdicts.DIRECT_PASS + verdicts.EQUIVALENT_PASS,
    unprovenConsumers: entries.length - verdicts.DIRECT_PASS - verdicts.EQUIVALENT_PASS,
    directPassConsumers: verdicts.DIRECT_PASS,
    equivalentPassConsumers: verdicts.EQUIVALENT_PASS,
    verdicts,
  };
  if (JSON.stringify(coverage) !== JSON.stringify(calculated)) throw new Error("coverage drift");
  if (coverage.missingConsumerIds !== 0 || coverage.duplicateConsumerIds !== 0 || coverage.unknownConsumerIds !== 0) throw new Error("ledger must join consumer manifest exactly 1:1");
  if (inputs !== undefined) {
    if (value.classificationBaseCommit !== inputs.manifest.baseCommit || sources.consumerManifest.consumerSetSha256 !== inputs.manifest.consumerSetSha256) throw new Error("classification provenance drift");
    const resolveStableId = createConsumerIdResolver(parseConsumerIdRegistry(inputs.registry, inputs.manifest.baseCommit));
    const byId = new Map(entries.map((entry) => [entry.consumerId, entry]));
    for (const consumer of effectiveInputManifest!.consumers) {
      if (resolveStableId(consumer) !== consumer.consumerId) throw new Error(`stable ID drift: ${consumer.consumerId}`);
      const entry = byId.get(consumer.consumerId);
      const sourceMismatchLabels = mismatchResolution.bindings.filter(({ consumerId }) => consumerId === consumer.consumerId).map(({ registrySourceMismatch }) => registrySourceMismatch);
      if (entry === undefined || JSON.stringify(entry.classification) !== JSON.stringify(classificationProjection(consumer, sourceMismatchLabels))) throw new Error(`consumer classification join drift: ${consumer.consumerId}`);
    }
    if (inputs.executionReceiptsText !== undefined) {
      if (inputs.executionReceiptsPath === undefined) throw new Error("executionReceiptsPath is required with executionReceiptsText");
      const bundle = parseObjectDbConsumerExecutionReceiptBundle(JSON.parse(canonicalizeObjectDbConsumerSourceText(inputs.executionReceiptsText)));
      if (bundle.classificationBaseCommit !== value.classificationBaseCommit || bundle.evidenceCommit !== value.evidenceCommit || bundle.catalogVersion !== value.catalogVersion) throw new Error("execution receipt bundle provenance drift");
      const ledgerReceiptIds = new Set(entries.flatMap(({ scenarios }) => scenarios.map(({ receiptId }) => receiptId)));
      const bundleReceiptIds = new Set<string>();
      const seenBundleReceiptIds = new Set<string>();
      for (const rawReceipt of bundle.receipts) {
        const receipt = validateExecutionReceipt(rawReceipt, new Map(effectiveInputManifest!.consumers.map((consumer) => [consumer.consumerId, consumer])), inputs.evidenceFileTexts ?? {}, inputs.executionReceiptsPath, bundle.evidenceCommit);
        if (seenBundleReceiptIds.has(receipt.receiptId)) throw new Error(`duplicate execution receiptId: ${receipt.receiptId}`);
        seenBundleReceiptIds.add(receipt.receiptId);
        if (receipt.consumerId === "admin-command-5e04d0767d4c2abc" && !receipt.receiptId.startsWith("receipt:wave13:")) continue;
        if(receipt.consumerId==="sql-repository-3001ad9fc2f36d01"&&receipt.receiptId.startsWith("receipt:wave6:")&&effectiveInputManifest!.consumers.find(consumer=>consumer.consumerId===receipt.consumerId)?.sourceSpan.sha256!=="b19de38cf45d65786fa679411313cf3249c159d685af0a4b6c64b4e565656144")continue;
        bundleReceiptIds.add(receipt.receiptId);
        const entry = byId.get(receipt.consumerId);
        const scenario = entry?.scenarios.find(({ receiptId }) => receiptId === receipt.receiptId);
        const expectedScenario: ParityScenario = {
          receiptId: receipt.receiptId,
          scenarioId: receipt.scenario.scenarioId,
          scenarioKind: receipt.scenario.scenarioKind,
          harnessCaseId: receipt.harness.harnessCaseId,
          attributedConsumerIds: [receipt.consumerId],
          expectedActual: receipt.expectedActual,
        };
        if (entry === undefined || scenario === undefined || JSON.stringify(scenario) !== JSON.stringify(expectedScenario)) throw new Error(`${receipt.receiptId} receipt-to-ledger scenario binding drift`);
        if (entry.harness.harnessId !== receipt.harness.harnessId || entry.harness.path !== receipt.harness.path || entry.harness.sha256 !== receipt.harness.sourceSha256 || entry.fixture.fixtureId !== receipt.fixture.fixtureId || entry.fixture.path !== receipt.fixture.path || entry.fixture.sha256 !== receipt.fixture.sha256 || JSON.stringify(entry.invocation) !== JSON.stringify(receipt.invocation)) throw new Error(`${receipt.receiptId} receipt-to-ledger harness/fixture/invocation binding drift`);
        if (receipt.proofMode === "EQUIVALENT" && JSON.stringify(entry.equivalenceRule) !== JSON.stringify(receipt.equivalenceRule)) throw new Error(`${receipt.receiptId} receipt-to-ledger equivalence drift`);
      }
      if (JSON.stringify([...ledgerReceiptIds].sort()) !== JSON.stringify([...bundleReceiptIds].sort())) throw new Error("receipt bundle and ledger receipt set drift");
    }
  }
  return value as unknown as ExecutableParityLedger;
}
