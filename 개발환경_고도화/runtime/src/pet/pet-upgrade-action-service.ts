import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { MariaCommandDispatchRepository, type RolloutState } from "../dispatch/command-dispatcher.js";

const COMMAND_CODE = "PET_UPGRADE_ACTION";
const HANDLER_KEY = "pet_upgrade_action";
const STONE_CODES = ["pet_enhance_stone", "ITEM-RWD-026"] as const;
const ALL_SEE = "\u200b".repeat(500);
const MAX_ATTEMPTS = 100;

interface PolicyRow { policy_code:string; min_level:bigint; max_level:bigint|null; point_cost:string; base_rate:string; decrement_rate:string; }
interface StackRow { item_id:bigint; code:string; display_name:string; quantity:bigint; version:bigint; }
interface BoostStack extends StackRow { addRate:number; }
interface AttemptEvidence { sequence:number; levelBefore:bigint; levelAfter:bigint; pointCost:bigint; stoneRequired:bigint; boostItemId:bigint|null;
  baseRate:number; skillBonusRate:number; boostRate:number; effectiveRate:number; successRoll:number; success:boolean; artisanRoll:number|null; stonePreserved:boolean; }

export interface PetUpgradeActionResult {
  status:"applied"|"missing_pet"|"invalid_count"|"insufficient_point"|"insufficient_stone";
  data:string; outboxId:string; auditId:string; attempted:number; succeeded:number; failed:number; stonePreserved:number;
  pointSpent:string; stoneSpent:string; boostSpent:number; level:string|null;
}

export interface PetUpgradeAttemptInput { level:bigint; baseRate:number; smith:boolean; artisan:boolean; boostRate:number; random:()=>number; }
export interface PetUpgradeAttemptResult { level:bigint; success:boolean; stonePreserved:boolean; baseRate:number; skillBonusRate:number;
  boostRate:number; effectiveRate:number; successRoll:number; artisanRoll:number|null; }

// 정확한 무인자 또는 하나의 10진 정수 인자만 펫 강화 후보로 허용합니다.
export function isPetUpgradeActionCommand(message:string|undefined):boolean {
  return message==="/펫강화" || (message!==undefined && /^\/펫강화\s+\d+$/.test(message));
}

// 레거시 기본 1회·0 사용법·100회 상한을 정규화합니다.
export function parsePetUpgradeCount(message:string):{count:number;capped:boolean} {
  if(message==="/펫강화") return {count:1,capped:false};
  const match=/^\/펫강화\s+(\d+)$/.exec(message);
  if(match===null) return {count:0,capped:false};
  const parsed=Number(match[1]);
  if(!Number.isSafeInteger(parsed) || parsed>MAX_ATTEMPTS) return {count:MAX_ATTEMPTS,capped:true};
  return {count:parsed,capped:false};
}

// 성공 RNG 뒤 실패한 장인 스킬 RNG만 소비하는 레거시 순서를 보존합니다.
export function resolvePetUpgradeAttempt(input:PetUpgradeAttemptInput):PetUpgradeAttemptResult {
  const skillBonusRate=input.smith?0.05:0;
  const boostRate=input.baseRate+skillBonusRate<1?input.boostRate:0;
  const effectiveRate=Math.min(1,input.baseRate+skillBonusRate+boostRate);
  const successRoll=input.random();
  const success=successRoll<effectiveRate;
  let artisanRoll:number|null=null;
  let stonePreserved=false;
  if(!success && input.artisan){artisanRoll=input.random();stonePreserved=artisanRoll<0.07;}
  return {level:success?input.level+1n:input.level,success,stonePreserved,baseRate:input.baseRate,skillBonusRate,boostRate,effectiveRate,successRoll,artisanRoll};
}

// 현재 강화 구간의 DB 정책과 감소율로 회당 비용·기본 확률을 계산합니다.
export function resolvePetUpgradePolicy(level:bigint,policies:readonly PolicyRow[]):{pointCost:bigint;baseRate:number} {
  const policy=policies.find(row=>level>=BigInt(row.min_level)&&(row.max_level===null||level<=BigInt(row.max_level)));
  if(policy===undefined) throw new Error(`Missing pet upgrade policy for level ${level}.`);
  const offset=level-BigInt(policy.min_level);
  const baseRate=Math.max(0,Number(policy.base_rate)-Number(offset)*Number(policy.decrement_rate));
  return {pointCost:BigInt(policy.point_cost.split(".")[0]??"0"),baseRate};
}

