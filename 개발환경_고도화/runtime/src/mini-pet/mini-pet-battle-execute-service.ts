import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";

export const MINI_PET_BATTLE_COMMAND = "/미니펫대전";
const ALL_SEE = "​".repeat(500);
const DIRECT_MAX = 15;
const AUTO_MAX = 20;
const BAG_MIN = 5;
const BAG_BASE_MAX = 10;
const BAG_PREMIUM_BONUS = 5;
const RESET_CODE = "ITEM-MINI-PET-DUEL-RESET-TICKET";
const HUNTER_REWARD_CODE = "mini_pet_draw";
const BOOSTER_COUNTER = "experience_booster_count";
const FREE_COUNTER = "mini_pet_battle_free_used";
const ROBBER_POINT = 10_000_000;

type Numeric = bigint | number | string;

export interface MiniPetBattleReward { itemId: string; itemCode: string; itemName: string; quantity: number; }
export interface MiniPetBattleCombatant {
  playerId:string; displayName:string; level:number; experience:number; pointBalance:bigint;
  wins:number; losses:number; battleCount:number; freeUsed:number; boosterCount:number;
  resetTicketItemId:string|null; resetTicketCount:number; premium:boolean;
  equippedId:string|null; miniName:string; miniEmoji:string; miniGrade:string; miniUpgrade:number; equippedCharm:number;
  bagCount:number; totalCharm:number; effectiveUpgradeLevel:number;
  hasHunter:boolean; hasMaxHunter:boolean; hasRobber:boolean; hasMindWin:boolean; hasBeastInstinct:boolean;
}
export interface MiniPetBattleResolution {
  attacker:MiniPetBattleCombatant; defender:MiniPetBattleCombatant; attackerWon:boolean;
  attackerFinal:number; defenderFinal:number; attackerCritical:boolean; defenderCritical:boolean;
  experienceDelta:number; pointDelta:number; robberDelta:number; resetTicketDelta:number;
  reward:MiniPetBattleReward; hunterReward:boolean; messages:string[];
}
export interface MiniPetBattleExecuteResult {
  status:"completed"|"handled_no_reply"; playerId?:string; defenderPlayerId?:string;
  attackerWon?:boolean; messages:string[]; outboxIds:string[]; replayed:boolean;
}
interface PlayerRow {
  player_id:Numeric; display_name:string; level_value:Numeric; experience_value:Numeric; point_balance:Numeric;
  win_count:Numeric; loss_count:Numeric; battle_count:Numeric; free_used:Numeric; booster_count:Numeric; premium_count:Numeric;
  reset_ticket_item_id:Numeric|null; reset_ticket_count:Numeric; equipped_id:Numeric|null; mini_name:string|null;
  mini_emoji:string|null; mini_grade:string|null; mini_upgrade:Numeric|null; equipped_charm:Numeric|null;
  main_pet_upgrade:Numeric|null; upgrade_percent:Numeric|null; hunter:Numeric; max_hunter:Numeric; robber:Numeric; mind_win:Numeric; beast:Numeric;
}

export function isMiniPetBattleCommand(message:string|undefined):boolean { return message===MINI_PET_BATTLE_COMMAND; }
export function normalizeMiniPetBattleDispatchMessage(message:string):string { return isMiniPetBattleCommand(message)?MINI_PET_BATTLE_COMMAND:message; }
function integer(value:Numeric|null):number { return value===null?0:Number(value); }
function eventKey(value:string):string { return value.length<=191?value:`sha256:${createHash("sha256").update(value).digest("hex")}`; }
function unit(seed:string,index:number):number { const hex=createHash("sha256").update(`${seed}:${index}`).digest("hex").slice(0,13); return Number.parseInt(hex,16)/0x1fffffffffffff; }
function critChance(level:number):number { const capped=Math.max(0,Math.min(300,Math.trunc(level))); if(capped<=100)return capped*.005;if(capped<=200)return(50+(capped-100)*.3)/100;return(80+(capped-200)*.1)/100; }
function critMultiplier(level:number):number { return level<=300?1.7:Number((1.7+(Math.trunc(level)-300)*.01).toFixed(2)); }
function critical(base:number,level:number,roll:number){const hit=roll<critChance(level);return{value:hit?Math.round(base*critMultiplier(level)):base,hit};}
function commas(value:Numeric):string{return String(value).replace(/\B(?=(\d{3})+(?!\d))/g,",");}
function evidence(value:unknown):string{return JSON.stringify(value,(_key,item)=>typeof item==="bigint"?item.toString():item);}

