import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const catalogVersion = "ASSET-FREEZE-v2.400-a286279b-01";
const expectedSourceHash = "10b21ddf32092b4b2c4450664694644f89bcb9991bc0bae436d9582fcad13d6a";

const reused = new Map(Object.entries({
  "1달러스토어🤑(/1일1후원)": ["one_dollar_store_package", true],
  "가구귀속해제권🛋️(/가구해제 숫자)": ["ITEM-HOME-FURNITURE-UNBIND-TICKET", true],
  "강화확률뽑기⚒️(/강화뽑기)": ["ITEM-RWD-016", false],
  "경찰과 도둑🚨(/삐뽀삐뽀)": ["police_thief_ticket", true],
  "고급 티어 승급티켓🎫": ["tier_advanced_ticket", true],
  "극락상자👹": ["ITEM-PACKAGE-207", false],
  "길드공헌훈장🌟(/길드공헌 숫자)": ["guild_contribution_medal", true],
  "길드창고패키지🧳(/길드창고패키지오픈)": ["ITEM-PACKAGE-088", false],
  "나락상자👹": ["ITEM-PACKAGE-208", false],
  "도파민패키지🤩[1](/도파민오픈1)": ["ITEM-PACKAGE-097", false],
  "도파민패키지🤩[2](/도파민오픈2)": ["ITEM-PACKAGE-098", false],
  "땅문서📜": ["land_document", true],
  "랜덤박스💝": ["ITEM-PACKAGE-214", false],
  "미니펫 강화석💫": ["mini_pet_enhance_stone", true, "미니펫 강화석"],
  "미니펫강화석패키지💫(/미강오픈)": ["mini_pet_enhance_stone_package", true],
  "미니펫귀속해제권🐰(/귀속해제)": ["ITEM-MINI-PET-UNBIND-TICKET", true],
  "미니펫대전리셋권🐹": ["ITEM-MINI-PET-DUEL-RESET-TICKET", true],
  "미니펫뽑기🐹(/미니펫오픈)": ["mini_pet_draw", true],
  "보물지도🗺️": ["ITEM-RWD-034", false],
  "복주머니🧧": ["ITEM-FORTUNE-POUCH", true],
  "부방상여패키지3(/고생하셨습니다)": ["ITEM-PACKAGE-078", false],
  "시련의상자😈(/시련오픈)": ["ITEM-PACKAGE-TRIAL-BOX", false],
  "양념치킨🐔": ["legacy-seasoned-chicken", true],
  "우표💌": ["LETTER_STAMP", true],
  "잡템☠️": ["junk", true],
  "잡템상자☠": ["ITEM-RWD-TRASH-BOX", true],
  "전설의돌 뽑기🩶[2](/전돌뽑기 숫자)": ["ITEM-LEGENDARY-STONE-DRAW-TICKET", true],
  "정령 강화석🥀": ["ITEM-ELEMENTAL-UPGRADE-STONE", true],
  "정령 이름변경권📝(/정령이름)": ["legacy-spirit-name-change-ticket", true],
  "정령상자🥀": ["ITEM-RWD-RANDOM-SPIRIT-BOX", false],
  "정령조각🥀": ["spirit_fragment", true],
  "주간상자🌼": ["ITEM-RWD-048", false],
  "주사위🎲(/해피)": ["ITEM-RWD-HAPPY-DICE", false],
  "초보자 스타터패키지🌟[1](/초보오픈1)": ["ITEM-PACKAGE-157", false],
  "초보자 스타터패키지🌟[2](/초보오픈2)": ["ITEM-PACKAGE-158", false],
  "초보자 스타터패키지🌟[3](/초보오픈3)": ["ITEM-PACKAGE-159", false],
  "초보자 스타터패키지🌟[4](/초보오픈4)": ["ITEM-PACKAGE-160", false],
  "초보자 스타터패키지🌟[5](/초보오픈5)": ["ITEM-PACKAGE-161", false],
  "초보자 스타터패키지🌟[6](/초보오픈6)": ["ITEM-PACKAGE-162", false],
  "치킨상자🐔": ["ITEM-PACKAGE-CHICKEN-BOX", true],
  "캐슬대전리셋권🐶": ["legacy-castle-battle-reset-ticket", true],
  "컬렉션창세패키지🐹(/컬렉션창세오픈)": ["ITEM-PACKAGE-165", false],
  "컬렉션창조패키지🐹(/컬렉션창조오픈)": ["ITEM-PACKAGE-166", false],
  "태초야키토리 10세트🥩(/이랏싸이마쎄)": ["ITEM-PACKAGE-206", false],
  "티어 승급티켓🎟": ["ITEM-RWD-022", true],
  "펫 강화석⭐": ["pet_enhance_stone", true],
  "펫던전 입장권🌋": ["ITEM-PET-DUNGEON-ENTRY-TICKET", true],
  "펫먹이상자📦(/상자오픈)": ["ITEM-RWD-PET-FOOD-BOX", true],
  "펫먹이특식🥡(/특식오픈)": ["pet_food_special", true],
  "펫먹이🍼": ["pet_food", true],
  "펫스윗홈인테리어샵🖼️(/샵오픈)": ["ITEM-RWD-001", true],
  "펫스윗홈패키지🏡[2](/홈패키지오픈2)": ["ITEM-PACKAGE-201", false],
  "펫탐험패키지⛰️[1](/펫탐험오픈1)": ["ITEM-PACKAGE-186", false],
  "할로윈패키지🎃1(/해피할로윈오픈시펫외형이바뀝니다안에는어마어마한상품이있습니다)": ["ITEM-PACKAGE-188", false],
  "호이베이스볼⚾️(/투수던집니다)": ["ITEM-RWD-014", true],
  "호이응원패키지(무료)🐹[2]": ["ITEM-FREE-HOI-SUPPORT-02", true],
  "호이지갑👛(/지갑털기)": ["ITEM-HOI-WALLET", true],
  "환생버섯🍄": ["ITEM-RWD-015", false],
  "황제패키지👑[3](/황제패키지오픈3)": ["ITEM-PACKAGE-204", false],
  "👻루키 상자(/루키오픈)": ["ITEM-PACKAGE-210", false],
  "💎다이아 상자(/다이아오픈)": ["ITEM-PACKAGE-213", false],
  "💠루비 상자(/루비오픈)": ["ITEM-PACKAGE-209", false],
  "🔥에이스 상자(/에이스오픈)": ["castle_ace_box", false],
  "🔮마스터 상자(/마스터오픈)": ["ITEM-PACKAGE-211", false],
  "🪬올마이티 상자(/올마이티오픈)": ["castle_almighty_box", false],
  "🪽엠퍼러 상자(/엠퍼러오픈)": ["castle_emperor_box", false]
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const mainPath = path.join(repoRoot, "main.js");
const fixturePath = path.join(repoRoot, "개발환경_고도화/migration-control/fixtures/synthetic-relational/direct-bag-stack-crosswalk-v1.json");
const migrationPath = path.join(repoRoot, "개발환경_고도화/runtime/migrations/391_direct_bag_stack_definition_seed.sql");

const sourceLines = fs.readFileSync(mainPath, "utf8").split(/\r?\n/);
const occurrences = new Map();
const patterns = [/\.bag\s*\[\s*"((?:\\.|[^"\\])*)"\s*\]/g, /\.bag\s*\[\s*'((?:\\.|[^'\\])*)'\s*\]/g];
for (let index = 0; index < sourceLines.length; index += 1) {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(sourceLines[index])) !== null) {
      const name = match[1];
      const lines = occurrences.get(name) ?? [];
      lines.push(index + 1);
      occurrences.set(name, lines);
    }
  }
}

