# 호이봇 RDB 테이블 설계

현재 `data/*.json` 구조와 `main.js`/`Info.js` 명령 흐름을 기준으로 한 1차 RDB 설계안이다.

## 설계 원칙

- 현재 봇의 회원 키인 `닉네임 성별`, 예: `맹구 여`, `호이 남`은 `user_key`로 유지한다.
- 내부 조인용 기본키는 숫자 `id`를 사용한다.
- 명령 처리에 자주 필요한 값은 컬럼으로 분리한다.
- 구조가 자주 바뀌거나 상세 원본 보존이 필요한 값은 `raw_json` 또는 `meta_json`에 같이 보관한다.
- 맞짱은 별도 `fight_snapshots` 테이블을 두지 않고, `fight_entries`에 참여 당시 계산값을 저장한다.
- 운영 설정, 기준표, 이벤트표는 참조 테이블로 분리하고 원본 JSON도 보존한다.

## 전체 관계도

```text
회원(users)
 ├─1 회원 진행상태(user_progress)
 ├─< 회원 역할(user_roles)
 ├─< 회원 아이템(user_items)
 ├─< 회원 재화(user_currencies)
 ├─< 재화 로그(currency_logs)
 ├─1 대표 펫(user_pets)
 ├─< 펫 스킬(user_pet_skills)
 ├─< 회원 칭호(user_titles)
 ├─1 펫 홈(user_homes)
 ├─< 홈 가구(user_home_furniture)
 ├─< 홈 댓글(user_home_comments)
 ├─< 미니펫(user_mini_pets)
 ├─< 미니펫 컬렉션(user_mini_pet_collections)
 ├─< 맞짱 참여(fight_entries)
 ├─< 펀치 랭킹(punch_rank_records)
 ├─< 시련의탑 진행(trial_tower_progress)
 ├─< 펫 탐험 전적(pet_explore_records)
 └─< 패키지 로그(package_logs)

길드(guilds)
 ├─< 길드원(guild_members)
 ├─< 길드 창고(guild_warehouse_items)
 ├─< 길드 상점(guild_shop_items)
 ├─< 길드 게시글(guild_board_posts)
 └─< 길드 영지 참여/상태(guild_territory_*)

맞짱 참여(fight_entries)
 ├─< 맞짱 전투(fight_battles.attacker_entry_id)
 └─< 맞짱 전투(fight_battles.defender_entry_id)

자유시장 매물(market_listings)
 └─< 자유시장 거래(market_trade_logs)

게시판(boards)
 └─< 게시글(board_posts)
```

## 회원/권한/진행

### 회원(users)

```text
PK id: 내부 회원 ID
UK user_key: 현재 봇 회원 키
display_name: 표시명
gender: 성별 구분
server: 서버
joined_at: 가입일
is_active: 활성 여부
raw_json: member.json의 회원 원본
created_at
updated_at
```

### 회원 진행상태(user_progress)

`member.json > member[user]`의 레벨, 포인트, 채팅, 출석, 전투, 후원, 길드 연결 값을 보관한다.

```text
PK user_id -> users.id
level
exp
point
diamond
booster_count
chat_count
chat_count_prev
attendance_count
today
like_count
like_count_prev
rank
recent
rebirth_count
voice_check
earnings
battle_count
tower_count
carrot_given
thermo_points
home_like_count
agree_flag
first_sponsor
check_count
weekly_quest_count
guild_key
guild_medal_buy_count
guild_contribution_count
explore_count
raw_json
updated_at
```

### 회원 역할(user_roles)

`master`, `admin`, `allowedUsers*`, 운영 권한성 목록을 통합한다.

```text
PK id
FK user_id -> users.id
role_type: master, admin, allowed_2, allowed_4, allowed_6, hoipass 등
memo
created_at
UK user_id + role_type
```

### 운영 상태(system_states)

`member.json` 루트에 있는 전역 상태값, 이벤트 플래그, 랭킹 캐시, 임시 상태를 보관한다.

```text
PK state_key
state_group: attendance, event, ranking_cache, interval, config 등
state_json
updated_at
```

## 아이템/재화/상점

### 회원 아이템(user_items)

`member.member[user].bag`, `member_pet.miniPetBag`, `petSweetHomeData.furnitureBag` 등 보관 위치가 다른 가방을 통합한다.

```text
PK id
FK user_id -> users.id
source_type: member_bag, mini_pet_bag, furniture_bag, guild_reward 등
item_name
quantity
sort_order
bound_flag
meta_json
created_at
updated_at
UK user_id + source_type + item_name + sort_order
```