function renderBattle(attacker:MiniPetBattleCombatant,defender:MiniPetBattleCombatant,value:{won:boolean;attackerFinal:number;defenderFinal:number;attackerCrit:boolean;defenderCrit:boolean;exp:number;baseExp:number;boosterExp:number;reward:MiniPetBattleReward;point:number;max:number}):string{
  const compare=value.attackerFinal>value.defenderFinal?">":value.attackerFinal<value.defenderFinal?"<":"=";
  const gap=Math.abs(value.attackerFinal-value.defenderFinal), levelExp=6*attacker.level+84;
  return ["🐹 미니펫 대전",`(대전횟수: ${attacker.battleCount}/${value.max}) (리셋권: ${attacker.resetTicketCount}개)`,
    `결과: ${value.won?"✅ 승리":"❌ 패배"}`,"━━━━━━━━━━━━","",
    `⚔️ 공격\n유저: ${attacker.displayName}\n미니펫: ${attacker.miniName}(${attacker.miniEmoji}) · 강화: ${attacker.miniUpgrade}강💫`,
    `등급: ${attacker.miniGrade} · 장착: +${commas(attacker.equippedCharm)}💕\n미니펫매력: ${commas(attacker.totalCharm)}💕`,
    `최종: ${commas(value.attackerFinal)}💕${value.attackerCrit?" 💥크리티컬":""}`,"","              🆚","",
    `🛡️ 방어\n유저: ${defender.displayName}\n미니펫: ${defender.miniName}(${defender.miniEmoji}) · 강화: ${defender.miniUpgrade}강💫`,
    `등급: ${defender.miniGrade} · 장착: +${commas(defender.equippedCharm)}💕\n미니펫매력: ${commas(defender.totalCharm)}💕`,
    `최종: ${commas(value.defenderFinal)}💕${value.defenderCrit?" 💥크리티컬":""}`,"","━━━━━━━━━━━━",
    `📊 최종 매력 비교${ALL_SEE}\n${commas(value.attackerFinal)} ${compare} ${commas(value.defenderFinal)}`,
    `매력 차이: ${commas(gap)}💕`,"",value.won?"🏆 공격 승리":"🛡️ 방어 승리",
    `${value.won?attacker.displayName:defender.displayName} 님이 미니펫대전에서 승리했습니다!`,
    `경험치: ${value.exp}exp(${value.baseExp}/${value.boosterExp})(⤴️)`,
    `\n━ ✦ 획득포인트 및 경험치 상세정보✦ ━\n${ALL_SEE}\n획득 포인트🤑: 🅟${commas(value.point)}`,
    `획득 아이템💰: ${value.reward.itemName} x ${value.reward.quantity}`,
    `현재 레벨 ${attacker.level} (${commas(attacker.experience)}/${commas(levelExp)}[${(attacker.experience/levelExp*100).toFixed(2)}%])`,
    attacker.boosterCount===0?`[${attacker.displayName}] 님\n경험치 부스터가 없습니다.\n경험치패스⭐️를 후원해보세요!\nhttps://hoiland123.tistory.com/363 ${ALL_SEE}`:`남은 경험치 부스터 횟수:  ${commas(attacker.boosterCount)}`
  ].join("\n");
}