const names = [...occurrences.keys()].sort();
const sourceHash = sha256(names.join("\n"));
if (names.length !== 182 || sourceHash !== expectedSourceHash) {
  throw new Error(`DIRECT_BAG_SOURCE_DRIFT:${names.length}:${sourceHash}`);
}

const rows = names.map((legacyName, sourceIndex) => {
  const hash = sha256(legacyName).slice(0, 16);
  const reusedRow = reused.get(legacyName);
  const definitionCode = reusedRow?.[0] ?? `legacy_bag_${hash}`;
  const definitionActive = reusedRow?.[1] ?? true;
  const definitionDisplayName = reusedRow?.[2] ?? legacyName;
  return {
    sourceIndex,
    sourceKey: `bag_${String(sourceIndex).padStart(3, "0")}`,
    objectKey: `item.direct_bag.${hash}`,
    definitionCode,
    definitionDisplayName,
    legacyName,
    occurrenceCount: occurrences.get(legacyName).length,
    sourceLines: occurrences.get(legacyName),
    sourceHash,
    reusedExisting: reusedRow !== undefined,
    definitionActive,
    displayDrift: definitionDisplayName !== legacyName,
    ownershipModel: "STACK",
    catalogVersion
  };
});

if (rows.filter((row) => row.reusedExisting).length !== 66 || rows.filter((row) => !row.reusedExisting).length !== 116) {
  throw new Error("DIRECT_BAG_REUSE_COUNT_DRIFT");
}
if (rows.reduce((sum, row) => sum + row.occurrenceCount, 0) !== 689) throw new Error("DIRECT_BAG_OCCURRENCE_DRIFT");

