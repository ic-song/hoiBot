import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.ts";
import { loadConfig } from "../../src/config.ts";
import { createEnvironmentContext, verifyStartupDatabaseIdentity } from "../../src/runtime/environment-context.ts";

const MODULE_EXECUTION_ID = randomUUID();
const assert = (value, message) => { if (!value) throw new Error(message); };

// 실제 Fastify Iris 진입점에서 타이틀 조회가 등록 별칭과 현대화 handler를 거쳐 응답되는지 실행합니다.
export async function executeWave30PlayerTitleRead(input) {
  const { binding, database } = input;
  const previousDispatch = process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
  process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = "true";

  let serviceInvocationCount = 0;
  const originalWithTransaction = database.withTransaction.bind(database);
  database.withTransaction = async work => {
    const stack = new Error("Wave30 transaction entry").stack ?? "";
    if (stack.split(/\r?\n/u).some(frame => frame.includes("PlayerTitleReadService.read"))) {
      serviceInvocationCount += 1;
    }
    return originalWithTransaction(work);
  };

  const replies = [];
  let response;
  try {
    const token = "wave30-in-memory-token";
    const config = loadConfig({
      NODE_ENV: "test",
      HOIBOT_ENVIRONMENT_CODE: "dev",
      IRIS_SHARED_TOKEN: token,
      USER_VERIFICATION_PEPPER: "wave30-in-memory-pepper",
      DATABASE_ENABLED: "true",
      DATABASE_HOST: "127.0.0.1",
      DATABASE_PORT: "3331",
      DATABASE_USER: "unused",
      DATABASE_PASSWORD: "unused",
      DATABASE_NAME: "wave30_synthetic",
    });
    const environmentContext = await verifyStartupDatabaseIdentity(
      database,
      createEnvironmentContext({ environmentCode: "dev", databaseIdentity: "wave30_synthetic" }),
    );
    const app = buildApp(config, {
      database,
      environmentContext,
      inspectIrisChannel: async () => ({
        mode: "operational",
        channelClass: "open_group",
        reason: "allowed",
        evidence: { roomType: "OM", openLinkActive: true, openLinkExpired: false },
      }),
      sendIrisTextReply: async reply => { replies.push(reply); },
      sendIrisImageReply: async () => { throw new Error("Wave30 unexpected image reply"); },
    });
    try {
      response = await app.inject({
        method: "POST",
        url: `/api/v1/integrations/iris/events?token=${token}`,
        payload: {
          msg: binding.input,
          room: "Wave30 타이틀방",
          json: {
            _id: `wave30-${binding.scenarioId}`,
            chat_id: "wave30-room",
            user_id: "tester",
            type: 1,
            v: { origin: "MSG", isMine: false },
          },
        },
      });
    } finally {
      await app.close();
    }
  } finally {
    database.withTransaction = originalWithTransaction;
    if (previousDispatch === undefined) delete process.env.PARTIAL_COMMAND_DISPATCH_ENABLED;
    else process.env.PARTIAL_COMMAND_DISPATCH_ENABLED = previousDispatch;
  }

  const body = JSON.parse(response.body);
  const evidence = database.evidence();
  const reply = replies[0]?.data ?? "NO_REPLY";
  const expectedHandler = binding.kind === "list" ? "player_title_list_read" : "player_title_info_read";
  const expectedCandidate = binding.scenarioKind !== "NEGATIVE_GUARD";
  const expectedAliasQueries = expectedCandidate || binding.kind === "info" ? 1 : 0;
  const expectedNegativeRoute = binding.kind === "info" ? "LEGACY_FALLBACK" : null;

  assert(response.statusCode === 202, `Wave30 HTTP status drift: ${binding.scenarioId}`);
  assert(body.accepted === true && body.ignored === false && body.duplicate === false, `Wave30 ingress semantics drift: ${binding.scenarioId}`);
  assert(reply === binding.expectedReply, `Wave30 exact reply drift: ${binding.scenarioId}; actual=${JSON.stringify(reply)} expected=${JSON.stringify(binding.expectedReply)}`);
  assert(evidence.sourceDomainDmlCount === 0, `Wave30 source-domain DML detected: ${binding.scenarioId}`);
  if (expectedCandidate) {
    assert(serviceInvocationCount === 1, `Wave30 service invocation drift: ${binding.scenarioId}`);
    assert(evidence.registryAliasQueryCount === expectedAliasQueries, `Wave30 registry alias lookup drift: ${binding.scenarioId}`);
    assert(evidence.lastRoute === "MODERN" && evidence.lastHandlerKey === expectedHandler, `Wave30 dispatch decision drift: ${binding.scenarioId}`);
    assert(evidence.titleDomainQueryCount > 0, `Wave30 title domain query missing: ${binding.scenarioId}`);
  } else {
    assert(serviceInvocationCount === 0, `Wave30 negative guard invoked service: ${binding.scenarioId}`);
    assert(evidence.registryAliasQueryCount === expectedAliasQueries, `Wave30 negative guard alias lookup drift: ${binding.scenarioId}`);
    assert(evidence.titleDomainQueryCount === 0, `Wave30 negative guard queried title domain: ${binding.scenarioId}`);
    assert(replies.length === 0, `Wave30 negative guard emitted reply: ${binding.scenarioId}`);
    assert(evidence.lastRoute === expectedNegativeRoute && evidence.lastHandlerKey === null, `Wave30 negative guard route drift: ${binding.scenarioId}`);
  }

  const result = JSON.stringify({
    statusCode: response.statusCode,
    accepted: body.accepted,
    ignored: body.ignored,
    duplicate: body.duplicate,
    route: evidence.lastRoute,
    handlerKey: evidence.lastHandlerKey,
    serviceInvocationCount,
    registryAliasQueryCount: evidence.registryAliasQueryCount,
    titleDomainQueryCount: evidence.titleDomainQueryCount,
    sourceDomainDmlCount: evidence.sourceDomainDmlCount,
    replyCount: replies.length,
  });
  return {
    executedConsumerId: binding.consumerId,
    executedCaseId: `case:wave30:${binding.consumerId}`,
    moduleExecutionId: MODULE_EXECUTION_ID,
    assertionCount: expectedCandidate ? 8 : 9,
    reply,
    result,
    databaseEvidence: evidence,
  };
}
