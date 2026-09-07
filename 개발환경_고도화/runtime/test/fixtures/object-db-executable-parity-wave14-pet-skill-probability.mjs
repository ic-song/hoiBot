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
  const riskCohort = async () => {
    let riskAssertions=0,riskSequence=0;
    const riskCheck=(value,message)=>{riskAssertions+=1;assert(value,message);};
    const inject=async(database,overrides={},concurrent=1)=>{
      const replies=[],environment=overrides.environment??"dev",operational=overrides.operational??true;
      const riskConfig=loadConfig({NODE_ENV:"test",HOIBOT_ENVIRONMENT_CODE:environment,IRIS_SHARED_TOKEN:"wave14-risk-token",USER_VERIFICATION_PEPPER:"wave14-risk-pepper",DATABASE_ENABLED:"true",DATABASE_HOST:"127.0.0.1",DATABASE_PORT:"3331",DATABASE_USER:"unused",DATABASE_PASSWORD:"unused",DATABASE_NAME:"wave14_formal"});
      const riskApp=buildApp(riskConfig,{database,environmentContext:{environmentCode:environment,databaseIdentity:"wave14_formal",verified:true},inspectIrisChannel:async()=>operational?{mode:"operational",channelClass:"open_group",reason:"allowed",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}}:{mode:"denied",channelClass:"open_group",reason:"not_designated",evidence:{roomType:"OM",openLinkActive:true,openLinkExpired:false}},sendIrisTextReply:async reply=>replies.push(reply)});
      const event={msg:overrides.message??"/펫스킬확률",room:overrides.room??"위험검증방",sender:overrides.displayName??"호이",json:{_id:overrides.providerEventId??`wave14-risk-${++riskSequence}`,chat_id:overrides.channelId??"risk-channel",user_id:overrides.externalUserId??"user-ok"}};
      try{const responses=await Promise.all(Array.from({length:concurrent},()=>riskApp.inject({method:"POST",url:"/api/v1/integrations/iris/events?token=wave14-risk-token",payload:event})));return{responses,replies,evidence:database.evidence()};}finally{await riskApp.close();}
    };
    for(const sample of [
      {name:"auth",overrides:{externalUserId:"unknown"},expectExecution:1},
      {name:"room",overrides:{operational:false},expectExecution:0},
      {name:"nickname",overrides:{displayName:"다섯글자님"},expectExecution:1}
    ]){const result=await inject(await args.createDatabase(),sample.overrides);riskCheck(result.responses[0].statusCode===202,`Wave14 ${sample.name} guard status drift`);riskCheck(result.replies.length===0,`Wave14 ${sample.name} guard reply drift`);riskCheck(result.evidence.executions===sample.expectExecution&&result.evidence.canonicalQueries===0,`Wave14 ${sample.name} guard state drift`);}
    {
      const database=await args.createDatabase(),eventId="wave14-risk-replay",first=await inject(database,{providerEventId:eventId}),second=await inject(database,{providerEventId:eventId});
      riskCheck(first.responses[0].statusCode===202&&second.responses[0].statusCode===202,"Wave14 exact replay status drift");riskCheck(database.evidence().executions===1&&database.evidence().outboxes===1,"Wave14 exact replay duplicated durable state");riskCheck(second.replies.length===0,"Wave14 exact replay emitted inline duplicate reply");
    }
    {
      const database=await args.createDatabase(),result=await inject(database,{providerEventId:"wave14-risk-concurrency"},2);
      riskCheck(result.responses.every(response=>response.statusCode===202),"Wave14 concurrency status drift");riskCheck(database.evidence().executions===1&&database.evidence().outboxes===1,"Wave14 concurrency duplicated durable state");
    }
    for(const axis of [
      ["environment",{environment:"prod"}],
      ["message",{message:"/펫스킬확률 ".trimEnd()+" "}],
      ["actor",{externalUserId:"user-stop"}],
      ["channel",{channelId:"risk-channel-other"}],
      ["destination",{room:"위험검증방2"}]
    ]){
      const database=await args.createDatabase(),eventId=`wave14-risk-drift-${axis[0]}`;await inject(database,{providerEventId:eventId});const drifted=await inject(database,{providerEventId:eventId,...axis[1]});riskCheck(drifted.responses[0].statusCode===409,`Wave14 ${axis[0]} forward drift did not fail closed`);
      const reverseDb=await args.createDatabase();await inject(reverseDb,{providerEventId:`${eventId}-reverse`,...axis[1]});const reversed=await inject(reverseDb,{providerEventId:`${eventId}-reverse`});riskCheck(reversed.responses[0].statusCode===409,`Wave14 ${axis[0]} reverse drift did not fail closed`);
    }
    for(const failure of [
      {name:"provider",fragment:"FROM canonical_pet_skill_definitions"},
      {name:"outbox",fragment:"INSERT INTO outbox_messages"}
    ]){
      const database=await args.createDatabase({faults:[{fragment:failure.fragment,times:1}]}),eventId=`wave14-risk-rollback-${failure.name}`,failed=await inject(database,{providerEventId:eventId});riskCheck(failed.responses[0].statusCode===500&&database.evidence().executions===0&&database.evidence().outboxes===0,`Wave14 ${failure.name} failure did not rollback`);const recovered=await inject(database,{providerEventId:eventId});riskCheck(recovered.responses[0].statusCode===202&&database.evidence().executions===1&&database.evidence().outboxes===1,`Wave14 ${failure.name} retry did not recover`);
    }
    for(const transient of [
      {name:"deadlock",code:"ER_LOCK_DEADLOCK",errno:1213},
      {name:"timeout",code:"ER_LOCK_WAIT_TIMEOUT",errno:1205}
    ]){const database=await args.createDatabase({faults:[{fragment:"FROM canonical_pet_skill_definitions",times:1,...transient}]}),result=await inject(database,{providerEventId:`wave14-risk-${transient.name}`}),attempts=database.evidence().transactionAttempts;riskCheck(result.responses[0].statusCode===202&&attempts.filter(attempt=>attempt.outcome==="ROLLBACK").length===1,`Wave14 ${transient.name} bounded retry drift`);}
    for(const invalid of [{name:"code-only",code:"ER_LOCK_DEADLOCK"},{name:"errno-only",errno:1213}]){const database=await args.createDatabase({faults:[{fragment:"FROM canonical_pet_skill_definitions",times:1,...invalid}]}),result=await inject(database,{providerEventId:`wave14-risk-${invalid.name}`}),attempts=database.evidence().transactionAttempts;riskCheck(result.responses[0].statusCode===500&&attempts.filter(attempt=>attempt.outcome==="ROLLBACK").length===1,`Wave14 ${invalid.name} was retried`);}
    {const database=await args.createDatabase({faults:[{fragment:"FROM canonical_pet_skill_definitions",times:3,code:"ER_LOCK_DEADLOCK",errno:1213}]}),result=await inject(database,{providerEventId:"wave14-risk-exhaustion"}),attempts=database.evidence().transactionAttempts;riskCheck(result.responses[0].statusCode===500&&attempts.filter(attempt=>attempt.outcome==="ROLLBACK").length===3&&database.evidence().executions===0,"Wave14 retry exhaustion drift");}
    return riskAssertions;
  };
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
  if(args.scenarioKind==="SOURCE_DOMAIN_DML_ZERO") assertionCount+=await riskCohort();
  return { executedConsumerId:args.consumerId,executedCaseId:args.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,
    assertionCount,reply,result,databaseEvidence };
}