fs.writeFileSync(fixturePath, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
fs.writeFileSync(migrationPath, buildMigration(rows), "utf8");

const crosswalkHash = sha256(rows.map((row) => `${row.legacyName}\t${row.definitionCode}\t${row.reusedExisting}\t${row.definitionActive}`).join("\n"));
const gapHash = sha256(rows.filter((row) => !row.reusedExisting).map((row) => `${row.legacyName}\t${row.definitionCode}`).join("\n"));
console.log(JSON.stringify({ source: rows.length, occurrences: 689, sourceHash, reused: 66, created: 116, activeReused: 32, inactiveReused: 34, objects: 182, crosswalkHash, gapHash }));

function buildMigration(catalogRows) {
  const createdRows = catalogRows.filter((row) => !row.reusedExisting);
  const itemValues = createdRows.map((row) => {
    const metadata = JSON.stringify({ domain: "direct_bag", legacyBagKey: row.legacyName, sourceHash: row.sourceHash, catalogVersion });
    return `(${sql(row.definitionCode)},${sql(row.legacyName)},'STACK',TRUE,JSON_EXTRACT(${sql(metadata)},'$'),TRUE,1)`;
  }).join(",\n");
  const objectValues = catalogRows.map((row) => {
    const metadata = JSON.stringify({ domain: "direct_bag", definitionCode: row.definitionCode, ownershipModel: "STACK", legacyBagKey: row.legacyName, sourceIndex: row.sourceIndex, sourceLines: row.sourceLines, sourceHash: row.sourceHash, reusedExisting: row.reusedExisting, definitionActive: row.definitionActive, displayDrift: row.displayDrift, catalogVersion });
    return `(${sql(row.objectKey)},'ITEM',${sql(row.legacyName)},1,${row.definitionActive ? 1 : 0},JSON_EXTRACT(${sql(metadata)},'$'))`;
  }).join(",\n");
  const aliasSelect = catalogRows.map((row) => `SELECT id,object_type,'legacy_name',${sql(row.legacyName)} FROM object_registry WHERE object_key=${sql(row.objectKey)}`).join("\nUNION ALL\n");
  const sourceSelect = catalogRows.map((row) => `SELECT id,object_type,'LEGACY_JS','member.bag',${sql(row.legacyName)} FROM object_registry WHERE object_key=${sql(row.objectKey)}`).join("\nUNION ALL\n");
  return `START TRANSACTION;\n\nINSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES\n${itemValues}\nON DUPLICATE KEY UPDATE\n  display_name=VALUES(display_name),\n  asset_type_code='STACK',\n  stackable=TRUE,\n  metadata_json=JSON_MERGE_PATCH(COALESCE(item_definitions.metadata_json,JSON_OBJECT()),VALUES(metadata_json));\n\nINSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES\n${objectValues}\nON DUPLICATE KEY UPDATE\n  display_name=VALUES(display_name),\n  active=VALUES(active),\n  metadata_json=VALUES(metadata_json);\n\nINSERT IGNORE INTO object_aliases(object_id,object_type,alias_type,alias_value)\n${aliasSelect};\n\nINSERT IGNORE INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)\n${sourceSelect};\n\nCOMMIT;\n`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sql(value) {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "''")}'`;
}
