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

export async function executeWave10PendantRead(args) {
  let assertionCount = 0;
  const check = (value, message) => { assertionCount += 1; assert(value, message); };
  const parityCase = args.fixturePayload.cases.find((entry) => entry.caseId === args.harnessCaseId);
  const consumer = parityCase?.consumers.find((entry) => entry.consumerId === args.consumerId);
  const target = TARGETS[args.consumerId];
  check(Boolean(parityCase && consumer && target), "Wave10 case mapping drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const app = canonical(resolve(root, consumer.sourceLocator.file));
  const span = app.slice(consumer.sourceLocator.start, consumer.sourceLocator.end);
  check(sha(span) === consumer.sourceLocator.sha256 && span.includes(target[3]), "Wave10 app callback dispatch span drift");
  for (const locator of consumer.chainLocators) {
    const source = canonical(resolve(root, locator.file));
    check(sha(source.slice(locator.start, locator.end)) === locator.sha256 && source.slice(locator.start, locator.end).includes(locator.needle), `Wave10 chain drift: ${locator.file}`);
  }
  const serviceModule = await tsImport(pathToFileURL(resolve(root, `개발환경_고도화/runtime/src/${target[0]}`)).href, import.meta.url);
  const guard = serviceModule[target[1]];
  const input = consumer.scenarioInputsByScenario[args.scenarioKind];
  if (args.scenarioKind === "NEGATIVE_GUARD") {
    check(guard(input.message) === false, "Wave10 negative guard accepted");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: "INVALID_COMMAND_NO_CALL", result: "INVALID_COMMAND_NO_CALL" };
  }
  check(guard(input.message) === true, "Wave10 positive guard rejected");
  const dispatchModule = await tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts")).href, import.meta.url);
  const reader = new dispatchModule.MariaCommandRouteReader(args.database);
  const dispatcher = new dispatchModule.CommandDispatcher(reader, { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }, undefined);
  const decision = await dispatcher.resolveReadOnly({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true });
  check(decision.route === "MODERN" && decision.handlerKey === target[3], "Wave10 partial dispatch drift");
  // app.ts 분기의 모든 outer gate와 processing.replies projection을 동일 순서로 실행합니다.
  const normalizedEvent = { eventId: input.eventId, message: input.message, userId: input.externalUserId, channelId: input.destinationId };
  const processing = { duplicate: input.duplicate === true, replies: [] };
  const isOperationalChannel = input.isOperationalChannel !== false;
  let result;
  try {
    if (isOperationalChannel && processing !== undefined && !processing.duplicate
      && guard(normalizedEvent.message)
      && decision.route === "MODERN" && decision.handlerKey === target[3]
      && normalizedEvent.userId !== undefined && normalizedEvent.channelId !== undefined) {
      result = await new serviceModule[target[2]](args.database).handle({ eventId: normalizedEvent.eventId, externalUserId: normalizedEvent.userId, destinationId: normalizedEvent.channelId, message: normalizedEvent.message });
      if (result.status !== "silent") processing.replies.push({ outboxId: result.outboxId, room: normalizedEvent.channelId, data: result.data });
    }
  } catch (error) {
    if (!consumer.errorScenarios.includes(args.scenarioKind)) throw error;
    const raw = `ERROR:${error.code ?? error.message}`;
    check(raw === consumer.expectedResultsByScenario[args.scenarioKind], "Wave10 error result drift");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: raw };
  }
  if (args.scenarioKind === "APP_INBOX_DUPLICATE" || args.scenarioKind === "WRONG_OPERATIONAL_CHANNEL") {
    check(processing.replies.length === 0, "Wave10 rejected app gate emitted reply");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: "APP_GATE_REJECTED_NO_CALL", result: "APP_GATE_REJECTED_NO_CALL" };
  }
  if (args.scenarioKind === "MISSING_IDENTITY") {
    check(processing.replies.length === 0 && result?.status === "silent", "Wave10 missing identity emitted reply");
    const raw = JSON.stringify(result);
    check(raw === consumer.expectedResultsByScenario[args.scenarioKind], "Wave10 missing identity result drift");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: raw };
  }
  check(processing.replies.length === 1, "Wave10 app reply projection drift");
  check(processing.replies[0].room === input.destinationId && processing.replies[0].data === result?.data, "Wave10 app reply bytes drift");
  const raw = JSON.stringify(result);
  check(raw === consumer.expectedResultsByScenario[args.scenarioKind], "Wave10 service result drift");
  return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: result?.data ?? raw, result: raw };
}
