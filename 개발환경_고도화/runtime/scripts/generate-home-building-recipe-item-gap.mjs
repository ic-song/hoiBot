import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogVersion = "ASSET-FREEZE-v2.400-a286279b-01";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/home-building-recipe-item-crosswalk-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/394_home_building_recipe_item_gap.sql");

const sourceFiles = {
  home: ["data/petSweetHomeInfo.json", "73c93af3f0a5d52e4539047a21ce0d08f33603275ca542974eb11f47f93b2195"],
  trial: ["data/trialTowerBoss.json", "d18ecd4d5a032f045bacfc1087e171a326f84979e60ce403447211ae6d65fa76"],
  itemList: ["data/itemList.json", "915a5d8ba8ba19c78da124881a617514b1c0c56434af61d4db8bac0ccdb70e5f"],
  castle: ["data/castleBattle2.json", "5d840ce6417f371a0b0109af13e4895942cf027438fda24e8e8520c4048171be"]
};

const definitions = [
  {
    legacyName: "돌멩이🪨",
    definitionCode: "ITEM-RWD-041",
    objectKey: "item.home_material.stone",
    decision: "REUSE_ACTIVATE",
    expectedHomeRows: 300,
    expectedTrialRows: 88,
    expectedCastleRows: 0
  },
  {
    legacyName: "반지 강화석💍",
    definitionCode: "ITEM-RING-UPGRADE-STONE",
    objectKey: "item.ring.upgrade_stone",
    decision: "CREATE",
    expectedHomeRows: 300,
    expectedTrialRows: 1,
    expectedCastleRows: 0
  },
  {
    legacyName: "캐슬코인🥇",
    definitionCode: "castle_coin",
    objectKey: "item.castle.coin",
    decision: "REUSE_ACTIVE",
    expectedHomeRows: 300,
    expectedTrialRows: 1,
    expectedCastleRows: 24
  },
  {
    legacyName: "전설의 돌맹이🗿",
    definitionCode: "ITEM-RWD-052",
    objectKey: "item.material.legendary_stone",
    decision: "REUSE_ACTIVE",
    expectedHomeRows: 251,
    expectedTrialRows: 1,
    expectedCastleRows: 0,
    consumerCorrectionDependency: "inventory.open_all:legendary_stone->ITEM-RWD-052"
  }
];

const loaded = {};
for (const [key, [relativePath, expectedHash]] of Object.entries(sourceFiles)) {
  const raw = fs.readFileSync(path.join(repoRoot, relativePath));
  const actualHash = sha256(raw);
  if (actualHash !== expectedHash) throw new Error(`SOURCE_DRIFT:${key}:${actualHash}`);
  loaded[key] = JSON.parse(raw.toString("utf8"));
}

const homeRows = loaded.home.homeInfo;
const trialRewards = loaded.trial.flatMap((boss) => boss.reward ?? []);
const castleRewards = Object.values(loaded.castle.rank).flatMap((rank) => rank.rewards?.items ?? []);
if (homeRows.length !== 300) throw new Error(`HOME_ROW_DRIFT:${homeRows.length}`);

const rows = definitions.map((definition) => {
  const homeMatches = homeRows.flatMap((home, sourceIndex) =>
    (home.required ?? []).filter((required) => required.item === definition.legacyName)
      .map((required) => ({ sourceIndex, floor: home.floor, count: required.count }))
  );
  const trialMatches = trialRewards.filter((reward) => reward.item === definition.legacyName);
  const castleMatches = castleRewards.filter((reward) => reward.name === definition.legacyName);
  const inNonItems = loaded.itemList.nonItems.includes(definition.legacyName);
  const inUntradable = loaded.itemList.untradableList.includes(definition.legacyName);
  if (homeMatches.length !== definition.expectedHomeRows) throw new Error(`HOME_USAGE_DRIFT:${definition.definitionCode}:${homeMatches.length}`);
  if (trialMatches.length !== definition.expectedTrialRows) throw new Error(`TRIAL_USAGE_DRIFT:${definition.definitionCode}:${trialMatches.length}`);
  if (castleMatches.length !== definition.expectedCastleRows) throw new Error(`CASTLE_USAGE_DRIFT:${definition.definitionCode}:${castleMatches.length}`);

  const sourceBindings = [
    { system: "RUNTIME_DB", table: "item_definitions", key: definition.definitionCode },
    { system: "LEGACY_JSON", table: "petSweetHomeInfo.homeInfo.required", key: definition.legacyName },
    ...(trialMatches.length > 0 ? [{ system: "LEGACY_JSON", table: "trialTowerBoss.reward", key: definition.legacyName }] : []),
    ...(castleMatches.length > 0 ? [{ system: "LEGACY_JSON", table: "castleBattle2.rank.rewards.items", key: definition.legacyName }] : []),
    ...(inNonItems ? [{ system: "LEGACY_JSON", table: "itemList.nonItems", key: definition.legacyName }] : []),
    ...(inUntradable ? [{ system: "LEGACY_JSON", table: "itemList.untradableList", key: definition.legacyName }] : [])
  ];
  const counts = homeMatches.map((match) => match.count);
  return {
    ...definition,
    ownershipModel: "STACK",
    sellable: false,
    homeRecipe: {
      occurrenceCount: homeMatches.length,
      minCount: Math.min(...counts),
      maxCount: Math.max(...counts),
      uniqueCounts: [...new Set(counts)].sort((left, right) => left - right)
    },
    otherConsumers: {
      trialTowerRewardRows: trialMatches.length,
      castleBattleRewardRows: castleMatches.length,
      itemListNonItems: inNonItems,
      itemListUntradable: inUntradable
    },
    sourceBindings,
    sourceHashes: Object.fromEntries(Object.entries(sourceFiles).map(([key, value]) => [key, value[1]])),
    catalogVersion
  };
});

