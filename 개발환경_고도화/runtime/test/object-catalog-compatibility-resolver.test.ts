import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatabaseClient } from "../src/database.js";
import { LEGACY_OBJECT_REGISTRY_SOURCE, ObjectCatalogCompatibilityResolver } from "../src/catalog/object-catalog-compatibility-resolver.js";

function database(rows: unknown[]): { database: Pick<DatabaseClient, "query">; sql: string[]; values: unknown[][] } {
  const sql: string[] = [];
  const values: unknown[][] = [];
  return {
    database: { query: async <T>(statement: string, parameters: readonly unknown[] = []): Promise<T> => {
      sql.push(statement); values.push([...parameters]); return (rows.shift() ?? []) as T;
    } }, sql, values
  };
}

const mapped = { legacy_object_id: 71n, legacy_object_key: "item.diamond_box", object_type: "ITEM" as const, object_identity_id: "a1234567" };

describe("object catalog compatibility resolver", () => {
  it("uses the WBS731 crosswalk with a legacy registry id as a read-only source locator", async () => {
    const scripted = database([[mapped]]);
    const result = await new ObjectCatalogCompatibilityResolver(scripted.database).resolveLegacyObjectId("71", { expectedObjectType: "ITEM" });
    assert.deepEqual(result, { status: "RESOLVED", canonicalObjectIdentityId: "a1234567", legacyObjectId: "71", legacyObjectKey: "item.diamond_box", objectType: "ITEM", quarantineReason: null });
    assert.equal(LEGACY_OBJECT_REGISTRY_SOURCE.namespace, "object_registry.id");
    assert.match(scripted.sql[0]!, /LEFT JOIN object_identity_crosswalks/);
    assert.match(scripted.sql[0]!, /CAST\(registry.id AS CHAR\)/);
    assert.deepEqual(scripted.values[0], ["71"]);
  });

  it("resolves aliases and source bindings through their existing legacy namespaces", async () => {
    const scripted = database([[mapped], [mapped]]);
    const resolver = new ObjectCatalogCompatibilityResolver(scripted.database);
    assert.equal((await resolver.resolveAlias("ITEM", "legacy_name", "다이아상자💎(/다이아상자오픈)")).canonicalObjectIdentityId, "a1234567");
    assert.equal((await resolver.resolveSource({ system: "LEGACY_JSON", table: "itemInfo", key: "다이아상자💎(/다이아상자오픈)" })).legacyObjectId, "71");
    assert.match(scripted.sql[0]!, /JOIN object_aliases alias/);
    assert.match(scripted.sql[1]!, /JOIN object_source_bindings source/);
  });

  it("fails closed for unmapped, type-mismatched, ambiguous, and invalid locators", async () => {
    const scripted = database([[{ ...mapped, object_identity_id: null }], [mapped], [mapped, mapped]]);
    const resolver = new ObjectCatalogCompatibilityResolver(scripted.database);
    assert.equal((await resolver.resolveLegacyObjectId("71")).status, "UNMAPPED");
    const mismatch = await resolver.resolveLegacyObjectId("71", { expectedObjectType: "PET" });
    assert.deepEqual({ status: mismatch.status, reason: mismatch.quarantineReason, identity: mismatch.canonicalObjectIdentityId }, { status: "TYPE_MISMATCH", reason: "LEGACY_OBJECT_TYPE_MISMATCH", identity: null });
    assert.equal((await resolver.resolveAlias("ITEM", "legacy_name", "상자")).status, "AMBIGUOUS");
    assert.deepEqual(await resolver.resolveLegacyObjectId("0"), { status: "UNMAPPED", canonicalObjectIdentityId: null, legacyObjectId: null, legacyObjectKey: null, objectType: null, quarantineReason: "LEGACY_OBJECT_ID_INVALID" });
  });
});