### 회원 재화(user_currencies)

포인트/다이아 외 누적성 재화를 통합한다.

```text
PK id
FK user_id -> users.id
currency_type: point, diamond, carrot, guild_medal 등
amount
updated_at
UK user_id + currency_type
```

### 재화 로그(currency_logs)

`currencyLog.json`과 재화 증감 이력을 저장한다.

```text
PK id
FK user_id -> users.id
user_key
currency_type
change_amount
balance_after
reason
command_name
room
created_at
raw_json
```

### 상점 상품(shop_items)

`member.json > shop`, `lordShop`, `guildData.shop`, 다이아상점류를 통합한다.

```text
PK id
shop_type: normal, lord, guild, diamond, event 등
item_name
price_currency
price_amount
stock
enabled
reward_json
raw_json
created_at
updated_at
```

## 펫/스킬/칭호

### 대표 펫(user_pets)

`member_pet.json[user]`의 대표 펫 정보.

```text
PK id
FK user_id -> users.id
pet_name
pet_type
pet_img
pet_joined_at
pet_exp
pet_win
pet_raid
pet_title
upgrade
upgrade_datetime
elemental
ring
raid_item_count
raw_json
updated_at
```

### 펫 스킬(user_pet_skills)

`petSkillData.json[user].petSkills.equipped`, `bag`.

```text
PK id
FK user_id -> users.id
skill_name
slot_type: equipped, bag
quantity
slot_no
raw_json
UK user_id + skill_name + slot_type + slot_no
```

### 회원 칭호(user_titles)

`member_title.json`, `pet_title.json`, `miniPet_title.json` 통합.

```text
PK id
FK user_id -> users.id
title_type: member, pet, mini_pet
title_name
equipped_flag
acquired_at
meta_json
UK user_id + title_type + title_name
```

## 미니펫/컬렉션

### 미니펫(user_mini_pets)

`member_pet.json[user].miniPet`, `miniPetBag`를 보관한다.

```text
PK id
FK user_id -> users.id
source_type: current, bag
mini_pet_name
emoji
grade
price
battle_exp
castle_exp
raid_exp
upgrade
sort_index
quantity
raw_json
```

### 미니펫 전투(user_mini_pet_battle_stats)

`member_pet.json[user].miniPetBattle`.

```text
PK user_id -> users.id
win_count
lose_count
daily_count
updated_at
```

### 미니펫 컬렉션(user_mini_pet_collections)

`miniPet_collection.json`.

```text
PK id
FK user_id -> users.id
stage
completed_stage
grade
registered
raw_json
UK user_id + grade
```

## 펫 스윗홈/가구

### 펫 홈(user_homes)

`petSweetHomeData.json[user]`.

```text
PK user_id -> users.id
floor
house_name
exp
visit_count
like_count
comment
comment_time
raw_json
updated_at
```

### 홈 가구(user_home_furniture)

`petHomePlacedFurniture.json[user]`의 장착 가구와 `petSweetHomeData.json[user].furnitureBag`.

```text
PK id
FK user_id -> users.id
furniture_uid
source_type: placed, bag
furniture_name
grade
exp
rate
sort_order
raw_json
```

### 홈 댓글(user_home_comments)

`guestComments`.

```text
PK id
FK home_user_id -> users.id
FK writer_user_id -> users.id NULL
writer_key
content
created_at
raw_json
```

## 길드/영지

### 길드(guilds)

`guildData.json > guilds`.

```text
PK id
UK guild_key: g_0001 등
UK guild_name
mark
server
master_user_key
level
exp
max_member
member_close
join_condition_exp
notice
rank
rank_title
created_at
raw_json
updated_at
```

### 길드원(guild_members)

```text
PK id
FK guild_id -> guilds.id
FK user_id -> users.id NULL
user_key
role: MASTER, ADMIN, MEMBER
contribution
joined_at
UK guild_id + user_key
```

### 길드 창고(guild_warehouse_items)

```text
PK id
FK guild_id -> guilds.id
item_type: ring, pet, miniPet, fund, elemental 등
amount
updated_at
UK guild_id + item_type
```

### 길드 상점(guild_shop_items)

```text
PK id
item_name
price
enabled
reward_json
raw_json
```

### 길드 게시글(guild_board_posts)

```text
PK id
FK guild_id -> guilds.id
post_type: notice, normal
writer_key
content
created_at
updated_at
raw_json
```

### 길드 영지(guild_territories)

`guildData.territoryWar.territories`.

