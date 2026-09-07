import { createHash, randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";

const MODULE_EXECUTION_ID = randomUUID();
const ORACLE = { chars: 2630, bytes: 5494, sha256: "4b1c023c26f0481d849044790b42d38a79d611b8971ee243af947ea0b2a9536a" };
const assert = (value, message) => { if (!value) throw new Error(message); };
const digest = value => createHash("sha256").update(value, "utf8").digest("hex");

export async function executeWave14PetSkillProbability(args) {
  let assertionCount = 0;
  const check = (value, message) => { assertionCount += 1; assert(value, message); };
  const parityCase = args.fixturePayload.cases.find(entry => entry.caseId === args.harnessCaseId);
  const consumer = parityCase?.consumers.find(entry => entry.consumerId === args.consumerId);
  check(Boolean(parityCase && consumer), "Wave14 case mapping drift");
  const input = consumer.scenarioInputsByScenario[args.scenarioKind];
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const [{ buildApp }, { loadConfig }] = await Promise.all([
    tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/app.ts")).href, import.meta.url),
    tsImport(pathToFileURL(resolve(root, "개발환경_고도화/runtime/src/config.ts")).href, import.meta.url)
  ]);
  const database = await args.createDatabase();
  const replies = [];
  const token = "wave14-formal-token";
  const config = loadConfig({ NODE_ENV:"test", HOIBOT_ENVIRONMENT_CODE:input.environment,
    IRIS_SHARED_TOKEN:token, USER_VERIFICATION_PEPPER:"wave14-formal-pepper", DATABASE_ENABLED:"true",
    DATABASE_HOST:"127.0.0.1", DATABASE_PORT:"3331", DATABASE_USER:"unused", DATABASE_PASSWORD:"unused", DATABASE_NAME:"wave14_formal" });
  const app = buildApp(config, { database, environmentContext:{ environmentCode:input.environment,databaseIdentity:"wave14_formal",verified:true },
    inspectIrisChannel:async()=>input.operational
      ? {mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}
      : {mode:"denied",channelClass:"open_group",reason:"not_designated",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}},
    sendIrisTextReply:async reply=>replies.push(reply) });
  let response;
  try {
    response = await app.inject({method:"POST",url:`/api/v1/integrations/iris/events?token=${token}`,payload:{
      msg:input.message, room:input.room, sender:input.displayName,
      json:{_id:input.providerEventId,chat_id:input.channelId,user_id:input.externalUserId}
    }});
  } finally { await app.close(); }
  const body = JSON.parse(response.body);
  const expectedReplyCount = input.replyCount;
  check(response.statusCode === input.statusCode, "Wave14 HTTP status drift");
  check(replies.length === expectedReplyCount, "Wave14 reply count drift");
  const reply = replies[0]?.data ?? input.noReplyCode;
  if (expectedReplyCount === 1) {
    check(reply === args.legacyExpectedReply, "Wave14 independent legacy full-byte fixture drift");
    check(reply.length === ORACLE.chars, "Wave14 legacy UTF-16 length drift");
    check(Buffer.byteLength(reply,"utf8") === ORACLE.bytes, "Wave14 legacy byte length drift");
    check(digest(reply) === ORACLE.sha256, "Wave14 independent legacy full-byte oracle drift");
    check(reply.startsWith(`📙 펫스킬북 확률표 📙\n\n${"\u200b".repeat(500)}\n━━━SS 등급━━━\n`), "Wave14 heading/folding drift");
    check(reply.endsWith("━━━━━━━━━━━━━━━\n총 확률: 100.0%"), "Wave14 footer drift");
  }
  const result = JSON.stringify({statusCode:response.statusCode,accepted:body.accepted??false,ignored:body.ignored??false,
    duplicate:body.duplicate??false,environment:input.environment,replyCount:replies.length,replySha256:replies[0]===undefined?null:digest(replies[0].data)});
  const databaseEvidence=database.evidence();
  if(args.scenarioKind==="NEGATIVE_GUARD"){
    check(databaseEvidence.canonicalQueries===0,"Wave14 near-match queried canonical catalog");
    check(databaseEvidence.operations===0&&databaseEvidence.executions===0&&databaseEvidence.outboxes===0&&databaseEvidence.audits===0,"Wave14 near-match claimed command artifacts");
  }
  return { executedConsumerId:args.consumerId,executedCaseId:args.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,
    assertionCount,reply,result,databaseEvidence };
}
