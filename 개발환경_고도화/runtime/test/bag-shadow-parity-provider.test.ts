import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AppWiringReadParticipant } from "../src/dispatch/app-wiring-operation-provider.js";
import { BagShadowParityProvider } from "../src/inventory/bag-shadow-parity-provider.js";
import { BAG_SHADOW_CANONICAL_ROWS, BAG_SHADOW_IDENTITY, BAG_SHADOW_LEGACY_ROWS } from "./fixtures/bag-shadow-parity.js";

interface ScriptOptions {
  identities?: readonly Record<string, unknown>[];
  legacy?: readonly Record<string, unknown>[];
  canonical?: readonly Record<string, unknown>[];
  instances?: readonly Record<string, unknown>[];
  players?: readonly Record<string, unknown>[];
  itemDefinitions?: readonly Record<string, unknown>[];
  pets?: readonly Record<string, unknown>[];
  petDefinitions?: readonly Record<string, unknown>[];
  equipment?: readonly Record<string, unknown>[];
  equipmentDefinitions?: readonly Record<string, unknown>[];
  reverse?: boolean;
}

function scripted(options: ScriptOptions = {}): { participant: AppWiringReadParticipant; sql: string[] } {
  const statements: string[] = [];
  const selectedIdentity = (options.identities ?? [BAG_SHADOW_IDENTITY])[0] as typeof BAG_SHADOW_IDENTITY | undefined;
  const canonicalPlayerId = String(selectedIdentity?.canonical_player_id ?? "playeraa");
  const sourceCanonical = options.canonical ?? BAG_SHADOW_CANONICAL_ROWS;
  const canonical: Array<Record<string, unknown>> = sourceCanonical.map((row, index) => ({ player_id: canonicalPlayerId, item_id: `it${String(index + 1).padStart(6, "0")}`, ...row }));
  const instances: Array<Record<string, unknown>> = (options.instances ?? []).map((row, index) => ({ player_id: canonicalPlayerId, item_id: `ii${String(index + 1).padStart(6, "0")}`, ownership_status: "owned", legacy_bag_order: null, stackable_flag: false, ...row }));
  const defaultItemDefinitions = [...canonical, ...instances].map((row) => ({ item_id: row.item_id, item_name: row.display_name, item_description: null, item_kind: "fixture", item_grade: null, price_amount: null, price_currency_source_identifier: null, stackable_flag: row.stackable_flag, active_flag: true, definition_options: null }));
  const participant: AppWiringReadParticipant = {
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      statements.push(sql);
      assert.match(sql.trim(), /^SELECT\b/i);
      assert.doesNotMatch(sql, /FOR\s+UPDATE|\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET)\b/i);
      if (sql.includes("canonical_player_identity_crosswalks")) {
        assert.deepEqual(values, ["kakao", "external-1"]);
        return [...(options.identities ?? [BAG_SHADOW_IDENTITY])] as T;
      }
      if (sql.includes("FROM inventory_stacks")) {
        assert.deepEqual(values, [selectedIdentity === undefined ? "900000001" : String(selectedIdentity.legacy_player_id)]);
        const rows = [...(options.legacy ?? BAG_SHADOW_LEGACY_ROWS)];
        return (options.reverse ? rows.reverse() : rows) as T;
      }
      if (sql.includes("FROM canonical_owned_item_stacks")) {
        assert.deepEqual(values, [canonicalPlayerId]);
        const rows = [...canonical];
        return (options.reverse ? rows.reverse() : rows) as T;
      }
      if (sql.includes("FROM canonical_owned_item_instances")) {
        assert.deepEqual(values, [canonicalPlayerId]);
        const rows = [...instances];
        return (options.reverse ? rows.reverse() : rows) as T;
      }
      if (sql.includes("FROM canonical_players")) return [...(options.players ?? [{ player_id: canonicalPlayerId }])] as T;
      if (sql.includes("FROM canonical_item_definitions")) return [...(options.itemDefinitions ?? defaultItemDefinitions)] as T;
      if (sql.includes("FROM canonical_owned_pet_instances")) return [...(options.pets ?? [])] as T;
      if (sql.includes("FROM canonical_pet_definitions")) return [...(options.petDefinitions ?? [])] as T;
      if (sql.includes("FROM canonical_owned_equipment_instances")) return [...(options.equipment ?? [])] as T;
      if (sql.includes("FROM canonical_equipment_definitions")) return [...(options.equipmentDefinitions ?? [])] as T;
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    },
  };
  return { participant, sql: statements };
}