// 이벤트 seed 하나로 상대·치명타·보상·스킬 발동을 모두 결정합니다.
export function resolveMiniPetBattle(input:{attacker:MiniPetBattleCombatant;candidates:readonly MiniPetBattleCombatant[];rewards:readonly MiniPetBattleReward[];seed:string;maxRuns?:number}):MiniPetBattleResolution{
  const max=input.maxRuns??DIRECT_MAX, attacker={...input.attacker};
  if(attacker.equippedId===null)throw new ApplicationError("MINI_PET_BATTLE_EQUIPPED_REQUIRED",`❌ [${attacker.displayName}]님\n미니펫을 장착 중이어야 대전을 진행할 수 있습니다.`,409);
  if(attacker.bagCount<BAG_MIN)throw new ApplicationError("MINI_PET_BATTLE_BAG_MIN",`❌ [${attacker.displayName}]님\n가방에 미니펫이 최소 ${BAG_MIN}마리 이상 있어야 대전을 진행할 수 있습니다.`,409);
  const bagMax=BAG_BASE_MAX+(attacker.premium?BAG_PREMIUM_BONUS:0);
  if(attacker.bagCount>bagMax)throw new ApplicationError("MINI_PET_BATTLE_BAG_MAX",`❌ [${attacker.displayName}]님\n가방에 미니펫이 ${bagMax}마리를 초과하면 대전을 진행할 수 없습니다.`,409);
  if(attacker.battleCount>=max)throw new ApplicationError("MINI_PET_BATTLE_LIMIT",`❌ [${attacker.displayName}]님 오늘 대전 최대 가능 횟수(${max}회)를 초과했습니다.`,409);
  const candidates=input.candidates.filter(row=>row.playerId!==attacker.playerId&&row.equippedId!==null&&row.bagCount>=BAG_MIN);
  if(candidates.length===0)throw new ApplicationError("MINI_PET_BATTLE_OPPONENT_REQUIRED","❌ 현재 대전 가능한 상대가 없습니다.",409);
  if(input.rewards.length===0)throw new Error("MINI_PET_BATTLE_REWARD_REQUIRED");
  if(attacker.freeUsed>=1){if(attacker.resetTicketCount<=0)throw new ApplicationError("MINI_PET_BATTLE_RESET_REQUIRED",`❌ [${attacker.displayName}]님\n오늘 무료대전 1회를 모두 사용했습니다.\n미니펫대전리셋권🐹 소지시 최대 15회 가능합니다.\n\n미대리🐹 이 부족하신가요?\nhttps://hoiland123.tistory.com/512`,409);attacker.resetTicketCount-=1;}else attacker.freeUsed+=1;
  const defender={...candidates[Math.min(candidates.length-1,Math.floor(unit(input.seed,0)*candidates.length))]!};
  const af=critical(attacker.totalCharm,attacker.effectiveUpgradeLevel,unit(input.seed,1));
  const df=critical(defender.totalCharm,defender.effectiveUpgradeLevel,unit(input.seed,2));
  const won=af.value>df.value;
  if(won)attacker.wins+=1;else attacker.losses+=1;
  attacker.battleCount+=1;
  const baseExp=won?45:15,boosterExp=Math.min(attacker.boosterCount,baseExp);
  attacker.boosterCount-=boosterExp;attacker.experience+=baseExp+boosterExp;
  const beast=won&&unit(input.seed,3)<.3,point=beast?6_000_000:3_000_000;
  attacker.pointBalance+=BigInt(point);
  const reward=input.rewards[Math.min(input.rewards.length-1,Math.floor(unit(input.seed,4)*input.rewards.length))]!;
  const hunterReward=(attacker.hasHunter&&unit(input.seed,5)<.07)||(!attacker.hasHunter&&attacker.hasMaxHunter&&unit(input.seed,5)<.15);
  const robberDelta=attacker.hasRobber&&unit(input.seed,6)<.7?ROBBER_POINT:0;
  if(robberDelta>0){attacker.pointBalance+=BigInt(robberDelta);defender.pointBalance-=BigInt(robberDelta);}
  const messages=[renderBattle(attacker,defender,{won,attackerFinal:af.value,defenderFinal:df.value,attackerCrit:af.hit,defenderCrit:df.hit,exp:baseExp+boosterExp,baseExp,boosterExp,reward,point,max})];
  if(hunterReward)messages.push(`${attacker.hasHunter?"헌터":"만렙헌터"}📙\n[${attacker.displayName}]님이 사냥에 성공합니다!\n미니펫뽑기🐹(/미니펫오픈) 1개 획득!`);
  if(robberDelta>0)messages.push(`약탈자📙\n[${attacker.displayName}]님의 약탈 본능 발동!\n상대 [${defender.displayName}]에게서 🅟${commas(robberDelta)} 포인트를 약탈합니다.`);
  if(!won&&attacker.hasMindWin)messages.push(`[${attacker.displayName}] : 지는 게 이기는 거야..`);
  if(beast&&attacker.hasBeastInstinct)messages.push(`야수의 본능📙 으르렁.. 포인트보상 2배적용 🅟${commas(point)}만 획득!`);
  return{attacker,defender,attackerWon:won,attackerFinal:af.value,defenderFinal:df.value,attackerCritical:af.hit,defenderCritical:df.hit,experienceDelta:baseExp+boosterExp,pointDelta:point,robberDelta,resetTicketDelta:attacker.freeUsed>1?-1:(input.attacker.freeUsed>=1?-1:0),reward,hunterReward,messages};
}

