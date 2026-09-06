import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const TARGETS = {
  "runtime-dispatch-36d6721ade0707a6": ["market/pendant-market-info-service.ts", "isPendantMarketInfoCommandCandidate", "PendantMarketInfoService", "pendant_market_info"],
  "runtime-dispatch-8c6c3c3d598fe078": ["pet/pendant-info-service.ts", "isPendantInfoCommandCandidate", "PendantInfoService", "pendant_info_read"],
  "runtime-dispatch-19076db78c2eefb9": ["pet/pendant-probability-service.ts", "isPendantProbabilityCommand", "PendantProbabilityService", "pendant_probability_read"],
};
const canonical = (path) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const assert = (value, message) => { if (!value) throw new Error(message); };
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export async function executeWave10PendantRead(args) {
  let assertionCount = 0;
  const check = (value, message) => { assertionCount += 1; assert(value, message); };
  const parityCase = args.fixturePayload.cases.find((entry) => entry.caseId === args.harnessCaseId);
  const consumer = parityCase?.consumers.find((entry) => entry.consumerId === args.consumerId);
  const target = TARGETS[args.consumerId];
  check(Boolean(parityCase && consumer && target), "Wave10 case mapping drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const appSource = canonical(resolve(root, consumer.sourceLocator.file));
  const span = appSource.slice(consumer.sourceLocator.start, consumer.sourceLocator.end);
  check(sha(span) === consumer.sourceLocator.sha256 && span.includes(target[3]), "Wave10 app callback dispatch span drift");
  for (const locator of consumer.chainLocators) {
    const source = canonical(resolve(root, locator.file));
    const located = source.slice(locator.start, locator.end);
    check(sha(located) === locator.sha256 && located.includes(locator.needle), `Wave10 chain drift: ${locator.file}`);
  }

  const serviceModule = await tsImport(pathToFileURL(resolve(root, `개발환경_고도화/runtime/src/${target[0]}`)).href, import.meta.url);
  const Service = serviceModule[target[2]];
  const guard = serviceModule[target[1]];
  const input = consumer.scenarioInputsByScenario[args.scenarioKind];
  check(typeof Service === "function" && typeof guard === "function", "Wave10 production service export drift");
  check(guard(input.message) === (args.scenarioKind !== "NEGATIVE_GUARD"), "Wave10 command guard drift");

  const expectedOracle = consumer.httpOracleByScenario[args.scenarioKind];
  const evidenceRows = { ...expectedOracle.evidenceRowsBefore };
  const evidenceTables = new Set(Object.keys(evidenceRows));
  let serviceInvocationCount = 0;
  const originalQuery = args.database.query.bind(args.database);
  const originalExecute = args.database.execute.bind(args.database);
  const originalWithTransaction = args.database.withTransaction.bind(args.database);
  args.database.query = async (sql, values = []) => {
    const normalizedSql = String(sql).replace(/\s+/g, " ").trim();
    if (normalizedSql.includes("SELECT identity.id identity_id,identity.player_id")
      || normalizedSql.includes("SELECT identity.id identity_id,profile.player_id")
      || (normalizedSql.includes("SELECT identity.id identity_id") && normalizedSql.includes("FROM external_identities identity")))
      serviceInvocationCount += 1;
    return originalQuery(sql, values);
  };
  args.database.execute = async (sql, values = []) => {
    const result = await originalExecute(sql, values);
    const table = /^INSERT INTO\s+([A-Za-z0-9_]+)/i.exec(String(sql).replace(/\s+/g, " ").trim())?.[1];
    if (table !== undefined && evidenceTables.has(table)) evidenceRows[table] += Number(result.affectedRows);
    return result;
  };
  args.database.withTransaction = async (work) => {
    const state = { ...evidenceRows };
    try { return await originalWithTransaction((transaction) => work(transaction)); }
    catch (error) { Object.assign(evidenceRows, state); throw error; }
  };
  const snapshot = () => ({ ...evidenceRows });
  const before = snapshot();
  const sentReplies = [];
  let response;
  try {
    const configModule = await tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/config.ts")).href, import.meta.url);
    const appModule = await tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/app.ts")).href, import.meta.url);
    const token = "wave10-in-memory-token";
    const config = configModule.loadConfig({
      NODE_ENV: "test", HOIBOT_ENVIRONMENT_CODE: "dev", IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave10-in-memory-pepper", DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1", DATABASE_PORT: "3306", DATABASE_USER: "unused",
      DATABASE_PASSWORD: "unused", DATABASE_NAME: "unused",
    });
    const rejectedByChannel = args.scenarioKind === "WRONG_OPERATIONAL_CHANNEL";
    const app = appModule.buildApp(config, {
      database: args.database,
      inspectIrisChannel: async () => rejectedByChannel
        ? { mode: "denied", channelClass: "open_group", reason: "not_designated", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } }
        : { mode: "operational", channelClass: "open_group", reason: "allowed", evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false } },
      sendIrisTextReply: async (reply) => { sentReplies.push(reply); },
      sendIrisImageReply: async () => { throw new Error("Wave10 unexpected image reply"); },
    });
    try {
      response = await app.inject({
        method: "POST", url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: { msg: input.message, room: "Wave10 펜던트방", json: { _id: input.providerEventId, chat_id: input.destinationId, user_id: input.externalUserId } },
      });
    } finally {
      await app.close();
    }
  } finally {
    args.database.query = originalQuery;
    args.database.execute = originalExecute;
    args.database.withTransaction = originalWithTransaction;
  }
  const after = snapshot();
  const body = JSON.parse(response.body);
  check(response.statusCode === expectedOracle.statusCode, "Wave10 HTTP status drift");
  check(body.accepted === expectedOracle.accepted && body.ignored === expectedOracle.ignored
    && (body.channelMode ?? null) === expectedOracle.channelMode && (body.duplicate ?? false) === expectedOracle.duplicate,
  "Wave10 HTTP response semantics drift");
  check(serviceInvocationCount === expectedOracle.serviceInvocationCount, "Wave10 service invocation count drift");
  check(equal(before, expectedOracle.evidenceRowsBefore) && equal(after, expectedOracle.evidenceRowsAfter), "Wave10 evidence row snapshot drift");
  check(equal(sentReplies, expectedOracle.sentReplies), "Wave10 reply callback drift");
  if (["NEGATIVE_GUARD", "APP_INBOX_DUPLICATE", "WRONG_OPERATIONAL_CHANNEL"].includes(args.scenarioKind))
    check(serviceInvocationCount === 0, "Wave10 rejected ingress invoked service");
  if (["NEGATIVE_GUARD", "MISSING_IDENTITY", "WRONG_OPERATIONAL_CHANNEL"].includes(args.scenarioKind))
    check(equal(after, { operations: 0, outbox_messages: 0, command_executions: 0, command_audit: 0 }), "Wave10 rejected ingress changed business evidence");
  if (args.scenarioKind === "APP_INBOX_DUPLICATE")
    check(equal(after, before), "Wave10 duplicate ingress changed business evidence");

  const reply = sentReplies[0]?.data ?? expectedOracle.noReplyCode;
  const result = JSON.stringify({
    statusCode: response.statusCode, accepted: body.accepted, ignored: body.ignored,
    channelMode: body.channelMode ?? null, duplicate: body.duplicate ?? false,
    serviceInvocationCount, evidenceRowsBefore: before, evidenceRowsAfter: after, sentReplies,
  });
  check(reply === consumer.expectedReplyByScenario[args.scenarioKind], "Wave10 exact reply bytes drift");
  check(result === consumer.expectedResultsByScenario[args.scenarioKind], "Wave10 exact ingress result drift");
  return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply, result };
}