describe("BagShadowParityProvider frozen item/pet/equipment scope", () => {
  it("preserves Unicode, legacyBagOrder and bigint quantities beyond 2^53 at parity", async () => {
    const run = scripted();
    const result = await new BagShadowParityProvider().compare(run.participant, "kakao", "external-1");
    assert.equal(result.scope, "STACK_BAG");
    assert.equal(result.parity, true);
    assert.equal(result.hasOutOfScopeRecords, false);
    assert.equal(result.cutoverReady, true);
    assert.equal(result.legacyBag.items.find((item) => item.displayName === "합성 물약✨")?.quantity, "9007199254740993");
    assert.equal(result.legacyItemOrderPreview, result.canonicalItemOrderPreview);
    assert.equal(result.legacyFingerprint, result.canonicalFingerprint);
    assert.deepEqual(result.presentationScope, { header: "OUT_OF_SCOPE", ownerLabel: "OUT_OF_SCOPE", advertisement: "OUT_OF_SCOPE", itemOrderPreviewOnly: true });
    assert.deepEqual(result.limitations, []);
    assert.equal(result.frozenDomainCoverage.parity, true);
    assert.deepEqual(result.frozenDomainCoverage.outputNeutralDomains, ["pets", "equipment"]);
    assert.match(result.frozenDomainCoverage.fingerprint, /^[0-9a-f]{64}$/);
    assert.match(result.resultFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(run.sql.length, 10);
  });

  it("binds the result fingerprint to the resolved legacy and canonical identities", async () => {
    const first = await new BagShadowParityProvider().compare(scripted().participant, "kakao", "external-1");
    const secondIdentity = { ...BAG_SHADOW_IDENTITY, legacy_player_id: 900000002n, canonical_player_id: "playerbb" };
    const second = await new BagShadowParityProvider().compare(scripted({ identities: [secondIdentity] }).participant, "kakao", "external-1");
    assert.equal(first.legacyFingerprint, second.legacyFingerprint);
    assert.equal(first.canonicalFingerprint, second.canonicalFingerprint);
    assert.notEqual(first.resultFingerprint, second.resultFingerprint);
  });

  it("keeps null or empty presentation labels outside parity and fingerprints", async () => {
    const nullLabel = await new BagShadowParityProvider().compare(scripted({ identities: [{ ...BAG_SHADOW_IDENTITY, display_name: null }] }).participant, "kakao", "external-1");
    const emptyLabel = await new BagShadowParityProvider().compare(scripted({ identities: [{ ...BAG_SHADOW_IDENTITY, display_name: "" }] }).participant, "kakao", "external-1");
    assert.equal(nullLabel.parity, true);
    assert.equal(nullLabel.legacyFingerprint, emptyLabel.legacyFingerprint);
    assert.equal(nullLabel.resultFingerprint, emptyLabel.resultFingerprint);
    assert.equal(nullLabel.legacyBag.ownerLabel, "");
  });

  it("fails closed instead of inventing a tie-break when distinct special names share legacyBagOrder", async () => {
    const legacy = [
      { record_id: 10n, display_name: "특수나", quantity: 1n, legacy_bag_order: 7, stackable_flag: true },
      { record_id: 11n, display_name: "특수가", quantity: 1n, legacy_bag_order: 7, stackable_flag: true },
    ];
    const canonical = [
      { record_id: "stack010", display_name: "특수가", quantity: 1n, legacy_bag_order: 7, stackable_flag: true },
      { record_id: "stack011", display_name: "특수나", quantity: 1n, legacy_bag_order: 7, stackable_flag: true },
    ];
    const first = await new BagShadowParityProvider().compare(scripted({ legacy, canonical }).participant, "kakao", "external-1");
    const reversed = await new BagShadowParityProvider().compare(scripted({ legacy, canonical, reverse: true }).participant, "kakao", "external-1");
    assert.equal(first.parity, false);
    assert.equal(first.cutoverReady, false);
    const duplicateOrders = first.unsupportedDomainRecords.filter((row) => row.reasonCode === "DUPLICATE_SPECIAL_ORDER");
    assert.equal(duplicateOrders.length, 4);
    assert.deepEqual(new Set(duplicateOrders.map((row) => row.displayName)), new Set(["특수가", "특수나"]));
    assert.equal(first.resultFingerprint, reversed.resultFingerprint);
  });

  it("keeps fingerprints and comparison invariant to database row order", async () => {
    const first = await new BagShadowParityProvider().compare(scripted().participant, "kakao", "external-1");
    const second = await new BagShadowParityProvider().compare(scripted({ reverse: true }).participant, "kakao", "external-1");
    assert.equal(first.legacyFingerprint, second.legacyFingerprint);
    assert.equal(first.canonicalFingerprint, second.canonicalFingerprint);
    assert.equal(first.resultFingerprint, second.resultFingerprint);
    assert.deepEqual(first.missingItems, second.missingItems);
  });

  it("reports missing, extra, quantity and ordering mismatches", async () => {
    const legacy = [
      ...BAG_SHADOW_LEGACY_ROWS,
      { record_id: 4n, display_name: "legacy only", quantity: 2n, legacy_bag_order: null, stackable_flag: true },
      { record_id: 5n, display_name: "양념치킨🐔", quantity: 12n, legacy_bag_order: 21, stackable_flag: true },
    ];
    const canonical = [
      { ...BAG_SHADOW_CANONICAL_ROWS[0]! },
      { ...BAG_SHADOW_CANONICAL_ROWS[1]!, quantity: "9007199254740994" },
      { ...BAG_SHADOW_CANONICAL_ROWS[2]!, legacy_bag_order: 30 },
      { record_id: "stack004", display_name: "canonical only", quantity: 2n, legacy_bag_order: null, stackable_flag: true },
      { record_id: "stack005", display_name: "양념치킨🐔", quantity: 12n, legacy_bag_order: 10, stackable_flag: true },
    ];
    const result = await new BagShadowParityProvider().compare(scripted({ legacy, canonical }).participant, "kakao", "external-1");
    assert.equal(result.parity, false);
    assert.equal(result.frozenDomainCoverage.parity, true);
    assert.deepEqual(result.missingItems, ["legacy only"]);
    assert.deepEqual(result.extraItems, ["canonical only"]);
    assert.deepEqual(result.quantityMismatches, [{ displayName: "합성 물약✨", legacyQuantity: "9007199254740993", canonicalQuantity: "9007199254740994" }]);
    assert.ok(result.orderMismatches.some((row) => row.displayName === "잡템☠️"));
    assert.notEqual(result.legacyItemOrderPreview, result.canonicalItemOrderPreview);
  });

  it("keeps signed non-positive quantities in exact item parity", async () => {
    const legacy = [...BAG_SHADOW_LEGACY_ROWS, { record_id: 7n, display_name: "signed quantity", quantity: -2n, legacy_bag_order: null, stackable_flag: true }, { record_id: 8n, display_name: "ordinary zero", quantity: 0n, legacy_bag_order: null, stackable_flag: true }];
    const canonical = [...BAG_SHADOW_CANONICAL_ROWS, { record_id: "stack007", display_name: "signed quantity", quantity: "-2", legacy_bag_order: null, stackable_flag: true }, { record_id: "stack008", display_name: "ordinary zero", quantity: 0n, legacy_bag_order: null, stackable_flag: true }];
    const result = await new BagShadowParityProvider().compare(scripted({ legacy, canonical }).participant, "kakao", "external-1");
    assert.equal(result.parity, true);
    assert.deepEqual(result.unsupportedDomainRecords, []);
  });

  it("fails closed when an owned item instance has no explicit member.bag lineage", async () => {
    const result = await new BagShadowParityProvider().compare(scripted({ instances: [{ record_id: "owned001", display_name: "개별 아이템" }] }).participant, "kakao", "external-1");
    assert.equal(result.parity, false);
    assert.equal(result.hasOutOfScopeRecords, true);
    assert.equal(result.cutoverReady, false);
    assert.equal(result.frozenDomainCoverage.parity, false);
    assert.deepEqual(result.unsupportedDomainRecords, [{ side: "CANONICAL", recordId: "owned001", displayName: "개별 아이템", reasonCode: "ITEM_INSTANCE_LINEAGE_UNPROVEN" }]);
  });

  it("rejects name and JSON instance_options lineage until a typed staging FK exists", async () => {
    const legacy = [...BAG_SHADOW_LEGACY_ROWS, { record_id: 4n, display_name: "개별 아이템", quantity: 1n, legacy_bag_order: null, stackable_flag: false }];
    const instances = [{ record_id: "owned001", display_name: "개별 아이템", instance_options: JSON.stringify({ legacyBagLineage: { sourceNamespace: "member.bag", sourceIdentifier: "개별 아이템" } }) }];
    const result = await new BagShadowParityProvider().compare(scripted({ legacy, instances }).participant, "kakao", "external-1");
    assert.equal(result.parity, false);
    assert.equal(result.cutoverReady, false);
    assert.equal(result.canonicalBag.items.some((item) => item.displayName === "개별 아이템"), false);
    assert.ok(result.unsupportedDomainRecords.some((row) => row.recordId === "owned001" && row.reasonCode === "ITEM_INSTANCE_LINEAGE_UNPROVEN"));
  });

  it("reports unsupported stack-domain records without merging them", async () => {
    const canonical = [
      ...BAG_SHADOW_CANONICAL_ROWS,
      { record_id: "stack004", display_name: "합성 물약✨", quantity: 1n, legacy_bag_order: null, stackable_flag: true },
      { record_id: "stack005", display_name: "instance-only", quantity: 1n, legacy_bag_order: null, stackable_flag: false },
      { record_id: "stack006", display_name: "zero", quantity: 0n, legacy_bag_order: null, stackable_flag: true },
    ];
    const result = await new BagShadowParityProvider().compare(scripted({ canonical }).participant, "kakao", "external-1");
    assert.equal(result.parity, false);
    assert.equal(result.hasOutOfScopeRecords, true);
    assert.equal(result.cutoverReady, false);
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "DUPLICATE_DISPLAY_NAME"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "NON_STACKABLE_DEFINITION"));
    assert.ok(result.canonicalBag.items.some((row) => row.displayName === "zero" && row.quantity === "0"));
  });

  it("fingerprints valid pet/equipment state as proven output-neutral frozen domains", async () => {
    const petDefinitions = [{ pet_id: "pet00001", pet_name: "펫", pet_description: null, pet_grade: "rare", base_charm: 10n, charm_per_enhancement: 2n, active_flag: true }];
    const pets = [{ owned_pet_id: "ownpet01", player_id: "playeraa", pet_id: "pet00001", custom_name: "내 펫", enhancement_level: 3n, experience_amount: 9007199254740993n, ownership_status: "owned" }];
    const equipmentDefinitions = [{ equipment_id: "equip001", equipment_name: "링", equipment_description: null, equipment_slot: "ring", equipment_grade: "rare", base_charm: 4n, charm_per_enhancement: 1n, active_flag: true }];
    const equipment = [{ owned_equipment_id: "ownequ01", player_id: "playeraa", equipment_id: "equip001", custom_name: null, enhancement_level: 2n, durability_amount: null, ownership_status: "owned" }];
    const first = await new BagShadowParityProvider().compare(scripted({ petDefinitions, pets, equipmentDefinitions, equipment }).participant, "kakao", "external-1");
    const equivalent = await new BagShadowParityProvider().compare(scripted({ petDefinitions: [{ ...petDefinitions[0]!, active_flag: 1 }], pets, equipmentDefinitions, equipment }).participant, "kakao", "external-1");
    const changed = await new BagShadowParityProvider().compare(scripted({ petDefinitions, pets: [{ ...pets[0]!, experience_amount: 9007199254740994n }], equipmentDefinitions, equipment }).participant, "kakao", "external-1");
    assert.equal(first.parity, true);
    assert.equal(first.frozenDomainCoverage.parity, true);
    assert.equal(first.frozenDomainCoverage.domains.pets.length, 2);
    assert.equal(first.frozenDomainCoverage.domains.equipment.length, 2);
    assert.equal(first.frozenDomainCoverage.fingerprint, equivalent.frozenDomainCoverage.fingerprint);
    assert.notEqual(first.frozenDomainCoverage.fingerprint, changed.frozenDomainCoverage.fingerprint);
    assert.notEqual(first.resultFingerprint, changed.resultFingerprint);
  });

  it("rejects unsafe JavaScript numbers instead of fingerprinting rounded frozen-domain state", async () => {
    await assert.rejects(() => new BagShadowParityProvider().compare(scripted({
      petDefinitions: [{ pet_id: "pet00001", pet_name: "펫", pet_description: null, pet_grade: null, base_charm: Number.MAX_SAFE_INTEGER + 1, charm_per_enhancement: 0, active_flag: true }],
    }).participant, "kakao", "external-1"), /BAG_SHADOW_CANONICAL_NUMBER_UNSAFE/);
  });

  it("fails closed when a frozen owned record lacks its definition or canonical player state", async () => {
    const result = await new BagShadowParityProvider().compare(scripted({
      players: [],
      pets: [{ owned_pet_id: "ownpet01", player_id: "playeraa", pet_id: "pet00001", custom_name: null, enhancement_level: 0n, experience_amount: 0n, ownership_status: "owned" }],
    }).participant, "kakao", "external-1");
    assert.equal(result.parity, false);
    assert.equal(result.cutoverReady, false);
    assert.equal(result.frozenDomainCoverage.parity, false);
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "FROZEN_DOMAIN_PLAYER_MISSING"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "FROZEN_DOMAIN_DEFINITION_MISSING"));
  });

  it("fails closed for missing, revoked and duplicate identity crosswalks", async () => {
    for (const identities of [
      [],
      [{ ...BAG_SHADOW_IDENTITY, crosswalk_status: "REVOKED" }],
      [BAG_SHADOW_IDENTITY, { ...BAG_SHADOW_IDENTITY, canonical_player_id: "playerbb" }],
    ]) {
      const run = scripted({ identities });
      await assert.rejects(() => new BagShadowParityProvider().compare(run.participant, "kakao", "external-1"), /BAG_SHADOW_IDENTITY_MAPPING/);
      assert.equal(run.sql.length, 1);
    }
  });

  it("uses the runner-owned participant for SELECT-only work and owns no transaction", async () => {
    const run = scripted();
    await new BagShadowParityProvider().compare(run.participant, "kakao", "external-1");
    assert.ok(run.sql.every((sql) => /^SELECT\b/i.test(sql.trim())));
    assert.ok(run.sql.every((sql) => !/FOR\s+UPDATE|\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET)\b/i.test(sql)));
    for (const table of ["canonical_players", "canonical_item_definitions", "canonical_owned_item_stacks", "canonical_owned_item_instances", "canonical_pet_definitions", "canonical_owned_pet_instances", "canonical_equipment_definitions", "canonical_owned_equipment_instances"]) {
      assert.ok(run.sql.some((sql) => sql.includes(table)), table);
    }
    assert.ok(run.sql.filter((sql) => sql.includes("canonical_owned_item_instances")).every((sql) => !sql.includes("instance_options")));
  });
});
