import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const TARGETS = {
  "admin-command-0ab0acb6f570d48c": {
    guardFile: "개발환경_고도화/runtime/src/admin/data-status-service.ts",
    guard: "isDataStatusCommand",
    symbol: "isDataStatusCommand",
  },
  "admin-command-115e33dcf567dd08": {
    guardFile: "개발환경_고도화/runtime/src/pet/pet-owner-read-service.ts",
    guard: "isPetOwnerReadCommand",
    symbol: "isPetOwnerReadCommand",
  },
  "admin-command-3a76b9ad462b6143": {
    guardFile: "개발환경_고도화/runtime/src/ring/ring-read-service.ts",
    guard: "isRingReadCommandCandidate",
    symbol: "isRingReadCommandCandidate",
  },
  "admin-command-5e04d0767d4c2abc": {
    guardFile: "개발환경_고도화/runtime/src/admin/server-stats-service.ts",
    guard: "isServerStatsCommand",
    symbol: "isServerStatsCommand",
  },
};
function assert(value, message) {
  if (!value) throw new Error(message);
}
function canonical(path) {
  return readFileSync(path, "utf8").replace(/\r\n?/g, "\n");
}
function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function executeWave8AdminChain(args) {
  let assertionCount = 0;
  const check = (value, message) => {
    assertionCount += 1;
    assert(value, message);
  };
  const parityCase = args.fixturePayload.cases.find(
      (candidate) => candidate.caseId === args.harnessCaseId,
    ),
    consumer = parityCase?.consumers.find(
      (candidate) => candidate.consumerId === args.consumerId,
    ),
    target = TARGETS[args.consumerId];
  check(Boolean(parityCase && consumer && target), "Wave8 case mapping drift");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const adminSource = canonical(resolve(root, consumer.sourceLocator.file)),
    adminSpan = adminSource.slice(
      consumer.sourceLocator.start,
      consumer.sourceLocator.end,
    );
  check(
    hash(adminSpan) === consumer.sourceLocator.sha256 &&
      adminSpan.includes(target.symbol),
    "Wave8 frozen admin dispatch span drift",
  );
  for (const locator of consumer.chainLocators) {
    const source = canonical(resolve(root, locator.file)),
      span = source.slice(locator.start, locator.end);
    check(
      hash(span) === locator.sha256 && span.includes(locator.needle),
      `Wave8 chain source drift: ${locator.file}`,
    );
  }
  const guardModule = await tsImport(
      pathToFileURL(resolve(root, target.guardFile)).href,
      import.meta.url,
    ),
    guard = guardModule[target.guard];
  check(typeof guard === "function", "Wave8 guard export drift");
  const input = consumer.scenarioInputsByScenario[args.scenarioKind];
  if (args.scenarioKind === "NEGATIVE_GUARD") {
    check(guard(input.message) === false, "Wave8 invalid guard accepted input");
    return {
      executedConsumerId: args.consumerId,
      executedCaseId: args.harnessCaseId,
      moduleExecutionId: MODULE_EXECUTION_ID,
      assertionCount,
      reply: consumer.expectedResultsByScenario.NEGATIVE_GUARD,
      result: consumer.expectedResultsByScenario.NEGATIVE_GUARD,
    };
  }
  check(guard(input.message) === true, "Wave8 positive guard rejected input");
  const adminModule = await tsImport(
    pathToFileURL(
      resolve(
        root,
        "개발환경_고도화/runtime/src/admin/iris-admin-command-service.ts",
      ),
    ).href,
    import.meta.url,
  );
  const service = new adminModule.IrisAdminCommandService(args.database);
  let raw;
  try {
    raw = JSON.stringify(await service.changePlayerPoint(input));
  } catch (error) {
    if (!consumer.errorScenarios.includes(args.scenarioKind)) throw error;
    raw = `ERROR:${error.code ?? error.message}`;
  }
  check(
    raw === consumer.expectedResultsByScenario[args.scenarioKind],
    "Wave8 admin result drift",
  );
  return {
    executedConsumerId: args.consumerId,
    executedCaseId: args.harnessCaseId,
    moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount,
    reply: raw,
    result: raw,
  };
}
