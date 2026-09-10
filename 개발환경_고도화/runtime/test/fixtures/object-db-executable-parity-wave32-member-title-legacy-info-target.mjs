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
  assert(start >= 0, `Wave32 legacy helper missing: ${name}`);
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
  throw new Error(`Wave32 legacy helper unclosed: ${name}`);
}

function legacyTitleInfoReply(source, binding) {
  const start = source.indexOf('if (msg.startsWith("/타이틀정보"))');
  const end = source.indexOf('if (msg.startsWith("/타이틀판매"))', start);
  assert(start >= 0 && end > start, "Wave32 exact main.js title-info branch missing");
  const helpers = ["formatDateTime", "numberWithCommas", "getMyGuildId", "getMyGuildInfo", "getGuildMasterRankEmoji", "checkRank"]
    .map(name => extractBalancedFunction(source, name)).join("\n");
  const replies = [];
  const execute = new Function("msg", "sender", "data", "petData", "guildData", "replier", "castleSiegeFlag", "loadJsonFile", "memberTitlePath", "guildPath",
    `${helpers}\n${source.slice(start, end)}`);
  execute(binding.input, binding.sender, binding.legacy.data, {}, binding.legacy.guildData,
    { reply: value => replies.push(String(value)) }, binding.castleSiegeFlag,
    path => { assert(path === "synthetic-member-title-path", `Wave32 unexpected legacy load: ${path}`); return binding.legacy.titleData; },
    "synthetic-member-title-path", "synthetic-guild-path");
  return replies[0] ?? "NO_REPLY";
}

// 커밋된 main.js 상세 분기와 실제 Fastify·PlayerTitleReadService의 같은 입력 결과를 독립 실행합니다.
export async function executeWave32MemberTitleLegacyInfo(input) {
  const { binding, database, evidenceCommit } = input;
  const root = resolve(import.meta.dirname, "../../../..");
  const committedMain = execFileSync("git", ["show", `${evidenceCommit}:main.js`], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert(readFileSync(resolve(root, "main.js"), "utf8").replace(/\r\n?/gu, "\n") === committedMain.replace(/\r\n?/gu, "\n"), "Wave32 main.js worktree/commit drift");
  const legacyReply = legacyTitleInfoReply(committedMain, binding);

  const previousDispatch = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";
  let serviceInvocationCount = 0;
  const originalWithTransaction = database.withTransaction.bind(database);
  database.withTransaction = async work => {
    const stack = new Error("Wave32 transaction entry").stack ?? "";
    if (stack.split(/\r?\n/u).some(frame => frame.includes("PlayerTitleReadService.read"))) serviceInvocationCount += 1;
    return originalWithTransaction(work);
  };
  const replies = [];
  let response;
  try {
    const token = "wave32-in-memory-token";
    const config = loadConfig({ NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave32-in-memory-pepper", DATABASE_ENABLED: "true", DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "3332", DATABASE_USER: "unused", DATABASE_PASSWORD: "unused", DATABASE_NAME: "wave32_synthetic" });
    const environmentContext = await verifyStartupDatabaseIdentity(database, createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave32_synthetic" }));
    const app = buildApp(config, { database, environmentContext,
      inspectIrisChannel: async () => ({ mode: "operational", channelClass: "open_group", reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false, castleSiegeActive: binding.castleSiegeFlag } }),
      sendIrisTextReply: async reply => { replies.push(reply); },
      sendIrisImageReply: async () => { throw new Error("Wave32 unexpected image reply"); } });
    try {
      response = await app.inject({ method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: binding.input, room: "Wave32 타이틀방", json: { _id: `wave32-${binding.scenarioId}`, chat_id: "wave32-room", user_id: "tester", type: 1, v: { origin: "MSG", isMine: false } } } });
    } finally { await app.close(); }
  } finally {
    database.withTransaction = originalWithTransaction;
    if (previousDispatch === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED; else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousDispatch;
  }
  const body = JSON.parse(response.body), evidence = database.evidence(), modernReply = replies[0]?.data ?? "NO_REPLY";
  assert(response.statusCode === 202 && body.accepted === true && body.ignored === false && body.duplicate === false, `Wave32 ingress drift: ${binding.scenarioId}`);
  assert(legacyReply === binding.expectedReply, `Wave32 legacy reply drift: ${binding.scenarioId}`);
  assert(evidence.sourceDomainDmlCount === 0, `Wave32 source-domain DML detected: ${binding.scenarioId}`);
  assert(serviceInvocationCount === 1 && evidence.lastRoute === "MODERN" && evidence.lastHandlerKey === "player_title_info_read", `Wave32 modern dispatch drift: ${binding.scenarioId}`);
  assert(evidence.registryAliasQueryCount === 1, `Wave32 alias lookup drift: ${binding.scenarioId}`);
  const parityMatch = modernReply === legacyReply;
  const result = JSON.stringify({ statusCode: response.statusCode, route: evidence.lastRoute, handlerKey: evidence.lastHandlerKey,
    castleSiegeActive: binding.castleSiegeFlag, serviceInvocationCount, registryAliasQueryCount: evidence.registryAliasQueryCount,
    titleDomainQueryCount: evidence.titleDomainQueryCount, sourceDomainDmlCount: evidence.sourceDomainDmlCount,
    legacyReply, modernReply, parityMatch, replyCount: replies.length });
  return { executedConsumerId: binding.consumerId, executedCaseId: `case:wave32:${binding.consumerId}`, moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: 5, reply: modernReply, result, legacyReply, modernReply, parityMatch, databaseEvidence: evidence };
}