if (new Set(rows.map((row) => row.definitionCode)).size !== 4) throw new Error("DEFINITION_COLLISION");
if (new Set(rows.map((row) => row.objectKey)).size !== 4) throw new Error("OBJECT_COLLISION");
if (rows.filter((row) => row.decision.startsWith("REUSE")).length !== 3) throw new Error("REUSE_COUNT_DRIFT");
if (rows.filter((row) => row.decision === "CREATE").length !== 1) throw new Error("CREATE_COUNT_DRIFT");

fs.writeFileSync(fixturePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(rows), "utf8");

console.log(JSON.stringify({
  source: rows.length,
  reused: 3,
  created: 1,
  objects: 4,
  aliases: 4,
  sourceBindings: rows.reduce((sum, row) => sum + row.sourceBindings.length, 0),
  homeRecipeRows: rows.reduce((sum, row) => sum + row.homeRecipe.occurrenceCount, 0),
  crosswalkHash: sha256(rows.map((row) => `${row.legacyName}\t${row.definitionCode}\t${row.objectKey}\t${row.decision}`).join("\n"))
}));

function buildMigration(catalogRows) {
  const ring = catalogRows.find((row) => row.decision === "CREATE");
  const metadata = (row) => JSON.stringify({
    domain: "home_building_recipe",
    definitionCode: row.definitionCode,
    ownershipModel: row.ownershipModel,
    homeRecipe: row.homeRecipe,
    otherConsumers: row.otherConsumers,
    consumerCorrectionDependency: row.consumerCorrectionDependency ?? null,
    catalogVersion
  });
  const objectValues = catalogRows.map((row) =>
    `(${sql(row.objectKey)},'ITEM',${sql(row.legacyName)},1,TRUE,JSON_EXTRACT(${sql(metadata(row))},'$'))`
  ).join(",\n");
  const aliasSelect = catalogRows.map((row) =>
    `SELECT id,object_type,'legacy_name',${sql(row.legacyName)} FROM object_registry WHERE object_key=${sql(row.objectKey)}`
  ).join("\nUNION ALL\n");
  const sourceSelect = catalogRows.flatMap((row) => row.sourceBindings.map((binding) =>
    `SELECT id,object_type,${sql(binding.system)},${sql(binding.table)},${sql(binding.key)} FROM object_registry WHERE object_key=${sql(row.objectKey)}`
  )).join("\nUNION ALL\n");
  const policySelect = catalogRows.map((row) =>
    `SELECT id,FALSE,0.000,'home-recipe-item-gap-v1',1 FROM item_definitions WHERE code=${sql(row.definitionCode)}`
  ).join("\nUNION ALL\n");

  return `START TRANSACTION;\n\n` +
    `UPDATE item_definitions\nSET display_name='돌멩이🪨',asset_type_code='STACK',stackable=TRUE,active=TRUE,\n` +
    `  metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),JSON_OBJECT('homeRecipeCatalogVersion',${sql(catalogVersion)}))\n` +
    `WHERE code='ITEM-RWD-041';\n\n` +
    `INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES\n` +
    `(${sql(ring.definitionCode)},${sql(ring.legacyName)},'STACK',TRUE,JSON_OBJECT('domain','home_building_recipe','homeRecipeCatalogVersion',${sql(catalogVersion)}),TRUE,1)\n` +
    `ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),asset_type_code='STACK',stackable=TRUE,active=TRUE,\n` +
    `  metadata_json=JSON_MERGE_PATCH(COALESCE(item_definitions.metadata_json,JSON_OBJECT()),VALUES(metadata_json));\n\n` +
    `UPDATE item_definitions\nSET active=TRUE,metadata_json=JSON_MERGE_PATCH(COALESCE(metadata_json,JSON_OBJECT()),JSON_OBJECT('homeRecipeCatalogVersion',${sql(catalogVersion)}))\n` +
    `WHERE code IN ('castle_coin','ITEM-RWD-052');\n\n` +
    `INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES\n${objectValues}\n` +
    `ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),active=TRUE,metadata_json=VALUES(metadata_json);\n\n` +
    `INSERT IGNORE INTO object_aliases(object_id,object_type,alias_type,alias_value)\n${aliasSelect};\n\n` +
    `INSERT IGNORE INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)\n${sourceSelect};\n\n` +
    `INSERT INTO item_sale_policies(item_id,sellable,unit_price,source_code,row_version)\n${policySelect}\n` +
    `ON DUPLICATE KEY UPDATE sellable=FALSE,source_code=VALUES(source_code),row_version=item_sale_policies.row_version;\n\n` +
    `COMMIT;\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sql(value) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
