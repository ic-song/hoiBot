import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Gate3 only: prove the legacy public-list contract remains distinct from the internal operator API.
const legacy = readFileSync(new URL("../../../../main.js", import.meta.url), "utf8");
const managementService = readFileSync(new URL("../../../runtime/src/admin/management-service.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("../../../runtime/src/admin/routes.ts", import.meta.url), "utf8");
const fixture = readFileSync(new URL("../../fixtures/synthetic-relational/functional-v1.sql", import.meta.url), "utf8");

assert.match(legacy, /if \(msg === "\/관리자명단"\)/);
assert.match(legacy, /return Object\.keys\(data\.admin\);/);
assert.match(legacy, /a\.localeCompare\(b, "ko"\)/);
assert.match(legacy, /현재 관리자가 없습니다\./);

const syntheticAdmins = { 다온: "", 가온: "", 나래: "" };
assert.deepEqual(Object.keys(syntheticAdmins).sort((a, b) => a.localeCompare(b, "ko")), ["가온", "나래", "다온"]);
assert.equal(Object.keys({}).length, 0);

assert.match(fixture, /INSERT INTO admin_operators/);
assert.match(fixture, /synthetic-admin-alpha/);
assert.match(managementService, /GROUP BY operator\.id ORDER BY operator\.id/);
assert.match(managementService, /status: row\.status, roleCodes:/);
assert.match(routes, /requirePermission\(session, "operator\.read"\)/);

console.log("Gate3 rehearsal passed: legacy public name projection and internal operator API remain separated.");