function eventKey(value:string):string{return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`;}
function comma(value:bigint):string{return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function stored(value:string|PetUpgradeActionResult):PetUpgradeActionResult{return typeof value==="string"?JSON.parse(value) as PetUpgradeActionResult:value;}
function fixed(value:number):string{return value.toFixed(17);}
function bestBoost(rows:readonly StackRow[],spent:Map<bigint,bigint>):BoostStack|undefined {
  let best:BoostStack|undefined;
  for(const row of rows){const left=BigInt(row.quantity)-(spent.get(BigInt(row.item_id))??0n);const match=/^펫강화확률UP🌟\((\d+(?:\.\d+)?)%\)$/.exec(row.display_name);
    if(left<=0n||match===null)continue;const addRate=Number(match[1])/100;if(best===undefined||addRate>best.addRate)best={...row,quantity:left,addRate};}
  return best;
}
function critChance(level:bigint):string {const capped=Number(level>300n?300n:level);const value=capped<=100?capped*0.5:capped<=200?50+(capped-100)*0.3:80+(capped-200)*0.1;return value.toFixed(2);}
function critMultiplier(level:bigint):string {if(level<=300n)return "1.7";const hundredths=170n+(level-300n);const whole=hundredths/100n,frac=hundredths%100n;return frac===0n?whole.toString():frac%10n===0n?`${whole}.${frac/10n}`:`${whole}.${frac.toString().padStart(2,"0")}`;}

// optimistic version 확인과 원장을 포함해 stack 일부 또는 전체를 소비합니다.
async function consume(transaction:DatabaseTransaction,operationId:bigint,sequence:number,playerId:string,row:StackRow,quantity:bigint,reason:string):Promise<void>{
  if(quantity<=0n)return;const result=quantity===BigInt(row.quantity)
    ?await transaction.execute("DELETE FROM inventory_stacks WHERE player_id=? AND item_id=? AND version=?",[playerId,row.item_id,row.version])
    :await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-?,version=version+1 WHERE player_id=? AND item_id=? AND version=?",[quantity,playerId,row.item_id,row.version]);
  if(result.affectedRows!==1n)throw new Error("Pet upgrade inventory version conflict.");
  await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,?)",[operationId,sequence,playerId,row.item_id,-quantity,reason]);
}

// 펫 강화·재화·아이템·RNG 증적·응답을 하나의 transaction으로 원자 처리합니다.
export class PetUpgradeActionService {
  constructor(private readonly database:DatabaseClient,private readonly random:()=>number=Math.random){}

  async handleIris(input:{externalUserId:string;channelId:string;message:string;eventId:string}):Promise<{status:"changed";data:string;outboxId:string}|{status:"shadow"|"legacy_fallback"}>{
    const rollout=await this.database.query<Array<{rollout_state:RolloutState;enabled:number}>>("SELECT rollout_state,enabled FROM command_registry WHERE command_code=? LIMIT 1",[COMMAND_CODE]);
    const definition=rollout[0],dispatch=new MariaCommandDispatchRepository(this.database);
    if(definition===undefined||definition.enabled!==1||definition.rollout_state==="LEGACY_ONLY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"ROLLOUT_LEGACY_ONLY",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY});return {status:"legacy_fallback"};}
    if(definition.rollout_state==="SHADOW"||definition.rollout_state==="CANARY"){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"SHADOW",reasonCode:"ROLLOUT_SHADOW",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY});return {status:"shadow"};}
    const identities=await this.database.query<Array<{id:bigint;player_id:bigint|null}>>("SELECT id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' LIMIT 1",[input.externalUserId]);
    const identity=identities[0];if(identity===undefined||identity.player_id===null){await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"LEGACY_FALLBACK",reasonCode:"IDENTITY_NOT_VERIFIED",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY});return {status:"legacy_fallback"};}
    await dispatch.record({eventId:input.eventId,message:input.message,userId:input.externalUserId,hasTrustedDisplayName:true},{route:"MODERN",reasonCode:"MODERN_ROUTE_ALLOWED",commandCode:COMMAND_CODE,handlerKey:HANDLER_KEY});
    const parsed=parsePetUpgradeCount(input.message);const result=await this.enhance({playerId:identity.player_id.toString(),identityId:identity.id.toString(),destinationId:input.channelId,sourceEventId:input.eventId,idempotencyKey:input.eventId,count:parsed.count,capped:parsed.capped});
    return {status:"changed",data:result.data,outboxId:result.outboxId};
  }

  async enhance(input:{playerId:string;identityId:string;destinationId:string;sourceEventId:string;idempotencyKey:string;count:number;capped?:boolean}):Promise<PetUpgradeActionResult>{
    return this.database.withTransaction(async transaction=>{
      const scope=`pet.upgrade:${input.playerId}`,key=eventKey(input.idempotencyKey);
      const claim=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[randomUUID(),scope,key,input.identityId]);
      const operationId=claim.insertId;
      const existing=await transaction.query<Array<{status:string;result_json:string|PetUpgradeActionResult|null}>>("SELECT status,result_json FROM operations WHERE id=? FOR UPDATE",[operationId]);
      if(existing[0]?.result_json!=null)return stored(existing[0].result_json);
      if(claim.affectedRows!==1n)throw new Error("Pet upgrade operation is already processing.");

      const pets=await transaction.query<Array<{id:bigint;display_name:string|null;image_value:string|null;enhancement_level:bigint;version:bigint}>>("SELECT id,display_name,image_value,enhancement_level,version FROM player_pets WHERE player_id=? FOR UPDATE",[input.playerId]);
      const pet=pets[0];
      const profile=(await transaction.query<Array<{current_display_name:string;rank_emoji:string|null}>>("SELECT profile.current_display_name,rank_profile.rank_emoji FROM player_profiles profile LEFT JOIN player_legacy_rank_profiles rank_profile ON rank_profile.player_id=profile.player_id WHERE profile.player_id=? FOR UPDATE",[input.playerId]))[0];
      const policies=await transaction.query<PolicyRow[]>("SELECT policy_code,min_level,max_level,CAST(point_cost AS CHAR) point_cost,CAST(base_rate AS CHAR) base_rate,CAST(decrement_rate AS CHAR) decrement_rate FROM pet_upgrade_level_policies WHERE active=TRUE ORDER BY min_level FOR UPDATE");
      let status:PetUpgradeActionResult["status"]="missing_pet",data="펫이 없습니다.";
      let attempted=0,succeeded=0,failed=0,stonePreserved=0,pointSpent=0n,stoneSpent=0n;
      const boostSpent=new Map<bigint,bigint>(),attempts:AttemptEvidence[]=[],logs:string[]=[];
      let finalLevel:bigint|null=pet===undefined?null:BigInt(pet.enhancement_level),stop="";
      if(input.count<1){status="invalid_count";data="사용법: /펫강화 [횟수]";}
      else if(pet!==undefined){
        await transaction.execute("INSERT IGNORE INTO currency_accounts(player_id,currency_code,balance,version) VALUES (?,'point',0,0)",[input.playerId]);
        const account=(await transaction.query<Array<{balance:string;version:bigint}>>("SELECT CAST(balance AS CHAR) balance,version FROM currency_accounts WHERE player_id=? AND currency_code='point' FOR UPDATE",[input.playerId]))[0]!;
        let pointBalance=BigInt(account.balance.split(".")[0]??"0");
        const stones=await transaction.query<StackRow[]>(`SELECT item.id item_id,item.code,item.display_name,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.code IN (?,?) AND item.active=TRUE ORDER BY CASE WHEN item.code=? THEN 0 ELSE 1 END,item.id FOR UPDATE`,[input.playerId,...STONE_CODES,STONE_CODES[0]]);
        let stoneBalance=stones.reduce((sum,row)=>sum+BigInt(row.quantity),0n);
        const boosts=await transaction.query<StackRow[]>("SELECT item.id item_id,item.code,item.display_name,stack.quantity,stack.version FROM inventory_stacks stack JOIN item_definitions item ON item.id=stack.item_id WHERE stack.player_id=? AND item.display_name LIKE '펫강화확률UP🌟(%' AND item.active=TRUE FOR UPDATE",[input.playerId]);
        const skills=await transaction.query<Array<{code:string}>>("SELECT definition.code FROM pet_skills owned JOIN skill_definitions definition ON definition.id=owned.skill_id WHERE owned.player_pet_id=? AND owned.equipped=TRUE AND definition.code IN ('SKILL-PET-BALD-BLACKSMITH','SKILL-ARTISANS-BREATH')",[pet.id]);
        const smith=skills.some(row=>row.code==="SKILL-PET-BALD-BLACKSMITH"),artisan=skills.some(row=>row.code==="SKILL-ARTISANS-BREATH");
        const cube=(await transaction.query<Array<{pet_upgrade_percent:string}>>("SELECT CAST(pet_upgrade_percent AS CHAR) pet_upgrade_percent FROM player_home_badge_cubes WHERE player_id=? AND equipped=TRUE LIMIT 1 FOR UPDATE",[input.playerId]))[0];
        const beforeLevel=finalLevel;
        for(let index=0;index<input.count;index++){
          const policy=resolvePetUpgradePolicy(finalLevel!,policies),required=finalLevel!+1n;
          if(pointBalance<policy.pointCost){status="insufficient_point";stop=`포인트가 부족합니다.\n현재 포인트: ${comma(pointBalance)}\n필요한 포인트: ${comma(policy.pointCost)}`;break;}
          if(stoneBalance<required){status="insufficient_stone";stop=`펫 강화석⭐이 부족합니다.\n필요한 펫 강화석⭐: ${required}개`;break;}
          const selected=policy.baseRate+(smith?0.05:0)<1?bestBoost(boosts,boostSpent):undefined;
          const outcome=resolvePetUpgradeAttempt({level:finalLevel!,baseRate:policy.baseRate,smith,artisan,boostRate:selected?.addRate??0,random:this.random});
          const levelBefore=finalLevel!;finalLevel=outcome.level;attempted++;pointSpent+=policy.pointCost;pointBalance-=policy.pointCost;
          if(!outcome.stonePreserved){stoneSpent+=required;stoneBalance-=required;}else stonePreserved++;
          if(selected!==undefined)boostSpent.set(selected.item_id,(boostSpent.get(selected.item_id)??0n)+1n);
          if(outcome.success)succeeded++;else failed++;
          attempts.push({sequence:attempted,levelBefore,levelAfter:finalLevel!,pointCost:policy.pointCost,stoneRequired:required,boostItemId:selected?.item_id??null,...outcome});
          const effectiveLevel=BigInt(Math.round(Number(finalLevel)*(1+Number(cube?.pet_upgrade_percent??"0")/100)));
          let message=outcome.success?`[${finalLevel}강⭐ 펫 강화성공]\n`:`[${finalLevel}강⭐ 펫 강화실패]\n${outcome.stonePreserved?"장인의 숨결📙 [펫 강화석⭐]을 소모하지 않았습니다.":"하,, 펫 강화석⭐이 소멸하였습니다..."}\n`;
          message+=`[${profile?.rank_emoji??""}${profile?.current_display_name??""}] 님의 [${pet.image_value??""}${pet.display_name??"펫"}]${outcome.success?"이(가)\n강화에 성공하였습니다.":" 이(가)\n강화에 실패하였습니다."}`;
          if(outcome.success)message+=`\n[강화 ${finalLevel}⭐] [치명타 확률 ${critChance(effectiveLevel)}%] [${critMultiplier(effectiveLevel)}배]`;
          message+=`\n현재 포인트: 🅟${comma(pointBalance)}\n\n${outcome.success?"다음":"현재"} 펫강화확률⭐️: ${(resolvePetUpgradePolicy(finalLevel,policies).baseRate+(smith?0.05:0)+(bestBoost(boosts,boostSpent)?.addRate??0))*100>100?"100.00":((resolvePetUpgradePolicy(finalLevel,policies).baseRate+(smith?0.05:0)+(bestBoost(boosts,boostSpent)?.addRate??0))*100).toFixed(2)}%(⬆️)\n남은 펫 강화석⭐️: ${comma(stoneBalance)}`;
          if(selected!==undefined)message+=`\n\n${selected.display_name} 사용 (보유: ${BigInt(selected.quantity)-(boostSpent.get(selected.item_id)??0n)}개)`;
          if(smith)message+="\n대머리 대장장이📙 펫스킬을 적용 받았습니다(5%)";
          logs.push(input.count===1?message:`[${attempted}회]\n${message}`);
        }
        if(attempted>0){
          status="applied";
          const currency=await transaction.execute("UPDATE currency_accounts SET balance=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point' AND version=?",[`${pointBalance}.000`,input.playerId,account.version]);
          if(currency.affectedRows!==1n)throw new Error("Pet upgrade currency version conflict.");
          await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?, 'PET_UPGRADE')",[operationId,input.playerId,`-${pointSpent}.000`,`${pointBalance}.000`]);
          let remainStone=stoneSpent,inventorySequence=1;
          for(const row of stones){const amount=remainStone>BigInt(row.quantity)?BigInt(row.quantity):remainStone;await consume(transaction,operationId,inventorySequence++,input.playerId,row,amount,"PET_UPGRADE_STONE");remainStone-=amount;}
          if(remainStone!==0n)throw new Error("Pet upgrade stone distribution mismatch.");
          for(const row of boosts){const amount=boostSpent.get(BigInt(row.item_id))??0n;await consume(transaction,operationId,inventorySequence++,input.playerId,row,amount,"PET_UPGRADE_BOOST");}
          const petUpdate=await transaction.execute("UPDATE player_pets SET enhancement_level=?,enhancement_updated_at=CASE WHEN ?>0 THEN UTC_TIMESTAMP(3) ELSE enhancement_updated_at END,version=version+1 WHERE id=? AND version=?",[finalLevel,succeeded,pet.id,pet.version]);
          if(petUpdate.affectedRows!==1n)throw new Error("Pet upgrade pet version conflict.");
          for(const attempt of attempts)await transaction.execute(`INSERT INTO pet_upgrade_attempts(operation_id,sequence_no,player_pet_id,level_before,level_after,point_cost,stone_required,boost_item_id,base_rate,skill_bonus_rate,boost_rate,effective_rate,success_roll,success,artisan_roll,stone_preserved,pet_version_before,pet_version_after) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[operationId,attempt.sequence,pet.id,attempt.levelBefore,attempt.levelAfter,`${attempt.pointCost}.000`,attempt.stoneRequired,attempt.boostItemId,fixed(attempt.baseRate),fixed(attempt.skillBonusRate),fixed(attempt.boostRate),fixed(attempt.effectiveRate),fixed(attempt.successRoll),attempt.success,attempt.artisanRoll===null?null:fixed(attempt.artisanRoll),attempt.stonePreserved,pet.version,pet.version+1n]);
          if(input.count===1)data=logs[0]!;else{const cap=input.capped?"펫강화는 최대 100회까지만 가능합니다. 100회로 진행합니다.\n":"";data=`${cap}⭐️펫강화 연속시도⭐️\n\n강화 전: ${pet.image_value??""}${pet.display_name??"펫"} [+${beforeLevel}]\n강화 후: ${pet.image_value??""}${pet.display_name??"펫"} [+${finalLevel}]\n\n시도🔂: [${attempted}/${input.count}회]\n성공🅾️: [${succeeded}회]\n실패❌: [${failed}회]`;if(stonePreserved>0)data+=`\n장인의 숨결📙 발동: [${stonePreserved}회] (강화석 미소모)`;data+=`\n현재 포인트: 🅟${comma(pointBalance)}`;if(stop)data+="\n중간 종료: 포인트 또는 재료가 부족합니다.";data+=`\n(펫강화 기록 상세보기)${ALL_SEE}\n\n${logs.join("\n\n")}`;}
        } else data=stop;
      }
      const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operationId,input.destinationId,JSON.stringify({data})]);
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'PET_UPGRADE_ACTION',?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[input.sourceEventId,operationId,status]);
      const audit=await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'pet.upgrade',?,'Iris /펫강화',?,UTC_TIMESTAMP(3))",[operationId,input.identityId,input.playerId,status,JSON.stringify({attempted,succeeded,failed,stonePreserved,pointSpent:pointSpent.toString(),stoneSpent:stoneSpent.toString(),boostSpent:[...boostSpent.values()].reduce((sum,value)=>sum+Number(value),0),level:finalLevel?.toString()??null})]);
      const result:PetUpgradeActionResult={status,data,outboxId:outbox.insertId.toString(),auditId:audit.insertId.toString(),attempted,succeeded,failed,stonePreserved,pointSpent:pointSpent.toString(),stoneSpent:stoneSpent.toString(),boostSpent:[...boostSpent.values()].reduce((sum,value)=>sum+Number(value),0),level:finalLevel?.toString()??null};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operationId]);return result;
    });
  }
}
