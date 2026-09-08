import { randomUUID } from "node:crypto";

import { CanonicalItemBagImportReadinessProvider } from "../../src/inventory/canonical-item-bag-import-readiness-provider.js";
import { LegacyBagOwnerLabelProvider } from "../../src/inventory/legacy-bag-owner-label-provider.js";

const MODULE_EXECUTION_ID=randomUUID();
const assert=(value,message)=>{if(!value)throw new Error(message);};
const normalize=sql=>String(sql).replace(/\s+/g," ").trim();
const actor={canonicalPlayerId:"player01",legacyPlayerId:"42",externalIdentityId:"7",displayName:"회원",rankEmoji:"🎖",platformCode:"kakao",externalContextId:"room",selectionSource:"ACTIVE_CONTEXT"};
const kinds=["CASTLE_LORD","STAR","CARROT","THERMO","MINI_PET","TOP_LEVEL","MC","INTIMACY"];
const markers=direct=>kinds.map((marker_kind,index)=>({marker_kind,marker_priority:index+1,assignment_status:index===0||index===direct?"ASSIGNED":"UNASSIGNED",player_id:index===0?"lord0001":index===direct?"player01":null,legacy_player_id:index===0?"99":index===direct?"42":null,source_fingerprint:"a".repeat(64),revision:"1"}));
const unassignedMarkers=()=>kinds.map((marker_kind,index)=>({marker_kind,marker_priority:index+1,assignment_status:"UNASSIGNED",player_id:null,legacy_player_id:null,source_fingerprint:"a".repeat(64),revision:"1"}));
const memberships={direct:[{player_id:"42",guild_id:"1",ordinal_value:1,snapshot_id:"5",current_snapshot_id:"5"},{player_id:"99",guild_id:"2",ordinal_value:2,snapshot_id:"5",current_snapshot_id:"5"}],castle:[{player_id:"42",guild_id:"1",ordinal_value:20,snapshot_id:"5",current_snapshot_id:"5"},{player_id:"99",guild_id:"1",ordinal_value:2,snapshot_id:"5",current_snapshot_id:"5"}],none:[]};
const complete={owned_item_stack_id:"stack01",stack_run_id:"run-stack",definition_run_id:"run-definition",stack_run_status:"COMPLETE",definition_run_status:"COMPLETE",stack_import_sha256:"b".repeat(64),definition_import_sha256:"c".repeat(64),stack_expected_source_count:1,stack_projected_source_count:1,stack_quarantined_source_count:0,stack_ignored_source_count:0,stack_expected_row_count:1,stack_imported_row_count:1,definition_expected_source_count:1,definition_projected_source_count:1,definition_quarantined_source_count:0,definition_ignored_source_count:0,definition_expected_row_count:1,definition_imported_row_count:1};

function participant(responses,calls){let index=0;return{async query(sql,values=[]){const normalizedSql=normalize(sql);assert(/^SELECT\b/.test(normalizedSql),"Wave17 non-SELECT query");assert(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|CALL|SET)\b|FOR\s+UPDATE/i.test(normalizedSql),"Wave17 mutating query");calls.push({channel:"query",normalizedSql,values,rowCount:Array.isArray(responses[index])?responses[index].length:0});return responses[index++]??[];}};}
async function owner(markerRows,membershipRows,context=actor,calls=[]){return new LegacyBagOwnerLabelProvider().resolve(participant([markerRows,membershipRows],calls),context);}
async function readiness(rows,calls=[]){return new CanonicalItemBagImportReadinessProvider().inspect(participant([rows],calls),actor);}
function output(binding,result,calls,assertionCount){assert(JSON.stringify(result)===JSON.stringify(binding.expectedResult),`Wave17 independent expected drift: ${binding.scenarioKind}: ${JSON.stringify(result)}`);return{executedConsumerId:binding.consumerId,executedCaseId:binding.harnessCaseId,moduleExecutionId:MODULE_EXECUTION_ID,assertionCount,reply:"NO_REPLY",result:JSON.stringify(result),databaseEvidence:{calls,sourceDomainDmlCount:0}};}

