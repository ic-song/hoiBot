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
  reverse?: boolean;
}

function scripted(options: ScriptOptions = {}): { participant: AppWiringReadParticipant; sql: string[] } {
  const statements: string[] = [];
  const selectedIdentity = (options.identities ?? [BAG_SHADOW_IDENTITY])[0] as typeof BAG_SHADOW_IDENTITY | undefined;
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
        assert.deepEqual(values, [selectedIdentity?.canonical_player_id ?? "playeraa"]);
        const rows = [...(options.canonical ?? BAG_SHADOW_CANONICAL_ROWS)];
        return (options.reverse ? rows.reverse() : rows) as T;
      }
      if (sql.includes("FROM canonical_owned_item_instances")) {
        assert.deepEqual(values, [selectedIdentity?.canonical_player_id ?? "playeraa"]);
        const rows = [...(options.instances ?? [])];
        return (options.reverse ? rows.reverse() : rows) as T;
      }
      throw new Error(`UNEXPECTED_SQL:${sql}`);
    },
  };
  return { participant, sql: statements };
}

describe("BagShadowParityProvider stack-bag scope", () => {
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
    assert.deepEqual(result.limitations, ["NON_STACK_ITEM_DOMAINS_OUT_OF_SCOPE", "EQUIPMENT_AND_PET_DOMAINS_OUT_OF_SCOPE"]);
    assert.match(result.resultFingerprint, /^[0-9a-f]{64}$/);
    assert.equal(run.sql.length, 4);
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

  it("uses a code-unit total tie-break when distinct names share legacyBagOrder", async () => {
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
    assert.equal(first.parity, true);
    assert.equal(first.resultFingerprint, reversed.resultFingerprint);
    assert.match(first.legacyItemOrderPreview, /1\. 특수가[\s\S]*2\. 특수나/);
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
    assert.deepEqual(result.missingItems, ["legacy only"]);
    assert.deepEqual(result.extraItems, ["canonical only"]);
    assert.deepEqual(result.quantityMismatches, [{ displayName: "합성 물약✨", legacyQuantity: "9007199254740993", canonicalQuantity: "9007199254740994" }]);
    assert.ok(result.orderMismatches.some((row) => row.displayName === "잡템☠️"));
    assert.notEqual(result.legacyItemOrderPreview, result.canonicalItemOrderPreview);
  });

  it("classifies signed non-positive quantities and legacy non-stackable definitions", async () => {
    const legacy = [
      ...BAG_SHADOW_LEGACY_ROWS,
      { record_id: 7n, display_name: "legacy negative", quantity: -2n, legacy_bag_order: null, stackable_flag: true },
      { record_id: 8n, display_name: "legacy instance", quantity: 1n, legacy_bag_order: null, stackable_flag: false },
    ];
    const canonical = [...BAG_SHADOW_CANONICAL_ROWS, { record_id: "stack007", display_name: "canonical negative", quantity: "-3", legacy_bag_order: null, stackable_flag: true }];
    const result = await new BagShadowParityProvider().compare(scripted({ legacy, canonical }).participant, "kakao", "external-1");
    assert.ok(result.unsupportedDomainRecords.some((row) => row.side === "LEGACY" && row.displayName === "legacy negative" && row.reasonCode === "NON_POSITIVE_QUANTITY"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.side === "CANONICAL" && row.displayName === "canonical negative" && row.reasonCode === "NON_POSITIVE_QUANTITY"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.side === "LEGACY" && row.reasonCode === "NON_STACKABLE_DEFINITION"));
  });

  it("detects owned canonical item instances as outside stack-bag scope", async () => {
    const result = await new BagShadowParityProvider().compare(scripted({ instances: [{ record_id: "owned001", display_name: "개별 아이템" }] }).participant, "kakao", "external-1");
    assert.equal(result.parity, true);
    assert.equal(result.hasOutOfScopeRecords, true);
    assert.equal(result.cutoverReady, false);
    assert.deepEqual(result.unsupportedDomainRecords, [{ side: "CANONICAL", recordId: "owned001", displayName: "개별 아이템", reasonCode: "ITEM_INSTANCE_OUT_OF_SCOPE" }]);
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
    assert.equal(result.hasOutOfScopeRecords, false);
    assert.equal(result.cutoverReady, false);
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "DUPLICATE_DISPLAY_NAME"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "NON_STACKABLE_DEFINITION"));
    assert.ok(result.unsupportedDomainRecords.some((row) => row.reasonCode === "NON_POSITIVE_QUANTITY"));
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
  });
});
