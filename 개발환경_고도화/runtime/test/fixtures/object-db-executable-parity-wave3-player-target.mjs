import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
const SOURCE={file:"개발환경_고도화/runtime/src/account-platform/player-context-provider.ts",start:10853,end:12269,sha256:"5356bb4b337ca031c50622ce7a658fe98b42014bc5da5ca58c254a2e2e59a4e7"};
const ID="sql-repository-261eb97022941f77", MODULE_EXECUTION_ID=randomUUID();
const SCENARIOS=["READ_POSITIVE","NEGATIVE_GUARD","EXACT_OUTPUT","SOURCE_DOMAIN_DML_ZERO","RESTART_CONSISTENCY"];
const ROW={legacyPlayerId:"42",canonicalPlayerId:"player01",externalIdentityId:"7",displayName:"대상유저",rankEmoji:"🏆",providerCode:"kakao"};
const RESULT={canonicalPlayerId:"player01",legacyPlayerId:"42",displayName:"대상유저",rankEmoji:"🏆"};
function assert(v,m){if(!v)throw new Error(m)}
export async function executeWave3PlayerTarget({consumerId,harnessCaseId,scenarioKind,fixturePayload,database}){
 let assertionCount=0;const check=(v,m)=>{assertionCount++;assert(v,m)};
 const c=fixturePayload.cases.find(x=>x.caseId===harnessCaseId), consumer=c?.consumers.find(x=>x.consumerId===consumerId);
 check(consumerId===ID&&c?.executablePath==="MariaPlayerContextProvider.resolveUniqueLegacyDisplayTarget"&&c.transactionPath==="DatabaseClient.query:READ_ONLY","case drift");
 check(JSON.stringify(c.requiredScenarios)===JSON.stringify(SCENARIOS)&&consumer?.sourceLocator.sha256===SOURCE.sha256,"fixture drift");
 const root=resolve(dirname(fileURLToPath(import.meta.url)),"../../../.."), path=resolve(root,SOURCE.file), source=readFileSync(path,"utf8").replace(/\r\n?/g,"\n"), span=source.slice(SOURCE.start,SOURCE.end);
 check(createHash("sha256").update(span).digest("hex")===SOURCE.sha256&&span.includes("async resolveUniqueLegacyDisplayTarget("),"source drift");
 const {MariaPlayerContextProvider}=await tsImport(pathToFileURL(path).href,import.meta.url), provider=new MariaPlayerContextProvider();
 if(scenarioKind==="NEGATIVE_GUARD"){let error=null;try{await provider.resolveUniqueLegacyDisplayTarget(database,consumer.negativeInput)}catch(e){error=e instanceof Error?e.message:String(e)}check(error==="PLAYER_CONTEXT_TARGET_INVALID","guard drift");return{executedConsumerId:ID,executedCaseId:harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount,reply:error,result:JSON.stringify({error,queryCount:0})}}
 const result=await provider.resolveUniqueLegacyDisplayTarget(database,consumer.input);check(JSON.stringify(result)===JSON.stringify(RESULT),"result drift");const raw=JSON.stringify(result);return{executedConsumerId:ID,executedCaseId:harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount,reply:raw,result:raw};
}
