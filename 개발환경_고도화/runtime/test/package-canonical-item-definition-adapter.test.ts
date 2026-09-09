import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT } from "../src/package/canonical-item-definition-adapter.js";

describe("package canonical item definition adapter", () => {
  it("uses canonical identity and availability for stack rewards", () => {
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /LEFT JOIN item_definitions canonical/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical\.display_name/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical\.stackable/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical\.active = 1/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /canonical\.id IS NOT NULL/);
  });

  it("keeps non-stack package metadata in the compatibility layer", () => {
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /ELSE compatibility\.item_name/);
    assert.match(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /compatibility\.metadata_json/);
    assert.doesNotMatch(CANONICAL_PACKAGE_ITEM_DEFINITION_SELECT, /package_definitions|package_contents|package_purchases/);
  });
});