```text
PK territory_no
territory_name
owner_guild_id -> guilds.id NULL
owner_user_key
raw_json
updated_at
```

### 길드 영지 진행상태(guild_territory_war_state)

```text
PK id
active
started_at
ended_at
current_turn_index
state_json
updated_at
```

### 길드 영지 참여/턴(guild_territory_turns)

```text
PK id
war_state_id
turn_order
guild_key
user_key
status
meta_json
```

## 맞짱/대전/랭킹

### 맞짱 참여(fight_entries)

별도 스냅샷 테이블 없이 참여 당시 계산값을 이 테이블에 저장한다.

```text
PK id
room
FK user_id -> users.id
user_key
status: joined, matched, done, canceled
total_charm_at_join
castle_charm_at_join
raid_charm_at_join
enhance_bonus_at_join
detail_json_at_join
joined_at
matched_at
finished_at
```

### 맞짱 전투(fight_battles)

```text
PK id
room
FK attacker_entry_id -> fight_entries.id
FK defender_entry_id -> fight_entries.id
attacker_user_key
defender_user_key
attacker_charm
defender_charm
winner_user_key
result_json
created_at
```

### 캐슬 대전 상태(castle_battle_state)

`castleBattle2.json.flag`, 전역 상태.

```text
PK id
active_flag
state_json
updated_at
```

### 캐슬 대전 점수(castle_battle_scores)

`castleBattle2.json.score`, `rank`.

```text
PK id
user_key
score
rank_no
season_key
raw_json
updated_at
UK season_key + user_key
```

### 캐슬 대전 이력(castle_battle_history)

```text
PK id
user_key
opponent_key
result
score_delta
created_at
raw_json
```

### 펀치 랭킹(punch_rank_records)

`punchRankData.json`.

```text
PK id
FK user_id -> users.id NULL
user_key
score
record_json
updated_at
```

## 시련의탑/탐험/이벤트

### 시련의탑 진행(trial_tower_progress)

`trialTower.json.user`.

```text
PK user_id -> users.id
floor
last_win_time
raw_json
updated_at
```

### 시련의탑 상태(trial_tower_state)

```text
PK id
active_flag
state_json
updated_at
```

### 펫 탐험 베팅(pet_explore_bets)

`petExploreData.json.bet`, `userBet`.

```text
PK id
dungeon_no
user_key
bet_type
amount
status
created_at
raw_json
```

### 펫 탐험 전적(pet_explore_records)

`petExploreData.json.record`.

```text
PK id
FK user_id -> users.id NULL
user_key
win_count
lose_count
updated_at
```

### 펫 탐험 상태(pet_explore_state)

```text
PK state_key
state_json
updated_at
```

## 게시판/당근/시장

### 게시판(boards)

`board.json`, `carrotBoard.json`를 통합한다.

```text
PK id
board_type: memo, record, carrot
title
enabled
created_at
```

### 게시글(board_posts)

```text
PK id
FK board_id -> boards.id
user_key
content
posted_at
raw_json
```

### 자유시장 매물(market_listings)

`freeMarket.json.listings`.

```text
PK id
status: SELLING, CANCELED, SOLD
listing_type: bag, miniPet, furniture, skill
seller_user_key
item_name
quantity
price
payload_json
carrot_fee
created_at
created_at_ms
raw_json
```

### 자유시장 거래 로그(market_trade_logs)

`freeMarket.json.completedLogs`.

```text
PK id
listing_type
item_name
quantity
price
seller_receive
fee_amount
fee_rate
member_fee_applied
seller_user_key
buyer_user_key
completed_at
completed_at_ms
raw_json
```

## 패키지/보상

### 패키지(packages)

`packageInfo.json`.

```text
PK package_id
name
description
enabled
max_use_once
raw_json
created_at
updated_at
```

### 패키지 보상(package_rewards)

```text
PK id
FK package_id -> packages.package_id
reward_order
reward_type
reward_name
quantity
meta_json
```

### 패키지 로그(package_logs)

`packageLog.json`.

```text
PK id
log_id
FK package_id -> packages.package_id NULL
FK user_id -> users.id NULL
user_key
action_type: grant, use
quantity
created_at
raw_json
```

## 기준표/참조 데이터

### 공통 코드(common_codes)

명령/도메인에서 반복되는 상태값, 등급, 타입, 역할 코드를 통합 관리한다.

```text
PK id
code_group: 코드 그룹, 예: fight_status, item_source_type, guild_role, title_type
code: 실제 코드값, 예: joined, member_bag, MASTER
code_name: 표시명
sort_order
enabled
description
meta_json
created_at
updated_at
UK code_group + code
```

