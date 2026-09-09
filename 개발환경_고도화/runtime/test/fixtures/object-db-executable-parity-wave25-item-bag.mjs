import { randomUUID } from "node:crypto";

import { CanonicalItemBagDirectReadService, isCanonicalItemBagCommand } from "../../src/inventory/canonical-item-bag-direct-read-service.js";

const MODULE_EXECUTION_ID = randomUUID();
const assert = (value, message) => { if (!value) throw new Error(message); };
const normalize = (sql) => String(sql).replace(/\s+/g, " ").trim();
const EXACT_REPLY = "[🏆회원😀]의 가방🧳\n(알림📢)후원은 봇 개발에 많은 도움이됩니다.\n   1. 한글상자🎁 x 9007199254740993";

function makeDatabase() {
  const calls = [];
  const query = async (sql, values = []) => {
    const normalizedSql = normalize(sql);
    const rows = normalizedSql.includes("FROM guild_territory_start_scopes")
      ? [{ active: 0, lifecycle_state: "READY" }]
      : normalizedSql.includes("FROM operation_notice_heads")
        ? [{ version: 1n, string_value: "(알림📢)후원은 봇 개발에 많은 도움이됩니다." }]
        : [];
    calls.push({ channel: "query", normalizedSql, values, rowCount: rows.length });
    return rows;
  };
  const execute = async (sql) => { throw new Error(`Wave25 read consumer attempted DML: ${normalize(sql)}`); };
  return { database: { query, execute }, calls };
}

export async function executeWave25ItemBag({ binding }) {
  assert(binding.consumerId === "legacy-94904fa11988ff04", "Wave25 consumer binding drift");
  assert(binding.exportName === "executeWave25ItemBag", "Wave25 export binding drift");
  assert(binding.harnessCaseId === "case:wave25:item-bag", "Wave25 case binding drift");
  const message = binding.scenarioKind === "NEGATIVE_GUARD" ? "/가방 안내" : "/가방";
  const matched = isCanonicalItemBagCommand(message);
  const runtime = makeDatabase();
  let result = { status: "ignored", consumerId: binding.consumerId, reason: "COMMAND_GUARD_REJECTED" };
  if (matched) {
    const service = new CanonicalItemBagDirectReadService({
      read: async () => ({
        status: "ready",
        context: { legacyPlayerId: "legacy-player-1", canonicalPlayerId: "canonical-player-1" },
        parity: {
          cutoverReady: true,
          resultFingerprint: "a".repeat(64),
          legacyBag: { playerId: "legacy-player-1", ownerLabel: "unused", advertisement: "unused", items: [] },
          canonicalBag: { playerId: "canonical-player-1", ownerLabel: "unused", advertisement: "unused", items: [{ displayName: "한글상자🎁", quantity: "9007199254740993", legacyBagOrder: 1 }] },
        },
        ownerLabel: "🏆회원😀",
        importReady: true,
        intimacyKeyUnique: true,
      }),
    });
    result = await service.execute(runtime.database, { providerCode: "kakao", externalUserId: "wave25-user", externalContextId: "wave25-room" });
    assert(result.status === "direct_reply", "Wave25 positive result must be direct_reply");
    assert(result.data === EXACT_REPLY, `Wave25 exact output drift: ${result.data}`);
  } else {
    assert(runtime.calls.length === 0, "Wave25 negative guard reached the read service");
  }
  assert(runtime.calls.every((call) => call.channel === "query"), "Wave25 source-domain DML detected");
  const reply = result.status === "direct_reply" ? result.data : "NO_REPLY";
  return {
    executedConsumerId: binding.consumerId,
    executedCaseId: binding.harnessCaseId,
    moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: matched ? 5 : 4,
    reply,
    result: JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value),
    databaseEvidence: { calls: runtime.calls, sourceDomainDmlCount: 0 },
  };
}
