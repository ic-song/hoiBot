import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sourceRevision = "5925b83b1dbfb78ef583354604e112b9430003f3";
const catalogVersion = "ASSET-FREEZE-v2.438-tower-reward-target-01";
const sources = {
  trial: { path:"data/trialTowerBoss.json", baselineSha256:"d18ecd4d5a032f045bacfc1087e171a326f84979e60ce403447211ae6d65fa76", gitSha256:"b7f6155006e7c467e4f9c707882c9f7b86763c8b107e73aa70026486c603f5e5", operationalSha256:"363b92ed5a74c41e08fbf9f854a8eb7c008c45bb87cd27989dc30bf5d0eccb14" },
  event: { path:"data/eventTowerBoss.json", baselineSha256:"9972af5fdee7b5fe2788d0d00e2464b693d5918d419abc5bdc29b5e7fec19ea2", gitSha256:"986146633ebb9e674feee06da191bac0f3381c6eec9f1ad5e44b2d7690b1498e", operationalSha256:"b5661ba8572db6bb24d2ac10121281149dd3a2fefe932edd78af0983e625abbf" }
};
const targetMap = new Map([
  ["전설의 돌맹이🗿",["ITEM-RWD-052",false]],["미니펫뽑기🐹(/미니펫오픈)",["mini_pet_draw",false]],["펫스윗홈인테리어샵🖼️(/샵오픈)",["ITEM-RWD-001",false]],["펫 강화석⭐",["pet_enhance_stone",false]],["양념치킨🐔",["legacy-seasoned-chicken",false]],["경찰과 도둑🚨(/삐뽀삐뽀)",["police_thief_ticket",false]],["돌멩이🪨",["ITEM-RWD-041",false]],["미니펫대전리셋권🐹",["ITEM-MINI-PET-DUEL-RESET-TICKET",false]],["캐슬대전리셋권🐶",["legacy-castle-battle-reset-ticket",false]],["시련의탑리셋권😈",["ITEM-RWD-TRIAL-TOWER-RESET",false]],["펫던전 입장권🌋",["ITEM-PET-DUNGEON-ENTRY-TICKET",false]],["레이드타격대인장👑(+600👾)",["ITEM-RWD-043",false]],["잡템상자☠",["ITEM-RWD-TRASH-BOX",false]],["펫먹이🍼",["pet_food",false]],["펫스킬북📙(/펫스킬오픈)",["pet_skill_book",false]],["탐험확률UP🗻(50%)",["ITEM-RWD-030",false]],["땅문서📜",["land_document",false]],["신입지원금",["tower_newbie_support_fund",true]],["미니펫 강화석💫",["ITEM-RWD-018",false]],["럭키박스🍀(/럭키오픈)",["reward_lucky_box",false]],["펫스킬북 조각📙",["pet_skill_book_fragment",false]],["잡템☠️",["junk",false]],["펫먹이상자📦(/상자오픈)",["ITEM-RWD-PET-FOOD-BOX",false]],["펫타이틀권🦊(/펫타이틀이름)",["pet_title_ticket",true]]
]);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(repoRoot,"개발환경_고도화/migration-control/fixtures/synthetic-relational/tower-reward-target-parity-v2438.json");
const migrationPath = path.join(repoRoot,"개발환경_고도화/runtime/migrations/429_tower_reward_target_parity.sql");
const rollbackPath = path.join(repoRoot,"개발환경_고도화/migration-control/rollback/429_tower_reward_target_parity.sql");
const evidencePath = path.join(repoRoot,"개발환경_고도화/migration-control/evidence/tower-reward-target-parity/slice.json");

const loaded = {};
for (const [kind, source] of Object.entries(sources)) {
  const baselineRaw=fs.readFileSync(path.join(repoRoot,source.path));
  const approvedRaw=execFileSync("git",["cat-file","blob",`${sourceRevision}:${source.path}`],{cwd:repoRoot,maxBuffer:32*1024*1024});
  if(sha256(baselineRaw)!==source.baselineSha256) throw new Error(`TOWER_${kind}_BASELINE_HASH_DRIFT`);
  if(sha256(approvedRaw)!==source.gitSha256) throw new Error(`TOWER_${kind}_GIT_HASH_DRIFT`);
  if(sha256(Buffer.from(approvedRaw.toString("utf8").replace(/\n/g,"\r\n")))!==source.operationalSha256) throw new Error(`TOWER_${kind}_OPERATIONAL_HASH_DRIFT`);
  loaded[kind]={baseline:JSON.parse(baselineRaw.toString("utf8")),approved:JSON.parse(approvedRaw.toString("utf8"))};
}