export async function executeWave17LegacyBagOwnerLabelResolve({binding}){
  const calls=[];let result,assertions=1;
  if(binding.scenarioKind==="READ_POSITIVE"||binding.scenarioKind==="EXACT_OUTPUT"||binding.scenarioKind==="RESTART_CONSISTENCY"){
    result={direct:await owner(markers(2),memberships.direct,actor,calls),castle:await owner(markers(-1),memberships.castle,actor,calls),base:await owner(unassignedMarkers(),memberships.none,actor,calls)};assertions=7;
  }else if(binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO"){
    result={value:await owner(markers(2),memberships.direct,actor,calls),transaction:"READ_ONLY",sourceDomainDmlCount:0};assertions=4;
  }else{
    const ranklessCalls=[];
    const cases={rankEmojiNull:await owner(markers(2),memberships.direct,{...actor,rankEmoji:null},ranklessCalls),markerCount:await owner(markers(2).slice(0,7),memberships.direct,actor,calls),markerOrder:await owner([...markers(2)].reverse(),memberships.direct,actor,calls),badHash:await owner(markers(2).map((row,index)=>index===3?{...row,source_fingerprint:"x"}:row),memberships.direct,actor,calls),revisionZero:await owner(markers(2).map((row,index)=>index===4?{...row,revision:"0"}:row),memberships.direct,actor,calls),duplicateOwn:await owner(markers(2),[memberships.direct[0],memberships.direct[0],memberships.direct[1]],actor,calls),missingLord:await owner(markers(2),[memberships.direct[0]],actor,calls),ordinalZero:await owner(markers(2),[{...memberships.direct[0],ordinal_value:0},memberships.direct[1]],actor,calls),ordinalTwentyOne:await owner(markers(2),[{...memberships.direct[0],ordinal_value:21},memberships.direct[1]],actor,calls),staleSnapshot:await owner(markers(2),[{...memberships.direct[0],snapshot_id:"4"},memberships.direct[1]],actor,calls)};
    assert(ranklessCalls.length===0,"rankEmoji null queried database");result=cases;assertions=12;
  }
  return output(binding,result,calls,assertions);
}

export async function executeWave17CanonicalItemBagImportReadinessInspect({binding}){
  const calls=[];let result,assertions=1;
  if(binding.scenarioKind==="READ_POSITIVE"||binding.scenarioKind==="RESTART_CONSISTENCY"){
    result={ready:await readiness([complete,{...complete,owned_item_stack_id:"stack02"}],calls)};assertions=3;
  }else if(binding.scenarioKind==="EXACT_OUTPUT"){
    result={ready:await readiness([complete],calls),empty:await readiness([],calls)};assertions=4;
  }else if(binding.scenarioKind==="SOURCE_DOMAIN_DML_ZERO"){
    result={ready:await readiness([complete],calls),transaction:"READ_ONLY",sourceDomainDmlCount:0};assertions=4;
  }else{
    const variants={empty:[],duplicate:[complete,complete],missingRun:[{...complete,stack_run_id:null}],incomplete:[{...complete,definition_run_status:"RUNNING"}],badHash:[{...complete,stack_import_sha256:"x"}],zeroSource:[{...complete,stack_expected_source_count:0,stack_projected_source_count:0}],unsafeCount:[{...complete,definition_expected_source_count:Number.MAX_SAFE_INTEGER+1}],countMismatch:[{...complete,stack_expected_source_count:2}],quarantined:[{...complete,stack_expected_source_count:2,stack_quarantined_source_count:1}],ignored:[{...complete,definition_expected_source_count:2,definition_ignored_source_count:1}],zeroRows:[{...complete,stack_expected_row_count:0,stack_imported_row_count:0}],rowMismatch:[{...complete,definition_expected_row_count:2}]};
    result={};for(const [name,rows] of Object.entries(variants))result[name]=await readiness(rows,calls);assertions=14;
  }
  return output(binding,result,calls,assertions);
}
