import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AdminBalanceReadModelProvider } from "../src/admin/admin-balance-read-model.js";
import { PendantPolicyCatalogReadProvider } from "../src/pet/pendant-policy-catalog.js";
import { ADMIN_BALANCE_PENDANT_POLICY, createAdminBalanceReadFixture } from "./fixtures/admin-balance-read-model.js";

const pendantProvider = () => new PendantPolicyCatalogReadProvider({
  findPublished: async () => ADMIN_BALANCE_PENDANT_POLICY,
});

const readFixture = () => new AdminBalanceReadModelProvider(createAdminBalanceReadFixture(), pendantProvider()).read();

describe("admin balance read model", () => {
  it("projects every value with the exact typed management fields", async () => {
    const result = await readFixture();
    assert.deepEqual(result.domains.map((domain) => domain.domain), ["home_badge", "home_furniture", "pendant"]);
    for (const domain of result.domains) {
      assert.ok(domain.version.length > 0);
      assert.ok(domain.source.length > 0);
      for (const value of domain.values) {
        assert.deepEqual(Object.keys(value).sort(), [
          "domain", "editable", "group", "key", "label", "max", "min", "source", "step", "sumGroup", "unit", "value", "version",
        ]);
        assert.equal(value.domain, domain.domain);
        assert.equal(value.version, domain.version);
        assert.equal(value.source, domain.source);
      }
    }
  });

  it("projects home badge criteria as stable editable integer thresholds", async () => {
    const badge = (await readFixture()).domains[0]!;
    assert.equal(badge.version, "930000002");
    assert.equal(badge.values.length, 3);
    assert.deepEqual(badge.values.map((value) => [value.key, value.value, value.unit, value.step]), [
      ["home_badge.F01.criteria.followers", "1", "명", "1"],
      ["home_badge.A01.criteria.followers", "10", "명", "1"],
      ["home_badge.A01.criteria.receivedHomeLikes", "10", "회", "1"],
    ]);
    assert.equal(badge.values.every((value) => value.editable), true);
  });

  it("keeps furniture probability sum metadata and derived entry counts separate", async () => {
    const furniture = (await readFixture()).domains[1]!;
    const probabilities = furniture.values.filter((value) => value.sumGroup !== null);
    assert.deepEqual(probabilities.map((value) => value.value), ["99.959", "0.041"]);
    assert.equal(probabilities.every((value) => value.sumGroup === "home_furniture.grade.probability"), true);
    assert.equal(probabilities.reduce((sum, value) => sum + Number(value.value), 0), 100);
    assert.equal(furniture.values.find((value) => value.key.endsWith("entry_count"))?.editable, false);
  });

  it("projects all 30 pendant levels without numeric precision loss", async () => {
    const pendant = (await readFixture()).domains[2]!;
    assert.equal(pendant.version, "1");
    assert.equal(pendant.values.length, 150);
    assert.deepEqual(pendant.values.slice(0, 5).map((value) => [value.key, value.value, value.unit]), [
      ["pendant.level.1.success_rate", "100.000000", "%"],
      ["pendant.level.1.charm_increment", "5000", "💕"],
      ["pendant.level.1.explore_increment", "1.000000", "탐험"],
      ["pendant.level.1.point_cost", "1000000000", "포인트"],
      ["pendant.level.1.stone_cost", "1", "개"],
    ]);
  });

  it("fails closed for invalid badge criteria and furniture probability totals", async () => {
    await assert.rejects(
      new AdminBalanceReadModelProvider(createAdminBalanceReadFixture({ invalidBadgeCriteria: true }), pendantProvider()).read(),
      /HOME_BADGE_CRITERIA_VALUE_INVALID/,
    );
    await assert.rejects(
      new AdminBalanceReadModelProvider(createAdminBalanceReadFixture({ furnitureScaleMismatch: true }), pendantProvider()).read(),
      /HOME_FURNITURE_RATE_SCALE_MISMATCH/,
    );
  });

  it("returns identical read-only data for desktop and mobile Shadow consumers", async () => {
    const [desktop, mobile] = await Promise.all([readFixture(), readFixture()]);
    assert.deepEqual(mobile, desktop);
    assert.equal(desktop.domains.flatMap((domain) => domain.values).length, 157);
  });
});
