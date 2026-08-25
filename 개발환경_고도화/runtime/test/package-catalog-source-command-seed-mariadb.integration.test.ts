import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { createDatabaseClient, type DatabaseClient } from "../src/database.js";

const configured = ["DATABASE_HOST", "DATABASE_PORT", "DATABASE_USER", "DATABASE_PASSWORD", "DATABASE_NAME"]
  .every((name) => Boolean(process.env[name]));
const required = (name: string): string => process.env[name] ?? "integration-test-not-configured";
let database: DatabaseClient;

const EXPECTED_SOURCE_COMMANDS = [
  { packageId: "PKG-078", command: "/고생하셨습니다" },
  { packageId: "PKG-088", command: "/길드창고패키지오픈" },
  { packageId: "PKG-093", command: "/낚시오픈" },
  { packageId: "PKG-097", command: "/도파민오픈1" },
  { packageId: "PKG-098", command: "/도파민오픈2" },
  { packageId: "PKG-100", command: "/로열오픈" },
  { packageId: "PKG-103", command: "/미강오픈" },
  { packageId: "PKG-105", command: "/미니펫오픈" },
  { packageId: "PKG-156", command: "/창조오픈" },
  { packageId: "PKG-157", command: "/초보오픈1" },
  { packageId: "PKG-158", command: "/초보오픈2" },
  { packageId: "PKG-159", command: "/초보오픈3" },
  { packageId: "PKG-160", command: "/초보오픈4" },
  { packageId: "PKG-161", command: "/초보오픈5" },
  { packageId: "PKG-162", command: "/초보오픈6" },
  { packageId: "PKG-165", command: "/컬렉션창세오픈" },
  { packageId: "PKG-166", command: "/컬렉션창조오픈" },
  { packageId: "PKG-186", command: "/펫탐험오픈1" },
  { packageId: "PKG-188", command: "/해피할로윈오픈시펫외형이바뀝니다안에는어마어마한상품이있습니다" },
  { packageId: "PKG-201", command: "/홈패키지오픈2" },
  { packageId: "PKG-203", command: "/홈패키지오픈테스트" },
  { packageId: "PKG-204", command: "/황제패키지오픈3" },
  { packageId: "PKG-206", command: "/이랏싸이마쎄" },
  { packageId: "PKG-207", command: "/극락오픈" },
  { packageId: "PKG-208", command: "/나락오픈" },
  { packageId: "PKG-209", command: "/루비오픈" },
  { packageId: "PKG-210", command: "/루키오픈" },
  { packageId: "PKG-211", command: "/마스터오픈" },
  { packageId: "PKG-212", command: "/미니오픈테스트" },
  { packageId: "PKG-213", command: "/다이아오픈" },
  { packageId: "PKG-214", command: "/랜덤오픈" },
  { packageId: "PKG-215", command: "/상자오픈" },
  { packageId: "PKG-ARCHMAGE-RUINS-BOX", command: "/대마법박스오픈" },
  { packageId: "PKG-CHICKEN-BOX", command: "/치킨오픈" },
  { packageId: "PKG-CASTLE-CARD", command: "/카드오픈" },
  { packageId: "PKG-CHICKEN-DUNGEON-BOX", command: "/양계장박스오픈" },
  { packageId: "PKG-EVENT-DUNGEON-BOX", command: "/이벤박스오픈" },
  { packageId: "PKG-ENHANCE-DUNGEON-BOX", command: "/강화박스오픈" },
  { packageId: "PKG-JEONDOR-DUNGEON-BOX", command: "/전도르박스오픈" },
  { packageId: "PKG-LAND-DOCUMENT-DUNGEON-BOX", command: "/땅문서박스오픈" },
  { packageId: "PKG-LUCKY-BOX", command: "/행운의박스오픈" },
  { packageId: "PKG-PET-FOOD-DUNGEON-BOX", command: "/펫먹이박스오픈" },
  { packageId: "PKG-SHOP-OPEN-DUNGEON-BOX", command: "/샵오픈박스오픈" },
] as const;

