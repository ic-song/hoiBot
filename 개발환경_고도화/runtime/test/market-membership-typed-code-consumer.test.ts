import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DatabaseTransaction } from "../src/database.js";
import { FREE_MARKET_MEMBERSHIP_ITEM_CODE, hasFreeMarketMembership } from "../src/market/free-market-membership.js";

interface Fixture { itemCode: string; consumerFiles: string[]; semantics: { registrationBaseLimit: number; membershipLimitBonus: number; standardFeeBasisPoints: number; membershipFeeBasisPoints: number; cancelRefundRequiresMembership: boolean; membershipConsumed: boolean; nonTradeBehaviorChanged: boolean; uiDisplayNameChanged: boolean } }
const fixture = JSON.parse(readFileSync(new URL("../../migration-control/fixtures/synthetic-relational/market-membership-typed-code-consumer-v1.json", import.meta.url), "utf8")) as Fixture;

describe("market membership typed-code consumer", () => {
  it("uses stable item code and positive inventory stack without mutation", async () => {
    const results = [1n, 1n, 0n];
    const queries: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    const reader = { query: async <T>(sql: string, params?: readonly unknown[]): Promise<T> => { queries.push({ sql, params }); return [{ allowed: results.shift() ?? 0n }] as unknown as T; } } as Pick<DatabaseTransaction, "query">;
    assert.equal(await hasFreeMarketMembership(reader, 9007199254740993n), true);
    assert.equal(await hasFreeMarketMembership(reader, 9007199254740993n), true);
    assert.equal(await hasFreeMarketMembership(reader, 9007199254740993n), false);
    assert.equal(queries.length, 3);
    for (const query of queries) { const normalized=query.sql.replace(/\s+/g," "); assert.match(normalized,/inventory_stacks stack/); assert.match(normalized,/item_definitions item/); assert.match(normalized,/stack\.quantity>0/); assert.match(normalized,/item\.code='free_market_membership'/); assert.doesNotMatch(normalized,/display_name|INSERT|UPDATE|DELETE/i); assert.deepEqual(query.params,[9007199254740993n]); }
  });
  it("connects all seven consumers to one typed predicate", () => {
    assert.equal(FREE_MARKET_MEMBERSHIP_ITEM_CODE, fixture.itemCode); assert.equal(fixture.consumerFiles.length,7);
    for(const file of fixture.consumerFiles){const source=readFileSync(new URL(`../src/market/${file}`,import.meta.url),"utf8");assert.match(source,/free-market-membership\.js/);assert.doesNotMatch(source,/item\.display_name='자유시장회원권🏪'/);}
  });
  it("freezes limit, fee, refund, nonconsume, and nontrade parity",()=>{assert.deepEqual(fixture.semantics,{registrationBaseLimit:1,membershipLimitBonus:7,standardFeeBasisPoints:1000,membershipFeeBasisPoints:500,cancelRefundRequiresMembership:true,membershipConsumed:false,nonTradeBehaviorChanged:false,uiDisplayNameChanged:false});});
});