### 아이템 기준(item_master)

`itemInfo.json`의 정령, 반지, 레이드/캐슬 아이템.

```text
PK id
category: elemental, ring, raidSpecialItem, castlePremiumItem, castleItem
item_name
grade
exp_value
price
effect_json
raw_json
UK category + item_name
```

### 아이템 제한(item_restrictions)

`itemList.json`.

```text
PK id
restriction_type: non_item, untradable
item_name
```

### 미니펫 기준(mini_pet_master)

`miniPetData.json`.

```text
PK id
mini_pet_name
emoji
grade
price
battle_exp
castle_exp
raid_exp
sort_index
raw_json
```

### 미니펫 등급 기준(mini_pet_grade_master)

```text
PK grade
sort_order
rate
meta_json
```

### 미니펫 컬렉션 기준(mini_pet_collection_master)

`miniPetCollectionInfo.json`.

```text
PK id
master_type: gradeReward, stageReward, title
grade
stage
reward_json
raw_json
```

### 펫 홈 기준(home_master)

`petSweetHomeInfo.json.homeInfo`.

```text
PK id
floor
house_name
required_exp
reward_json
raw_json
```

### 가구 기준(furniture_master)

`petSweetHomeInfo.json.furniture`.

```text
PK id
furniture_name
grade
exp
rate
price
raw_json
```

### 탑/이벤트 보스 기준(tower_boss_master)

`trialTowerBoss.json`, `eventTowerBoss.json`.

```text
PK id
tower_type: trial, event
min_floor
max_floor
boss_name
pet_type
reward_json
raw_json
```

## 운영/로그/설정

### 호이봇 변경 이력(bot_change_logs)

`hoiBotChangeLog.json`.

```text
PK id
version
changed_at
changes
raw_json
```

### 에러 로그(error_logs)

`errorLog.json`.

```text
PK id
system
error_message
trigger_msg
room
sender_key
created_at
raw_json
```

### 요청 모니터링 설정(request_monitor_config)

`requestMonitorConfig.json`.

```text
PK id
window_ms
limit_count
excluded_commands_json
excluded_rooms_json
updated_at
```

### 명령 실행 로그(command_logs)

RDB 전환 후 API 서버에서 새로 남길 운영 로그.

```text
PK id
room
sender_key
command_name
request_json
response_status
elapsed_ms
created_at
```

## 명령어 영역별 커버리지

| 명령 영역 | 대표 명령 | 주요 테이블 |
| --- | --- | --- |
| 가입/회원/출석/레벨/포인트 | `/가입`, `/내정보`, `/레벨`, `/포인트`, `/출석목록` | `users`, `user_progress`, `user_currencies`, `currency_logs` |
| 관리자/마스터/권한 | `/관리자추가`, `/마스터추가`, `/관리자명단` | `user_roles`, `system_states`, `command_logs` |
| 가방/구매/판매/상점 | `/가방`, `/구매`, `/상점`, `/다이아상점` | `user_items`, `shop_items`, `user_currencies`, `currency_logs` |
| 당근/자유시장/거래 | `/당근등록`, `/당근완료`, `/가방거래등록`, `/구매` | `boards`, `board_posts`, `market_listings`, `market_trade_logs` |
| 펫/정령/반지/강화 | `/펫정보`, `/정령순위`, `/반지강화`, `/펫강순위` | `user_pets`, `item_master`, `user_items`, `currency_logs` |
| 펫스킬 | `/펫스킬`, `/펫스킬장착`, 펫스킬 보정 명령 | `user_pet_skills`, `user_items`, `system_states` |
| 미니펫 | `/미니펫`, `/미니펫가방`, `/미니펫강화`, `/미니펫대전` | `user_mini_pets`, `user_mini_pet_battle_stats`, `mini_pet_master` |
| 미니펫 컬렉션/타이틀 | `/미니펫컬렉션`, `/미니펫타이틀목록` | `user_mini_pet_collections`, `mini_pet_collection_master`, `user_titles` |
| 펫 스윗홈/가구 | `/가구가방`, `/가구장착`, `/가구순위` | `user_homes`, `user_home_furniture`, `user_home_comments`, `furniture_master` |
| 길드 | `/길드만들기`, `/길드가입`, `/길드정보`, `/길드상점` | `guilds`, `guild_members`, `guild_warehouse_items`, `guild_shop_items` |
| 길드 영지 | `/길드영지준비`, `/길드영지시작`, `/길드영지확인` | `guild_territories`, `guild_territory_war_state`, `guild_territory_turns` |
| 맞짱/종합매력 | `/맞짱`, `/맞짱시작`, `/맞짱시간체크` | `fight_entries`, `fight_battles`, `users`, `user_pets`, `user_homes`, `user_mini_pets`, `user_pet_skills` |
| 캐슬 대전 | `/캐슬대전`, `/캐슬대전순위`, `/캐슬전적` | `castle_battle_state`, `castle_battle_scores`, `castle_battle_history` |
| 시련의탑 | `/시련의탑순위`, 탑 도전/보상 명령 | `trial_tower_progress`, `trial_tower_state`, `tower_boss_master` |
| 펫 탐험 | 펫탐험/베팅/전적 명령 | `pet_explore_bets`, `pet_explore_records`, `pet_explore_state` |
| 패키지/보상 | 패키지 추가/지급/사용 명령 | `packages`, `package_rewards`, `package_logs`, `user_items` |
| 랭킹/정보 조회 | `/종합순위`, `/캐슬매력순위`, `/레이드매력순위`, `/서버통계` | 각 도메인 테이블 + 조회용 인덱스 |
| 운영/백업/모니터링 | `/데이터백업`, `/수정내용`, 요청 모니터링 | `bot_change_logs`, `error_logs`, `request_monitor_config`, `command_logs`, `common_codes` |