const bosses=[]; const eventFloors=[]; const rewards=[];
for(let index=0;index<loaded.trial.approved.length;index++){
  const boss=validateTrial(loaded.trial.approved[index],index+1), sequence=index+1;
  const identityHash=sha256(JSON.stringify([boss.minFloor,boss.maxFloor,boss.name,boss.pettype]));
  bosses.push({sourceKind:"TRIAL",bossSequence:sequence,precedenceRank:2,matchStrategy:"FIRST_RANGE",displayName:boss.name,petTypeName:boss.pettype,minFloor:boss.minFloor,maxFloor:boss.maxFloor,identityHash,rewardCount:boss.reward.length});
  boss.reward.forEach((reward,rewardIndex)=>rewards.push(rewardRow("TRIAL",sequence,rewardIndex+1,reward)));
}
for(let index=0;index<loaded.event.approved.length;index++){
  const boss=validateEvent(loaded.event.approved[index],index+1), sequence=index+1;
  bosses.push({sourceKind:"EVENT",bossSequence:sequence,precedenceRank:1,matchStrategy:"EXACT_FLOOR",displayName:boss.name,petTypeName:null,minFloor:null,maxFloor:null,identityHash:sha256(JSON.stringify([boss.name,boss.floors])),rewardCount:1});
  boss.floors.forEach((floor,floorIndex)=>eventFloors.push({bossSequence:sequence,floorSequence:floorIndex+1,floorValue:floor}));
  rewards.push(rewardRow("EVENT",sequence,1,boss.reward));
}
const trialAddedRemoved=countTargetDelta(loaded.trial.baseline,loaded.trial.approved);
const counts={trialBosses:120,eventBosses:7,bosses:bosses.length,trialRewards:rewards.filter(row=>row.sourceKind==="TRIAL").length,eventRewards:rewards.filter(row=>row.sourceKind==="EVENT").length,rewards:rewards.length,eventFloorOccurrences:eventFloors.length,uniqueEventFloors:new Set(eventFloors.map(row=>row.floorValue)).size,uniqueTargets:new Set(rewards.map(row=>row.sourceItemName)).size,newTargets:[...targetMap.values()].filter(([,isNew])=>isNew).length,trialChangedBossRewards:loaded.trial.approved.filter((row,index)=>JSON.stringify(row.reward)!==JSON.stringify(loaded.trial.baseline[index].reward)).length,trialAddedTargetOccurrences:trialAddedRemoved.added,trialRemovedTargetOccurrences:trialAddedRemoved.removed,eventChangedRewards:loaded.event.approved.filter((row,index)=>JSON.stringify(row.reward)!==JSON.stringify(loaded.event.baseline[index].reward)).length,eventChangedFloorLists:loaded.event.approved.filter((row,index)=>JSON.stringify(row.floors)!==JSON.stringify(loaded.event.baseline[index].floors)).length};
const expected={trialBosses:120,eventBosses:7,bosses:127,trialRewards:377,eventRewards:7,rewards:384,eventFloorOccurrences:368,uniqueEventFloors:368,uniqueTargets:24,newTargets:2,trialChangedBossRewards:120,trialAddedTargetOccurrences:238,trialRemovedTargetOccurrences:242,eventChangedRewards:1,eventChangedFloorLists:0};
if(JSON.stringify(counts)!==JSON.stringify(expected)) throw new Error(`TOWER_REWARD_PARITY_DRIFT:${JSON.stringify(counts)}`);
if(new Set(rewards.map(row=>row.sourceItemName)).size!==targetMap.size) throw new Error("TOWER_REWARD_TARGET_MAP_DRIFT");
const itemOccurrences=[...targetMap].map(([displayName,[code,isNew]])=>({displayName,code,isNew,occurrenceCount:rewards.filter(row=>row.sourceItemName===displayName).length}));
const fixture={sliceId:"SL-ASSET-TOWER-REWARD-TARGET-PARITY-01",catalogVersion,sourceRevision,sources,counts,itemOccurrences,bosses,eventFloors,rewards,eventRewardReplacement:{boss:"🧙‍♂️할법사",before:{item:"마정석🔮",quantity:100},after:{item:"펫스킬북 조각📙",quantity:3}}};
for(const targetPath of [fixturePath,migrationPath,rollbackPath,evidencePath]) fs.mkdirSync(path.dirname(targetPath),{recursive:true});
fs.writeFileSync(fixturePath,`${JSON.stringify(fixture,null,2)}\n`);
fs.writeFileSync(migrationPath,buildMigration(fixture));
fs.writeFileSync(rollbackPath,buildRollback());
fs.writeFileSync(evidencePath,`${JSON.stringify({sliceId:fixture.sliceId,catalogVersion,sourceRevision,sources,counts,itemOccurrences,eventRewardReplacement:fixture.eventRewardReplacement,identityRule:"preserve source kind, boss order, event precedence, trial first-range order and ordered reward occurrences; target identity uses frozen canonical code plus exact source display",carryForward:["trial/event tower Gate1~7","existing item/object canonical truth","existing tower consumer/provider"],scope:{providerAdded:false,ownershipChanged:false,consumerChanged:false,operationalDataTouched:false,gate8:false}},null,2)}\n`);
console.log(JSON.stringify({catalogVersion,...counts}));

