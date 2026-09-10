import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../../src/runtime/environment-context.ts";

const MODULE_EXECUTION_ID = randomUUID();
const assert = (value, message) => { if (!value) throw new Error(message); };

function extractBalancedFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `Wave31 legacy helper missing: ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index], next = source[index + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; index += 1; } continue; }
    if (quote !== null) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === quote) quote = null; continue; }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === "\"" || char === "'" || char === "`") { quote = char; continue; }
    if (char === "{") depth += 1;
    if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Wave31 legacy helper unclosed: ${name}`);
}

function legacyTitleListReply(source, binding) {
  const start = source.indexOf('if (msg === "/타이틀목록")');
  const end = source.indexOf('if (msg === "/펫타이틀목록")', start);
  assert(start >= 0 && end > start, "Wave31 exact Info.js title-list branch missing");
  const helpers = ["formatDateTime", "numberWithCommas", "getMyGuildId", "getMyGuildInfo", "getGuildMasterRankEmoji", "checkRank"]
    .map(name => extractBalancedFunction(source, name)).join("\n");
  const replies = [];
  const execute = new Function("msg", "sender", "titleData", "data", "petData", "guildData", "replier", "isAdmin", "allsee", `${helpers}\n${source.slice(start, end)}`);
  execute(binding.input, binding.sender, binding.legacy.titleData, binding.legacy.data, {}, binding.legacy.guildData,
    { reply: value => replies.push(String(value)) }, () => binding.authorized, "\u200b".repeat(500));
  return replies[0] ?? "NO_REPLY";
}

// 커밋된 Info.js 분기와 실제 Fastify·PlayerTitleReadService를 같은 입력으로 실행해 응답을 비교합니다.
export async function executeWave31MemberTitleLegacyList(input) {
  const { binding, database, evidenceCommit } = input;
  const root = resolve(import.meta.dirname, "../../../..");
  const committedInfo = execFileSync("git", ["show", `${evidenceCommit}:Info.js`], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert(readFileSync(resolve(root, "Info.js"), "utf8").replace(/\r\n?/gu, "\n") === committedInfo.replace(/\r\n?/gu, "\n"), "Wave31 Info.js worktree/commit drift");
  const legacyReply = legacyTitleListReply(committedInfo, binding);
  const previousDispatch = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  let serviceInvocationCount = 0;
  const originalWithTransaction = database.withTransaction.bind(database);
  database.withTransaction = async work => {
    const stack = new Error("Wave31 transaction entry").stack ?? "";
    if (stack.split(/\r?\n/u).some(frame => frame.includes("PlayerTitleReadService.read"))) serviceInvocationCount += 1;
    return originalWithTransaction(work);
  };
  const replies = [];
  let response;
  try {
    const token = "wave31-in-memory-token";
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave31-in-memory-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "3331", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave31_synthetic" });
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave31_synthetic" }));
    const app = buildApp(config, { database, environmentContext,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }),
      sendIrisTextReply: async reply => { replies.push(reply); }, sendIrisImageReply: async () => { throw new Error("Wave31 unexpected image reply"); } });
    try {
      response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: binding.input, room: "Wave31 타이틀방", json: { _id: `wave31-${binding.scenarioId}`, chat_id: "wave31-room", user_id: "tester", type: 1, v: { origin: "MSG", isMine: false } } } });
    } finally { await app.close(); }
  } finally {
    database.withTransaction = originalWithTransaction;
    if (previousDispatch === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousDispatch;
  }
  const body = JSON.parse(response.body), evidence = database.evidence(), modernReply = replies[0]?.data ?? "NO_REPLY";
  const candidate = binding.input === "/타이틀목록" || binding.input.startsWith("/타이틀목록 ");
  assert(response.statusCode === 202 && body.accepted === true && body.ignored === false && body.duplicate === false, `Wave31 ingress drift: ${binding.scenarioId}`);
  assert(legacyReply === binding.expectedReply, `Wave31 legacy reply drift: ${binding.scenarioId}`);
  assert(modernReply === legacyReply, `Wave31 legacy/modern parity drift: ${binding.scenarioId}`);
  assert(evidence.sourceDomainDmlCount === 0, `Wave31 source-domain DML detected: ${binding.scenarioId}`);
  if (candidate) {
    assert(serviceInvocationCount === 1 && evidence.lastRoute === "MODERN" && evidence.lastHandlerKey === "player_title_list_read", `Wave31 modern dispatch drift: ${binding.scenarioId}`);
    assert(evidence.registryAliasQueryCount === 1, `Wave31 alias lookup drift: ${binding.scenarioId}`);
  } else {
    assert(serviceInvocationCount === 0 && evidence.lastRoute === null && evidence.lastHandlerKey === null, `Wave31 negative guard drift: ${binding.scenarioId}`);
    assert(evidence.registryAliasQueryCount === 0 && evidence.titleDomainQueryCount === 0 && replies.length === 0, `Wave31 negative guard side effect: ${binding.scenarioId}`);
  }
  const result = JSON.stringify({ statusCode: response.statusCode, route: evidence.lastRoute, handlerKey: evidence.lastHandlerKey,
    serviceInvocationCount, registryAliasQueryCount: evidence.registryAliasQueryCount, titleDomainQueryCount: evidence.titleDomainQueryCount,
    sourceDomainDmlCount: evidence.sourceDomainDmlCount, legacyReply, modernReply, replyCount: replies.length });
  return { executedConsumerId: binding.consumerId, executedCaseId: `case:wave31:${binding.consumerId}`, moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: candidate ? 7 : 8, reply: modernReply, result, databaseEvidence: evidence };
}