(configured ? describe : describe.skip)("package catalog source command seed", () => {
  before(() => {
    database = createDatabaseClient({
      enabled: true,
      host: required("DATABASE_HOST"),
      port: Number(required("DATABASE_PORT")),
      user: required("DATABASE_USER"),
      password: required("DATABASE_PASSWORD"),
      name: required("DATABASE_NAME"),
      connectionLimit: 2,
      connectTimeoutMs: 5_000,
    });
  });

  after(async () => database.close());

  it("stores all 43 legacy commands on catalog rows without executable aliases", async () => {
    const rows = await database.query<Array<{
      package_id: string; source_legacy_command: string; enabled: number; alias_count: bigint;
    }>>(
      `SELECT catalog.package_id,catalog.source_legacy_command,catalog.enabled,
              COUNT(alias_row.command_text) AS alias_count
       FROM package_catalog catalog
       LEFT JOIN package_command_aliases alias_row ON alias_row.package_id=catalog.package_id
       WHERE catalog.source_legacy_command IS NOT NULL
       GROUP BY catalog.package_id,catalog.source_legacy_command,catalog.enabled
       ORDER BY catalog.package_id`,
    );
    assert.deepEqual(rows.map((row) => ({
      packageId: row.package_id,
      command: row.source_legacy_command,
    })), [...EXPECTED_SOURCE_COMMANDS].sort((left, right) => left.packageId.localeCompare(right.packageId)));
    assert.ok(rows.every((row) => Number(row.enabled) === 0));
    assert.ok(rows.every((row) => Number(row.alias_count) === 0));
  });

  it("keeps only the package bag and package use commands executable", async () => {
    const rows = await database.query<Array<{ command_text: string }>>(
      `SELECT alias_row.command_text
       FROM command_aliases alias_row
       JOIN command_registry registry ON registry.command_code=alias_row.command_code
       WHERE registry.command_code IN ('PACKAGE_BAG','PACKAGE_USE') AND alias_row.active=1
       ORDER BY alias_row.command_text`,
    );
    assert.deepEqual(rows.map((row) => row.command_text), ["/패키지가방", "/패키지사용"]);
  });

  it("seeds the three newly cataloged packages and their exact reward shapes", async () => {
    const rows = await database.query<Array<{
      package_id: string; rule_mode: string; reward_count: bigint; weight_total: string | null;
    }>>(
      `SELECT catalog.package_id,rule.rule_mode,COUNT(*) AS reward_count,
              CAST(SUM(rule.weight) AS CHAR) AS weight_total
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id IN ('PKG-213','PKG-214','PKG-215')
       GROUP BY catalog.package_id,rule.rule_mode
       ORDER BY catalog.package_id`,
    );
    assert.deepEqual(rows.map((row) => ({
      packageId: row.package_id,
      mode: row.rule_mode,
      count: Number(row.reward_count),
      weight: row.weight_total === null ? null : Number(row.weight_total),
    })), [
      { packageId: "PKG-213", mode: "ALL", count: 3, weight: null },
      { packageId: "PKG-214", mode: "WEIGHTED_ONE", count: 6, weight: 1.0000000002 },
      { packageId: "PKG-215", mode: "WEIGHTED_ONE", count: 4, weight: 1 },
    ]);
  });

  it("stores the archmage ruins box as range plus independent one-percent bonus rules", async () => {
    const rows = await database.query<Array<{
      rule_id: string; rule_mode: string; operation: string; item_id: string | null;
      quantity: bigint; weight: string | null; range_min: bigint | null;
      range_max: bigint | null; range_step: bigint | null;
    }>>(
      `SELECT rule_id,rule_mode,operation,item_id,quantity,CAST(weight AS CHAR) weight,
              range_min,range_max,range_step
       FROM package_reward_rules
       WHERE package_id='PKG-ARCHMAGE-RUINS-BOX' AND enabled=1
       ORDER BY reward_order`,
    );
    assert.deepEqual(rows.map((row) => ({
      id: row.rule_id,
      mode: row.rule_mode,
      operation: row.operation,
      itemId: row.item_id,
      quantity: Number(row.quantity),
      weight: row.weight === null ? null : Number(row.weight),
      range: row.range_min === null ? null : [Number(row.range_min), Number(row.range_max), Number(row.range_step)],
    })), [
      { id: "RULE-PKG-ARCHMAGE-FRAGMENT", mode: "UNIFORM_RANGE", operation: "ADD",
        itemId: "ITEM-RWD-PET-SKILL-BOOK-FRAGMENT", quantity: 1, weight: null, range: [3, 5, 1] },
      { id: "RULE-PKG-ARCHMAGE-BOOK", mode: "WEIGHTED_ONE", operation: "ADD",
        itemId: "ITEM-RWD-007", quantity: 1, weight: 0.01, range: null },
      { id: "RULE-PKG-ARCHMAGE-NO-BOOK", mode: "WEIGHTED_ONE", operation: "NONE",
        itemId: null, quantity: 0, weight: 0.99, range: null },
    ]);
  });

  it("stores the land document dungeon box as one deterministic document per open", async () => {
    const rows = await database.query<Array<{
      source_legacy_command: string; alias_count: bigint; rule_mode: string;
      operation: string; item_id: string; quantity: bigint;
    }>>(
      `SELECT catalog.source_legacy_command,
              (SELECT COUNT(*) FROM package_command_aliases alias_row WHERE alias_row.package_id=catalog.package_id) alias_count,
              rule.rule_mode,rule.operation,rule.item_id,rule.quantity
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id='PKG-LAND-DOCUMENT-DUNGEON-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({
      command: row.source_legacy_command,
      aliases: Number(row.alias_count),
      mode: row.rule_mode,
      operation: row.operation,
      itemId: row.item_id,
      quantity: Number(row.quantity),
    })), [{
      command: "/땅문서박스오픈",
      aliases: 0,
      mode: "ALL",
      operation: "ADD",
      itemId: "ITEM-RWD-039",
      quantity: 1,
    }]);
  });

  it("supersedes fixed box command handlers with deterministic catalog rewards", async () => {
    const rows = await database.query<Array<{
      package_id: string; source_legacy_command: string; consume_item_id: string;
      item_id: string; quantity: bigint; alias_count: bigint;
    }>>(
      `SELECT catalog.package_id,catalog.source_legacy_command,catalog.consume_item_id,
              rule.item_id,rule.quantity,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id IN ('PKG-CHICKEN-DUNGEON-BOX','PKG-SHOP-OPEN-DUNGEON-BOX')
       ORDER BY catalog.package_id`,
    );
    assert.deepEqual(rows.map((row) => ({
      packageId: row.package_id,
      command: row.source_legacy_command,
      consumeItemId: row.consume_item_id,
      rewardItemId: row.item_id,
      quantity: Number(row.quantity),
      aliases: Number(row.alias_count),
    })), [
      { packageId: "PKG-CHICKEN-DUNGEON-BOX", command: "/양계장박스오픈",
        consumeItemId: "ITEM-DUNGEON-CHICKEN-BOX", rewardItemId: "ITEM-PACKAGE-CHICKEN-BOX",
        quantity: 10, aliases: 0 },
      { packageId: "PKG-SHOP-OPEN-DUNGEON-BOX", command: "/샵오픈박스오픈",
        consumeItemId: "ITEM-DUNGEON-SHOP-OPEN-BOX", rewardItemId: "ITEM-RWD-001",
        quantity: 70, aliases: 0 },
    ]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases
       WHERE command_text IN ('/양계장박스오픈','/샵오픈박스오픈')`,
    );
    assert.deepEqual(executableRows, []);
  });

  it("stores both event box source names as metadata and grants both fixed rewards", async () => {
    const rows = await database.query<Array<{
      source_legacy_command: string; metadata_json: string | { sourceCommands: string[] }; item_id: string;
      quantity: bigint; alias_count: bigint;
    }>>(
      `SELECT catalog.source_legacy_command,item.metadata_json,rule.item_id,rule.quantity,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_item_definitions item ON item.item_id=catalog.consume_item_id
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id='PKG-EVENT-DUNGEON-BOX'
       ORDER BY rule.reward_order`,
    );
    assert.deepEqual(rows.map((row) => ({
      command: row.source_legacy_command,
      sourceCommands: (typeof row.metadata_json === "string"
        ? JSON.parse(row.metadata_json)
        : row.metadata_json).sourceCommands,
      itemId: row.item_id,
      quantity: Number(row.quantity),
      aliases: Number(row.alias_count),
    })), [
      { command: "/이벤박스오픈", sourceCommands: ["/이벤박스오픈", "/이벤트박스오픈✡️"],
        itemId: "ITEM-RWD-001", quantity: 100, aliases: 0 },
      { command: "/이벤박스오픈", sourceCommands: ["/이벤박스오픈", "/이벤트박스오픈✡️"],
        itemId: "ITEM-RWD-033", quantity: 1, aliases: 0 },
    ]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases
       WHERE command_text IN ('/이벤박스오픈','/이벤트박스오픈✡️')`,
    );
    assert.deepEqual(executableRows, []);
  });

  it("stores the Jeondor dungeon box as one legendary stone per open", async () => {
    const rows = await database.query<Array<{
      source_legacy_command: string; item_id: string; quantity: bigint; alias_count: bigint;
    }>>(
      `SELECT catalog.source_legacy_command,rule.item_id,rule.quantity,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id='PKG-JEONDOR-DUNGEON-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({
      command: row.source_legacy_command,
      itemId: row.item_id,
      quantity: Number(row.quantity),
      aliases: Number(row.alias_count),
    })), [{ command: "/전도르박스오픈", itemId: "ITEM-RWD-052", quantity: 1, aliases: 0 }]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/전도르박스오픈'`,
    );
    assert.deepEqual(executableRows, []);
  });

  it("stores the lucky box conversion on the existing stable item keys", async () => {
    const rows = await database.query<Array<{
      consume_item_id: string; item_id: string; quantity: bigint; catalog_enabled: number;
      consume_enabled: number; reward_enabled: number; alias_count: bigint;
    }>>(
      `SELECT catalog.consume_item_id,rule.item_id,rule.quantity,catalog.enabled catalog_enabled,
              consume_item.enabled consume_enabled,reward_item.enabled reward_enabled,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_item_definitions consume_item ON consume_item.item_id=catalog.consume_item_id
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       JOIN package_item_definitions reward_item ON reward_item.item_id=rule.item_id
       WHERE catalog.package_id='PKG-LUCKY-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({
      consumeItemId: row.consume_item_id,
      rewardItemId: row.item_id,
      quantity: Number(row.quantity),
      catalogEnabled: Number(row.catalog_enabled),
      consumeEnabled: Number(row.consume_enabled),
      rewardEnabled: Number(row.reward_enabled),
      aliases: Number(row.alias_count),
    })), [{ consumeItemId: "lucky_box", rewardItemId: "reward_lucky_box", quantity: 5,
      catalogEnabled: 0, consumeEnabled: 0, rewardEnabled: 1, aliases: 0 }]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/행운의박스오픈'`,
    );
    assert.deepEqual(executableRows, []);
  });

  it("stores pet food dungeon boxes as an inclusive uniform 40 to 50 reward", async () => {
    const rows = await database.query<Array<{
      consume_item_id: string; item_id: string; rule_mode: string; quantity: bigint;
      range_min: bigint; range_max: bigint; range_step: bigint; alias_count: bigint;
    }>>(
      `SELECT catalog.consume_item_id,rule.item_id,rule.rule_mode,rule.quantity,
              rule.range_min,rule.range_max,rule.range_step,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id='PKG-PET-FOOD-DUNGEON-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({
      consumeItemId: row.consume_item_id,
      rewardItemId: row.item_id,
      mode: row.rule_mode,
      quantity: Number(row.quantity),
      range: [Number(row.range_min), Number(row.range_max), Number(row.range_step)],
      aliases: Number(row.alias_count),
    })), [{ consumeItemId: "pet_food_dungeon_box", rewardItemId: "pet_food",
      mode: "UNIFORM_RANGE", quantity: 1, range: [40, 50, 1], aliases: 0 }]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/펫먹이박스오픈'`,
    );
    assert.deepEqual(executableRows, []);
  });

  it("stores enhancement dungeon boxes as an inclusive uniform 70 to 100 reward", async () => {
    const rows = await database.query<Array<{
      consume_item_id: string; item_id: string; rule_mode: string; range_min: bigint;
      range_max: bigint; range_step: bigint; max_open_count: bigint; alias_count: bigint;
    }>>(
      `SELECT catalog.consume_item_id,rule.item_id,rule.rule_mode,rule.range_min,
              rule.range_max,rule.range_step,catalog.max_open_count,
              (SELECT COUNT(*) FROM package_command_aliases alias_row
               WHERE alias_row.package_id=catalog.package_id) alias_count
       FROM package_catalog catalog
       JOIN package_reward_rules rule ON rule.package_id=catalog.package_id AND rule.enabled=1
       WHERE catalog.package_id='PKG-ENHANCE-DUNGEON-BOX'`,
    );
    assert.deepEqual(rows.map((row) => ({
      consumeItemId: row.consume_item_id,
      rewardItemId: row.item_id,
      mode: row.rule_mode,
      range: [Number(row.range_min), Number(row.range_max), Number(row.range_step)],
      maxOpenCount: Number(row.max_open_count),
      aliases: Number(row.alias_count),
    })), [{ consumeItemId: "enhance_dungeon_box", rewardItemId: "pet_enhance_stone",
      mode: "UNIFORM_RANGE", range: [70, 100, 1], maxOpenCount: 1000, aliases: 0 }]);

    const executableRows = await database.query<Array<{ command_text: string }>>(
      `SELECT command_text FROM command_aliases WHERE command_text='/강화박스오픈'`,
    );
    assert.deepEqual(executableRows, []);
  });
});