function stored(value:string|MiniPetBattleExecuteResult):MiniPetBattleExecuteResult{return typeof value==="string"?JSON.parse(value) as MiniPetBattleExecuteResult:value;}

// 공용 미니펫·재고·재화 테이블을 잠그고 대전 결과를 원자 정산합니다.
export class MiniPetBattleExecuteService{
  constructor(private readonly database:DatabaseClient){}
  async handle(command:{externalUserId:string;channelId:string;message:string;eventId:string;mode?:"direct"|"auto"}):Promise<MiniPetBattleExecuteResult>{
    if(!isMiniPetBattleCommand(command.message))throw new ApplicationError("MINI_PET_BATTLE_COMMAND_INVALID","정확한 /미니펫대전을 입력해 주세요.",422);
    return this.database.withTransaction(async transaction=>{
      const siege=(await transaction.query<Array<{active:number}>>("SELECT active FROM guild_territory_wars WHERE active=TRUE LIMIT 1 FOR UPDATE"))[0];
      if(siege?.active===1)return{status:"handled_no_reply",messages:[],outboxIds:[],replayed:false};
      const identity=(await transaction.query<Array<{identity_id:Numeric;player_id:Numeric}>>("SELECT id identity_id,player_id FROM external_identities WHERE provider_code='kakao' AND external_user_id=? AND status='linked' AND player_id IS NOT NULL FOR UPDATE",[command.externalUserId]))[0];
      if(identity===undefined)throw new ApplicationError("MINI_PET_BATTLE_IDENTITY_REQUIRED","가입된 회원 정보를 찾을 수 없습니다.",409);
      const scope=`mini-pet.battle.execute:${identity.identity_id}`,key=eventKey(command.eventId);
      const prior=(await transaction.query<Array<{result_json:string|MiniPetBattleExecuteResult|null}>>("SELECT result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE",[scope,key]))[0];
      if(prior?.result_json!=null)return{...stored(prior.result_json),replayed:true};
      await transaction.execute("INSERT INTO mini_pet_battle_states(player_id,win_count,loss_count,version) SELECT id,0,0,1 FROM players WHERE status='active' ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)");
      await transaction.execute("INSERT INTO currency_accounts(player_id,currency_code,balance,version) SELECT id,'point',0,1 FROM players WHERE status='active' ON DUPLICATE KEY UPDATE player_id=VALUES(player_id)");
      const rows=await transaction.query<PlayerRow[]>(`SELECT player.id player_id,profile.current_display_name display_name,profile.level level_value,profile.experience experience_value,
        currency.balance point_balance,state.win_count,state.loss_count,COALESCE(daily.mini_battle_attempts,0) battle_count,
        COALESCE((SELECT value FROM player_counters c WHERE c.player_id=player.id AND c.counter_code=? AND c.period_key=DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d')),0) free_used,
        COALESCE((SELECT value FROM player_counters c WHERE c.player_id=player.id AND c.counter_code=? AND c.period_key='lifetime'),0) booster_count,
        (SELECT COUNT(*) FROM player_passes pass WHERE pass.player_id=player.id AND pass.pass_code='premium' AND pass.enabled=TRUE AND (pass.permanent=TRUE OR pass.ends_at>=UTC_TIMESTAMP(3))) premium_count,
        reset_item.id reset_ticket_item_id,COALESCE(reset_stack.quantity,0) reset_ticket_count,
        equipped.id equipped_id,COALESCE(equipped.custom_name,mini_definition.display_name) mini_name,mini_definition.emoji_value mini_emoji,mini_definition.grade_display_name mini_grade,
        equipped.enhancement_level mini_upgrade,equipped.battle_experience equipped_charm,main_pet.enhancement_level main_pet_upgrade,COALESCE(cube.pet_upgrade_percent,0) upgrade_percent,
        EXISTS(SELECT 1 FROM pet_skills a JOIN skill_definitions d ON d.id=a.skill_id WHERE a.player_pet_id=main_pet.id AND a.equipped=TRUE AND d.display_name='헌터') hunter,
        EXISTS(SELECT 1 FROM pet_skills a JOIN skill_definitions d ON d.id=a.skill_id WHERE a.player_pet_id=main_pet.id AND a.equipped=TRUE AND d.display_name='만렙헌터') max_hunter,
        EXISTS(SELECT 1 FROM pet_skills a JOIN skill_definitions d ON d.id=a.skill_id WHERE a.player_pet_id=main_pet.id AND a.equipped=TRUE AND d.display_name='약탈자') robber,
        EXISTS(SELECT 1 FROM pet_skills a JOIN skill_definitions d ON d.id=a.skill_id WHERE a.player_pet_id=main_pet.id AND a.equipped=TRUE AND d.display_name='정신승리') mind_win,
        EXISTS(SELECT 1 FROM pet_skills a JOIN skill_definitions d ON d.id=a.skill_id WHERE a.player_pet_id=main_pet.id AND a.equipped=TRUE AND d.display_name='야수의 본능') beast
        FROM players player JOIN player_profiles profile ON profile.player_id=player.id JOIN mini_pet_battle_states state ON state.player_id=player.id
        JOIN currency_accounts currency ON currency.player_id=player.id AND currency.currency_code='point'
        LEFT JOIN player_pet_daily_records daily ON daily.player_id=player.id AND daily.record_date=DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR))
        LEFT JOIN player_pets main_pet ON main_pet.player_id=player.id
        LEFT JOIN owned_mini_pets equipped ON equipped.player_id=player.id AND equipped.equipped=TRUE AND equipped.id=(SELECT MIN(e2.id) FROM owned_mini_pets e2 WHERE e2.player_id=player.id AND e2.equipped=TRUE)
        LEFT JOIN mini_pet_definitions mini_definition ON mini_definition.id=equipped.mini_pet_definition_id
        LEFT JOIN player_home_badge_cubes cube ON cube.player_id=player.id AND cube.equipped=TRUE
        LEFT JOIN item_definitions reset_item ON reset_item.code=? AND reset_item.active=TRUE
        LEFT JOIN inventory_stacks reset_stack ON reset_stack.player_id=player.id AND reset_stack.item_id=reset_item.id
        WHERE player.status='active' ORDER BY player.id FOR UPDATE`,[FREE_COUNTER,BOOSTER_COUNTER,RESET_CODE]);
      const bagRows=await transaction.query<Array<{player_id:Numeric;battle_experience:Numeric}>>("SELECT player_id,battle_experience FROM owned_mini_pets WHERE equipped=FALSE ORDER BY player_id,battle_experience DESC,id FOR UPDATE");
      const bags=new Map<string,number[]>();for(const row of bagRows){const key=String(row.player_id),values=bags.get(key)??[];values.push(integer(row.battle_experience));bags.set(key,values);}
      const combatants=rows.map(row=>{const bag=bags.get(String(row.player_id))??[],upgrade=Math.round(integer(row.main_pet_upgrade)*(1+integer(row.upgrade_percent)/100));return{
        playerId:String(row.player_id),displayName:row.display_name,level:integer(row.level_value),experience:integer(row.experience_value),pointBalance:BigInt(String(row.point_balance).split('.')[0]??'0'),wins:integer(row.win_count),losses:integer(row.loss_count),battleCount:integer(row.battle_count),freeUsed:integer(row.free_used),boosterCount:integer(row.booster_count),resetTicketItemId:row.reset_ticket_item_id===null?null:String(row.reset_ticket_item_id),resetTicketCount:integer(row.reset_ticket_count),premium:integer(row.premium_count)>0,equippedId:row.equipped_id===null?null:String(row.equipped_id),miniName:row.mini_name??'',miniEmoji:row.mini_emoji??'',miniGrade:row.mini_grade??'',miniUpgrade:integer(row.mini_upgrade),equippedCharm:integer(row.equipped_charm),bagCount:bag.length,totalCharm:integer(row.equipped_charm)+bag.slice(0,5).reduce((sum,value)=>sum+value,0),effectiveUpgradeLevel:upgrade,hasHunter:integer(row.hunter)>0,hasMaxHunter:integer(row.max_hunter)>0,hasRobber:integer(row.robber)>0,hasMindWin:integer(row.mind_win)>0,hasBeastInstinct:integer(row.beast)>0
      } satisfies MiniPetBattleCombatant;});
      const attacker=combatants.find(row=>row.playerId===String(identity.player_id));if(attacker===undefined)throw new ApplicationError("MINI_PET_BATTLE_PLAYER_REQUIRED","회원 정보를 찾을 수 없습니다.",409);
      const rewards=(await transaction.query<Array<{item_id:Numeric;code:string;display_name:string;quantity:Numeric}>>("SELECT reward.item_id,item.code,item.display_name,reward.quantity FROM mini_pet_battle_reward_definitions reward JOIN item_definitions item ON item.id=reward.item_id AND item.active=TRUE WHERE reward.active=TRUE ORDER BY reward.reward_order FOR UPDATE")).map(row=>({itemId:String(row.item_id),itemCode:row.code,itemName:row.display_name,quantity:integer(row.quantity)}));
      const seed=createHash("sha256").update(`${scope}:${key}:${identity.player_id}`).digest("hex");
      const resolution=resolveMiniPetBattle({attacker,candidates:combatants,rewards,seed,maxRuns:command.mode==="auto"?AUTO_MAX:DIRECT_MAX});
      const operation=await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'external_identity',?,'iris','processing',UTC_TIMESTAMP(3))",[randomUUID(),scope,key,identity.identity_id]);
      await transaction.execute("UPDATE mini_pet_battle_states SET win_count=?,loss_count=?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?",[resolution.attacker.wins,resolution.attacker.losses,resolution.attacker.playerId]);
      await transaction.execute(`INSERT INTO player_pet_daily_records(player_id,record_date,mini_battle_attempts,mini_battle_wins,mini_battle_losses,version) VALUES (?,DATE(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR)),1,?,?,1) ON DUPLICATE KEY UPDATE mini_battle_attempts=mini_battle_attempts+1,mini_battle_wins=VALUES(mini_battle_wins),mini_battle_losses=VALUES(mini_battle_losses),version=version+1`,[resolution.attacker.playerId,resolution.attacker.wins,resolution.attacker.losses]);
      await transaction.execute("UPDATE player_profiles SET experience=experience+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=?",[resolution.experienceDelta,resolution.attacker.playerId]);
      await transaction.execute("UPDATE currency_accounts SET balance=balance+?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point'",[resolution.pointDelta+resolution.robberDelta,resolution.attacker.playerId]);
      if(resolution.robberDelta>0)await transaction.execute("UPDATE currency_accounts SET balance=balance-?,version=version+1,updated_at=UTC_TIMESTAMP(3) WHERE player_id=? AND currency_code='point'",[resolution.robberDelta,resolution.defender.playerId]);
      await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,1,?,'point',?,?,'mini_pet_battle_reward')",[operation.insertId,resolution.attacker.playerId,resolution.pointDelta,(resolution.attacker.pointBalance-BigInt(resolution.robberDelta)).toString()]);
      if(resolution.robberDelta>0)await transaction.execute("INSERT INTO currency_ledger(operation_id,sequence_no,player_id,currency_code,delta,balance_after,reason_code) VALUES (?,2,?,'point',?,?,'mini_pet_battle_robber_gain'),(?,3,?,'point',-?,?, 'mini_pet_battle_robber_loss')",[operation.insertId,resolution.attacker.playerId,resolution.robberDelta,resolution.attacker.pointBalance.toString(),operation.insertId,resolution.defender.playerId,resolution.robberDelta,resolution.defender.pointBalance.toString()]);
      await transaction.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,?,DATE_FORMAT(DATE_ADD(UTC_TIMESTAMP(),INTERVAL 9 HOUR),'%Y-%m-%d'),?) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP(3)",[resolution.attacker.playerId,FREE_COUNTER,resolution.attacker.freeUsed]);
      await transaction.execute("INSERT INTO player_counters(player_id,counter_code,period_key,value) VALUES (?,?,'lifetime',?) ON DUPLICATE KEY UPDATE value=VALUES(value),updated_at=UTC_TIMESTAMP(3)",[resolution.attacker.playerId,BOOSTER_COUNTER,resolution.attacker.boosterCount]);
      let inventorySequence=1;
      if(resolution.resetTicketDelta<0){if(resolution.attacker.resetTicketItemId===null)throw new ApplicationError("MINI_PET_BATTLE_RESET_ITEM_REQUIRED","미니펫대전리셋권 설정을 찾을 수 없습니다.",409);const used=await transaction.execute("UPDATE inventory_stacks SET quantity=quantity-1,version=version+1 WHERE player_id=? AND item_id=? AND quantity>0",[resolution.attacker.playerId,resolution.attacker.resetTicketItemId]);if(used.affectedRows!==1n)throw new ApplicationError("MINI_PET_BATTLE_RESET_CONFLICT","미니펫대전리셋권 수량이 먼저 변경되었습니다.",409);await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?, -1,'mini_pet_battle_reset_used')",[operation.insertId,inventorySequence++,resolution.attacker.playerId,resolution.attacker.resetTicketItemId]);}
      await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE quantity=quantity+VALUES(quantity),version=version+1",[resolution.attacker.playerId,resolution.reward.itemId,resolution.reward.quantity]);
      await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,?,'mini_pet_battle_reward')",[operation.insertId,inventorySequence++,resolution.attacker.playerId,resolution.reward.itemId,resolution.reward.quantity]);
      if(resolution.hunterReward){const hunter=(await transaction.query<Array<{id:Numeric}>>("SELECT id FROM item_definitions WHERE code=? AND active=TRUE FOR UPDATE",[HUNTER_REWARD_CODE]))[0];if(hunter===undefined)throw new Error("MINI_PET_BATTLE_HUNTER_ITEM_REQUIRED");await transaction.execute("INSERT INTO inventory_stacks(player_id,item_id,quantity,version) VALUES (?,?,1,1) ON DUPLICATE KEY UPDATE quantity=quantity+1,version=version+1",[resolution.attacker.playerId,hunter.id]);await transaction.execute("INSERT INTO inventory_ledger(operation_id,sequence_no,player_id,item_id,quantity_delta,reason_code) VALUES (?,?,?,?,1,'mini_pet_battle_hunter_reward')",[operation.insertId,inventorySequence++,resolution.attacker.playerId,hunter.id]);}
      const settlement={attacker:resolution.attacker,defender:resolution.defender,messages:resolution.messages};
      await transaction.execute("INSERT INTO mini_pet_battle_settlements(operation_id,attacker_player_id,defender_player_id,attacker_won,attacker_charm,defender_charm,attacker_final_charm,defender_final_charm,experience_delta,point_delta,robber_delta,reset_ticket_delta,reward_item_id,reward_quantity,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",[operation.insertId,resolution.attacker.playerId,resolution.defender.playerId,resolution.attackerWon,resolution.attacker.totalCharm,resolution.defender.totalCharm,resolution.attackerFinal,resolution.defenderFinal,resolution.experienceDelta,resolution.pointDelta,resolution.robberDelta,resolution.resetTicketDelta,resolution.reward.itemId,resolution.reward.quantity,evidence(settlement)]);
      const outboxIds:string[]=[];for(const message of resolution.messages){const outbox=await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[operation.insertId,command.channelId,JSON.stringify({data:message})]);outboxIds.push(outbox.insertId.toString());}
      await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,'mini_pet_battle_execute',?,'completed','reply_queued',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",[command.eventId,operation.insertId]);
      await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'external_identity',?,'player',?,'mini_pet.battle.execute','success','Iris /미니펫대전',?,UTC_TIMESTAMP(3))",[operation.insertId,identity.identity_id,resolution.defender.playerId,JSON.stringify({attackerWon:resolution.attackerWon,pointDelta:resolution.pointDelta,robberDelta:resolution.robberDelta,rewardItemCode:resolution.reward.itemCode,mode:command.mode??'direct'})]);
      const result:MiniPetBattleExecuteResult={status:"completed",playerId:resolution.attacker.playerId,defenderPlayerId:resolution.defender.playerId,attackerWon:resolution.attackerWon,messages:resolution.messages,outboxIds,replayed:false};
      await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?",[JSON.stringify(result),operation.insertId]);return result;
    });
  }
}
