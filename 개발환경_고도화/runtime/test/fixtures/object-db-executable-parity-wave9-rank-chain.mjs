import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const TARGETS = {
  "runtime-dispatch-465e4b3a15c003dc": ["player/player-cumulative-level-rank-read-service.ts", "isPlayerCumulativeLevelRankReadCommand", "PlayerCumulativeLevelRankReadService", "player_cumulative_level_rank_read"],
  "runtime-dispatch-9db5e3e6c256b5fa": ["player/player-cumulative-like-rank-read-service.ts", "isPlayerCumulativeLikeRankReadCommand", "PlayerCumulativeLikeRankReadService", "player_cumulative_like_rank_read"],
  "runtime-dispatch-eaa906ea249408a5": ["player/player-overall-rank-read-service.ts", "isPlayerOverallRankReadCommand", "PlayerOverallRankReadService", "player_overall_rank_read"],
  "runtime-dispatch-e02f58bf27070ab0": ["home/home-ranking-read-service.ts", "isHomeRankingReadCommand", "HomeRankingReadService", "home_ranking_read"],
  "runtime-dispatch-e54fc7fbded287c6": ["home/home-furniture-rank-read-service.ts", "isHomeFurnitureRankCommand", "HomeFurnitureRankReadService", "home_furniture_rank_read"],
};
const canonical = (path) => readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
const sha = (text) => createHash("sha256").update(text).digest("hex");
const assert = (value, message) => { if (!value) throw new Error(message); };

export async function executeWave9RankChain(args) {
  let assertionCount = 0;
  const check = (value, message) => { assertionCount += 1; assert(value, message); };
  const parityCase = args.fixturePayload.cases.find((entry) => entry.caseId === args.harnessCaseId);
  const consumer = parityCase?.consumers.find((entry) => entry.consumerId === args.consumerId);
  const target = TARGETS[args.consumerId];
  check(Boolean(parityCase && consumer && target), "Wave9 case mapping drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const app = canonical(resolve(root, consumer.sourceLocator.file));
  const span = app.slice(consumer.sourceLocator.start, consumer.sourceLocator.end);
  check(sha(span) === consumer.sourceLocator.sha256 && span.includes(target[3]), "Wave9 app callback dispatch span drift");
  for (const locator of consumer.chainLocators) {
    const source = canonical(resolve(root, locator.file));
    check(sha(source.slice(locator.start, locator.end)) === locator.sha256 && source.slice(locator.start, locator.end).includes(locator.needle), `Wave9 chain drift: ${locator.file}`);
  }
  const serviceModule = await tsImport(pathToFileURL(resolve(root, `개발환경_고도화/runtime/src/${target[0]}`)).href, import.meta.url);
  const guard = serviceModule[target[1]];
  const input = consumer.scenarioInputsByScenario[args.scenarioKind];
  if (args.scenarioKind === "NEGATIVE_GUARD") {
    check(guard(input.message) === false, "Wave9 negative guard accepted");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: "INVALID_COMMAND_NO_CALL", result: "INVALID_COMMAND_NO_CALL" };
  }
  check(guard(input.message) === true, "Wave9 positive guard rejected");
  const dispatchModule = await tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/dispatch/command-dispatcher.ts")).href, import.meta.url);
  const reader = new dispatchModule.MariaCommandRouteReader(args.database);
  const dispatcher = new dispatchModule.CommandDispatcher(reader, { enabled: true, allowAllCanaries: false, canaryUserIds: new Set() }, undefined);
  const decision = await dispatcher.resolveReadOnly({ eventId: input.eventId, message: input.message, userId: input.externalUserId, hasTrustedDisplayName: true });
  check(decision.route === "MODERN" && decision.handlerKey === target[3], "Wave9 partial dispatch drift");
  let result;
  try {
    result = await new serviceModule[target[2]](args.database).read({ eventId: input.eventId, externalUserId: input.externalUserId, destinationId: input.destinationId });
  } catch (error) {
    if (!consumer.errorScenarios.includes(args.scenarioKind)) throw error;
    const raw = `ERROR:${error.code ?? error.message}`;
    check(raw === consumer.expectedResultsByScenario[args.scenarioKind], "Wave9 error result drift");
    return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: raw, result: raw };
  }
  const raw = JSON.stringify(result);
  check(raw === consumer.expectedResultsByScenario[args.scenarioKind], "Wave9 service result drift");
  return { executedConsumerId: args.consumerId, executedCaseId: args.harnessCaseId, moduleExecutionId: MODULE_EXECUTION_ID, assertionCount, reply: result?.data ?? raw, result: raw };
}
