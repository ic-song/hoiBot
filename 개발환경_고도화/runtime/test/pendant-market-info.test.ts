import assert from "node:assert/strict";
import { describe,it } from "node:test";
import { isPendantMarketInfoCommandCandidate,normalizePendantMarketInfoDispatchMessage,parsePendantMarketInfoCommand } from "../src/market/pendant-market-info-service.js";
describe("pendant market info command",()=>{
 it("preserves usage, invalid and numeric legacy branches",()=>{assert.deepEqual(parsePendantMarketInfoCommand("/펜던트거래정보"),{kind:"usage"});assert.deepEqual(parsePendantMarketInfoCommand("/펜던트거래정보 안내"),{kind:"invalid"});assert.deepEqual(parsePendantMarketInfoCommand("/펜던트거래정보 3"),{kind:"lookup",displayNo:3n});});
 it("rejects suffix misses outside the outer guard and normalizes candidates",()=>{assert.equal(isPendantMarketInfoCommandCandidate("/펜던트거래정보 3 안내"),true);assert.equal(isPendantMarketInfoCommandCandidate("/펜던트거래정보추가 3"),false);assert.equal(normalizePendantMarketInfoDispatchMessage("/펜던트거래정보 3"),"/펜던트거래정보");});
});