function rewardRow(sourceKind,bossSequence,rewardSequence,reward){if(!reward||typeof reward.item!=="string"||!Number.isSafeInteger(Number(reward.quantity))||Number(reward.quantity)<=0)throw new Error(`TOWER_REWARD_ROW_DRIFT:${sourceKind}:${bossSequence}:${rewardSequence}`);const target=targetMap.get(reward.item);if(!target)throw new Error(`TOWER_REWARD_TARGET_GAP:${reward.item}`);return{sourceKind,bossSequence,rewardSequence,targetKind:"STACK",itemCode:target[0],sourceItemName:reward.item,quantity:Number(reward.quantity),resolutionMode:target[1]?"NEW_STACK":"EXISTING_CANONICAL",rewardHash:sha256(JSON.stringify(reward))};}
function validateTrial(row,index){if(!row||!Number.isSafeInteger(Number(row.minFloor))||!Number.isSafeInteger(Number(row.maxFloor))||Number(row.minFloor)>Number(row.maxFloor)||typeof row.name!=="string"||typeof row.pettype!=="string"||!Array.isArray(row.reward))throw new Error(`TRIAL_BOSS_DRIFT:${index}`);return{...row,minFloor:Number(row.minFloor),maxFloor:Number(row.maxFloor)};}
function validateEvent(row,index){if(!row||typeof row.name!=="string"||!Array.isArray(row.floors)||row.floors.some(floor=>!Number.isSafeInteger(Number(floor)))||!row.reward)throw new Error(`EVENT_BOSS_DRIFT:${index}`);return{...row,floors:row.floors.map(Number)};}
function countTargetDelta(before,after){let added=0,removed=0;for(let index=0;index<after.length;index++){const left=countNames(before[index].reward),right=countNames(after[index].reward);for(const[key,value]of right)added+=Math.max(0,value-(left.get(key)??0));for(const[key,value]of left)removed+=Math.max(0,value-(right.get(key)??0));}return{added,removed};}
function countNames(rows){const result=new Map();for(const row of rows)result.set(row.item,(result.get(row.item)??0)+1);return result;}
function buildMigration(frozen){const bossValues=frozen.bosses.map(row=>`(${sql(row.sourceKind)},${row.bossSequence},${row.precedenceRank},${sql(row.matchStrategy)},${sql(row.displayName)},${row.petTypeName===null?"NULL":sql(row.petTypeName)},${row.minFloor===null?"NULL":row.minFloor},${row.maxFloor===null?"NULL":row.maxFloor},${sql(row.identityHash)},${row.rewardCount})`).join(",\n");const floorValues=frozen.eventFloors.map(row=>`(${row.bossSequence},${row.floorSequence},${row.floorValue})`).join(",\n");const rewardValues=frozen.rewards.map(row=>`(${sql(row.sourceKind)},${row.bossSequence},${row.rewardSequence},${sql(row.targetKind)},${sql(row.itemCode)},${sql(row.sourceItemName)},${row.quantity},${sql(row.resolutionMode)},${sql(row.rewardHash)})`).join(",\n");return `SET NAMES utf8mb4;
START TRANSACTION;
INSERT INTO item_definitions(code,display_name,asset_type_code,stackable,metadata_json,active,version) VALUES
('tower_newbie_support_fund','신입지원금','STACK',TRUE,JSON_OBJECT('domain','tower_reward','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)}),TRUE,1),
('pet_title_ticket','펫타이틀권🦊(/펫타이틀이름)','STACK',TRUE,JSON_OBJECT('domain','tower_reward','ownershipModel','STACK','catalogVersion',${sql(catalogVersion)}),TRUE,1)
ON DUPLICATE KEY UPDATE code=VALUES(code);
INSERT INTO object_registry(object_key,object_type,display_name,version,active,metadata_json) VALUES
('item.tower.newbie_support_fund','ITEM','신입지원금',1,TRUE,JSON_OBJECT('domain','tower_reward','canonicalDefinitionCode','tower_newbie_support_fund','catalogVersion',${sql(catalogVersion)})),
('item.tower.pet_title_ticket','ITEM','펫타이틀권🦊(/펫타이틀이름)',1,TRUE,JSON_OBJECT('domain','tower_reward','canonicalDefinitionCode','pet_title_ticket','catalogVersion',${sql(catalogVersion)}))
ON DUPLICATE KEY UPDATE object_key=VALUES(object_key);
INSERT INTO object_aliases(object_id,object_type,alias_type,alias_value)
SELECT id,'ITEM','legacy_name','신입지원금' FROM object_registry WHERE object_key='item.tower.newbie_support_fund' UNION ALL SELECT id,'ITEM','legacy_name','펫타이틀권🦊(/펫타이틀이름)' FROM object_registry WHERE object_key='item.tower.pet_title_ticket'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);
INSERT INTO object_source_bindings(object_id,object_type,source_system,source_table,source_key)
SELECT id,'ITEM','RUNTIME_DB','item_definitions','tower_newbie_support_fund' FROM object_registry WHERE object_key='item.tower.newbie_support_fund' UNION ALL SELECT id,'ITEM','LEGACY_JSON','trialTowerBoss.reward.v2_438','신입지원금' FROM object_registry WHERE object_key='item.tower.newbie_support_fund' UNION ALL SELECT id,'ITEM','RUNTIME_DB','item_definitions','pet_title_ticket' FROM object_registry WHERE object_key='item.tower.pet_title_ticket' UNION ALL SELECT id,'ITEM','LEGACY_JSON','trialTowerBoss.reward.v2_438','펫타이틀권🦊(/펫타이틀이름)' FROM object_registry WHERE object_key='item.tower.pet_title_ticket'
ON DUPLICATE KEY UPDATE object_id=VALUES(object_id),object_type=VALUES(object_type);
CREATE TABLE IF NOT EXISTS tower_reward_policy_catalog_versions(id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,version_code VARCHAR(96) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_revision CHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,trial_source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,event_source_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,event_precedence BOOLEAN NOT NULL,trial_first_range BOOLEAN NOT NULL,boss_count INT UNSIGNED NOT NULL,reward_count INT UNSIGNED NOT NULL,event_floor_count INT UNSIGNED NOT NULL,active BOOLEAN NOT NULL DEFAULT FALSE,created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),PRIMARY KEY(id),UNIQUE KEY uq_tower_reward_policy_version(version_code),KEY ix_tower_reward_policy_active(active)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tower_reward_policy_bosses(catalog_version_id BIGINT UNSIGNED NOT NULL,source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,boss_sequence INT UNSIGNED NOT NULL,precedence_rank TINYINT UNSIGNED NOT NULL,match_strategy VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,display_name VARCHAR(191) NOT NULL,pet_type_name VARCHAR(64) NULL,min_floor BIGINT UNSIGNED NULL,max_floor BIGINT UNSIGNED NULL,identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,reward_count INT UNSIGNED NOT NULL,PRIMARY KEY(catalog_version_id,source_kind,boss_sequence),CONSTRAINT fk_tower_reward_boss_catalog FOREIGN KEY(catalog_version_id) REFERENCES tower_reward_policy_catalog_versions(id) ON DELETE RESTRICT,CONSTRAINT chk_tower_reward_boss_kind CHECK(source_kind IN('TRIAL','EVENT'))) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tower_event_floor_occurrences(catalog_version_id BIGINT UNSIGNED NOT NULL,source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'EVENT',boss_sequence INT UNSIGNED NOT NULL,floor_sequence INT UNSIGNED NOT NULL,floor_value BIGINT UNSIGNED NOT NULL,PRIMARY KEY(catalog_version_id,source_kind,boss_sequence,floor_sequence),UNIQUE KEY uq_tower_event_floor_value(catalog_version_id,floor_value),CONSTRAINT fk_tower_event_floor_boss FOREIGN KEY(catalog_version_id,source_kind,boss_sequence) REFERENCES tower_reward_policy_bosses(catalog_version_id,source_kind,boss_sequence) ON DELETE RESTRICT,CONSTRAINT chk_tower_event_floor_kind CHECK(source_kind='EVENT')) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS tower_reward_target_occurrences(catalog_version_id BIGINT UNSIGNED NOT NULL,source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,boss_sequence INT UNSIGNED NOT NULL,reward_sequence INT UNSIGNED NOT NULL,target_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,item_definition_id BIGINT UNSIGNED NOT NULL,source_item_name VARCHAR(191) NOT NULL,quantity BIGINT UNSIGNED NOT NULL,resolution_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,reward_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(catalog_version_id,source_kind,boss_sequence,reward_sequence),KEY ix_tower_reward_target_item(item_definition_id),CONSTRAINT fk_tower_reward_target_boss FOREIGN KEY(catalog_version_id,source_kind,boss_sequence) REFERENCES tower_reward_policy_bosses(catalog_version_id,source_kind,boss_sequence) ON DELETE RESTRICT,CONSTRAINT fk_tower_reward_target_item FOREIGN KEY(item_definition_id) REFERENCES item_definitions(id) ON DELETE RESTRICT,CONSTRAINT chk_tower_reward_target_kind CHECK(target_kind='STACK'),CONSTRAINT chk_tower_reward_target_quantity CHECK(quantity>0)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT INTO tower_reward_policy_catalog_versions(version_code,source_revision,trial_source_sha256,event_source_sha256,event_precedence,trial_first_range,boss_count,reward_count,event_floor_count,active) VALUES(${sql(catalogVersion)},${sql(sourceRevision)},${sql(sources.trial.operationalSha256)},${sql(sources.event.operationalSha256)},TRUE,TRUE,127,384,368,TRUE) ON DUPLICATE KEY UPDATE version_code=VALUES(version_code);
SET @tower_reward_catalog_id_429=(SELECT id FROM tower_reward_policy_catalog_versions WHERE version_code=${sql(catalogVersion)} LIMIT 1);
UPDATE tower_reward_policy_catalog_versions SET active=(id=@tower_reward_catalog_id_429) WHERE active=TRUE OR id=@tower_reward_catalog_id_429;
CREATE TEMPORARY TABLE tmp_tower_bosses_429(source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,boss_sequence INT UNSIGNED NOT NULL,precedence_rank TINYINT UNSIGNED NOT NULL,match_strategy VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,display_name VARCHAR(191) NOT NULL,pet_type_name VARCHAR(64) NULL,min_floor BIGINT UNSIGNED NULL,max_floor BIGINT UNSIGNED NULL,identity_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,reward_count INT UNSIGNED NOT NULL,PRIMARY KEY(source_kind,boss_sequence)) ENGINE=InnoDB;
INSERT INTO tmp_tower_bosses_429 VALUES
${bossValues};
INSERT INTO tower_reward_policy_bosses SELECT @tower_reward_catalog_id_429,source_kind,boss_sequence,precedence_rank,match_strategy,display_name,pet_type_name,min_floor,max_floor,identity_hash,reward_count FROM tmp_tower_bosses_429 ORDER BY precedence_rank,boss_sequence ON DUPLICATE KEY UPDATE boss_sequence=VALUES(boss_sequence);
CREATE TEMPORARY TABLE tmp_tower_event_floors_429(boss_sequence INT UNSIGNED NOT NULL,floor_sequence INT UNSIGNED NOT NULL,floor_value BIGINT UNSIGNED NOT NULL,PRIMARY KEY(boss_sequence,floor_sequence)) ENGINE=InnoDB;
INSERT INTO tmp_tower_event_floors_429 VALUES
${floorValues};
INSERT INTO tower_event_floor_occurrences SELECT @tower_reward_catalog_id_429,'EVENT',boss_sequence,floor_sequence,floor_value FROM tmp_tower_event_floors_429 ORDER BY boss_sequence,floor_sequence ON DUPLICATE KEY UPDATE floor_sequence=VALUES(floor_sequence);
CREATE TEMPORARY TABLE tmp_tower_rewards_429(source_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,boss_sequence INT UNSIGNED NOT NULL,reward_sequence INT UNSIGNED NOT NULL,target_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,item_code VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,source_item_name VARCHAR(191) NOT NULL,quantity BIGINT UNSIGNED NOT NULL,resolution_mode VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,reward_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,PRIMARY KEY(source_kind,boss_sequence,reward_sequence)) ENGINE=InnoDB;
INSERT INTO tmp_tower_rewards_429 VALUES
${rewardValues};
INSERT INTO tower_reward_target_occurrences(catalog_version_id,source_kind,boss_sequence,reward_sequence,target_kind,item_definition_id,source_item_name,quantity,resolution_mode,reward_hash)
SELECT @tower_reward_catalog_id_429,row_data.source_kind,row_data.boss_sequence,row_data.reward_sequence,row_data.target_kind,item_row.id,row_data.source_item_name,row_data.quantity,row_data.resolution_mode,row_data.reward_hash FROM tmp_tower_rewards_429 row_data JOIN item_definitions item_row ON item_row.code=row_data.item_code AND BINARY item_row.display_name=BINARY row_data.source_item_name ORDER BY row_data.source_kind,row_data.boss_sequence,row_data.reward_sequence ON DUPLICATE KEY UPDATE reward_sequence=VALUES(reward_sequence);
DROP TEMPORARY TABLE tmp_tower_rewards_429;DROP TEMPORARY TABLE tmp_tower_event_floors_429;DROP TEMPORARY TABLE tmp_tower_bosses_429;
COMMIT;
`;}
function buildRollback(){return `SET NAMES utf8mb4;
START TRANSACTION;
SET @tower_reward_catalog_id_429=(SELECT id FROM tower_reward_policy_catalog_versions WHERE version_code=${sql(catalogVersion)} LIMIT 1);
DELETE FROM tower_reward_target_occurrences WHERE catalog_version_id=@tower_reward_catalog_id_429;
DELETE FROM tower_event_floor_occurrences WHERE catalog_version_id=@tower_reward_catalog_id_429;
DELETE FROM tower_reward_policy_bosses WHERE catalog_version_id=@tower_reward_catalog_id_429;
DELETE FROM tower_reward_policy_catalog_versions WHERE id=@tower_reward_catalog_id_429;
DELETE binding_row FROM object_source_bindings binding_row JOIN object_registry object_row ON object_row.id=binding_row.object_id WHERE object_row.object_key IN('item.tower.newbie_support_fund','item.tower.pet_title_ticket');
DELETE alias_row FROM object_aliases alias_row JOIN object_registry object_row ON object_row.id=alias_row.object_id WHERE object_row.object_key IN('item.tower.newbie_support_fund','item.tower.pet_title_ticket');
DELETE FROM object_registry WHERE object_key IN('item.tower.newbie_support_fund','item.tower.pet_title_ticket');
DELETE FROM item_definitions WHERE code IN('tower_newbie_support_fund','pet_title_ticket');
COMMIT;
`;}
function sha256(value){return crypto.createHash("sha256").update(value).digest("hex");}
function sql(value){return `'${String(value).replaceAll("'","''")}'`;}