## JSON 파일별 이관 매핑

| JSON 파일 | 주요 테이블 |
| --- | --- |
| `member.json` | `users`, `user_progress`, `user_roles`, `user_items`, `user_currencies`, `shop_items`, `system_states` |
| `member_pet.json` | `user_pets`, `user_mini_pets`, `user_mini_pet_battle_stats`, `user_items` |
| `petSkillData.json` | `user_pet_skills` |
| `petSweetHomeData.json` | `user_homes`, `user_home_furniture(source_type=bag)`, `user_home_comments` |
| `petHomePlacedFurniture.json` | `user_home_furniture(source_type=placed)` |
| `petSweetHomeInfo.json` | `home_master`, `furniture_master` |
| `miniPetData.json` | `mini_pet_master`, `mini_pet_grade_master` |
| `miniPet_collection.json` | `user_mini_pet_collections` |
| `miniPetCollectionInfo.json` | `mini_pet_collection_master` |
| `member_title.json` | `user_titles(title_type=member)` |
| `pet_title.json` | `user_titles(title_type=pet)` |
| `miniPet_title.json` | `user_titles(title_type=mini_pet)` |
| `guildData.json` | `guilds`, `guild_members`, `guild_warehouse_items`, `guild_shop_items`, `guild_board_posts`, `guild_territories`, `guild_territory_war_state`, `guild_territory_turns` |
| `freeMarket.json` | `market_listings`, `market_trade_logs` |
| `board.json` | `boards`, `board_posts` |
| `carrotBoard.json` | `boards`, `board_posts` |
| `currencyLog.json` | `user_currencies`, `currency_logs` |
| `castleBattle2.json` | `castle_battle_state`, `castle_battle_scores`, `castle_battle_history` |
| `trialTower.json` | `trial_tower_state`, `trial_tower_progress` |
| `trialTowerBoss.json` | `tower_boss_master(tower_type=trial)` |
| `eventTowerBoss.json` | `tower_boss_master(tower_type=event)` |
| `petExploreData.json` | `pet_explore_bets`, `pet_explore_records`, `pet_explore_state` |
| `punchRankData.json` | `punch_rank_records` |
| `itemInfo.json` | `item_master` |
| `itemList.json` | `item_restrictions` |
| `packageInfo.json` | `packages`, `package_rewards` |
| `packageLog.json` | `package_logs` |
| `hoiBotChangeLog.json` | `bot_change_logs` |
| `errorLog.json` | `error_logs` |
| `requestMonitorConfig.json` | `request_monitor_config` |
| `memberBagCheck/memberBagCheck.json` | `system_states` 또는 별도 검증 로그 테이블 |

## 맞짱 참여값 저장 방식

`fight_snapshots` 테이블은 만들지 않는다.

```text
/맞짱참여
 → 현재 회원/펫/스킬/홈/미니펫/길드 보정 조회
 → 종합매력 계산
 → fight_entries.total_charm_at_join 등에 저장
 → 전투는 fight_entries에 저장된 참여 당시 값을 기준으로 처리
```

이 방식이면 테이블 수를 줄이면서도 “참여 시점 기준” 요구를 만족한다.
