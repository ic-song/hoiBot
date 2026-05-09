# COMMAND_REGISTRY.md

Status: PARTIAL

This document is an AI-oriented navigation index for command and helper exploration.
Source of truth is always the current codebase, especially `main.js` and `Info.js`.

## How To Read This File

- `VERIFIED`: confirmed against current code in this repository
- `PARTIAL`: partially confirmed, useful as a navigation hint but not complete
- `STALE`: likely outdated, re-check code before using
- `UNKNOWN`: not verified yet

## AI Navigation Rules

- Use this file as a starting map, not as proof.
- Prefer jumping to listed command anchors first, then inspect related helpers.
- If a command appears in both `main.js` and `Info.js`, trust the actual branch handling in code.
- When a command mutates game state, check both `loadJsonFile` and `saveJsonFile` calls in the same branch.
- When a command reads home/guild/pet data, also inspect the normalization helper listed in `Related Helpers`.
- `명령어_분리.md` is the human-friendly command list. This file is the AI-friendly code navigation index.

## Shared Search Anchors

- `function response`
- `function loadJsonFile`
- `function saveJsonFile`
- `function generateBagOutput`
- `function initSweetHomeUser`
- `function buildMiniPetBagMessage`
- `function getMyGuildId`
- `function ensureGuildTerritoryWar`
- `function calculateTotalExp`

## Shared Data Files

- `filePath`: member data, backed by `data/member.json`
- `memberPetPath`: pet and mini-pet data, backed by `data/member_pet.json`
- `guildPath`: guild data, backed by `data/guildData.json`
- `homeDataFile`: sweet-home data, backed by `data/petSweetHomeData.json`
- `petSkillDataPath`: pet skill data, backed by `data/petSkillData.json`
- `trialTowerPath`: trial tower data, backed by `data/trialTower.json`
- `castleBattlePath`: castle battle data, backed by `data/castleBattle.json`
- `petTitlePath`: pet title data, backed by `data/pet_title.json`
- `memberTitlePath`: member title data, backed by `data/member_title.json`

---

# /가방

Status: VERIFIED

## Command Anchors

- `main.js:20672`
- Alias: `ㄴㄴㄴ`

## Files

- `main.js`

## Related Helpers

- `generateBagOutput`
- `checkRank`

## Data Usage

- `data.member[sender].bag`
- `data.adv`

## Save Flow

- No intended state mutation
- Branch does not call `saveJsonFile` for member data

## Related Commands

- `/가방속성`
- `/가방추가`
- `/당근`
- `/돌가방`

## AI Notes

- Primary read-only inventory output command
- Good entry point for bag item shape and numbering logic
- For bag item numbering, inspect `generateBagOutput` in `main.js`

---

# /미니펫가방

Status: VERIFIED

## Command Anchors

- `main.js:24710`

## Files

- `main.js`

## Related Helpers

- `buildMiniPetBagMessage`
- `checkRank`

## Data Usage

- `petData[sender].miniPetBag`
- `petData[sender].miniPet`
- `miniPetData`

## Save Flow

- Calls `saveJsonFile(petData, memberPetPath)` after message build

## Related Commands

- `/미니펫정보`
- `/미니펫장착`
- `/미니펫조합...`
- `/미니펫가방정리`
- `/귀속해제`

## AI Notes

- Canonical entry point for mini-pet bag rendering
- For bag format and viewer-target split, inspect `buildMiniPetBagMessage` in `main.js`
- Nearby branches contain most mini-pet bag mutation logic

---

# /가구가방

Status: VERIFIED

## Command Anchors

- `main.js:25935`

## Files

- `main.js`

## Related Helpers

- `initSweetHomeUser`
- `sortFurnitureList`
- `getFurnitureMaxSlots`
- `getFurnitureExp`
- `getHomeTotalExp`
- `checkRank`

## Data Usage

- `homeData[sender].furnitureBag`
- `homeData[sender].placedFurniture`
- `homeData[sender].floor`
- `homeData[sender].houseName`
- `petSkillData`
- `petData`

## Save Flow

- Calls `saveJsonFile(homeData, homeDataFile)` after normalization/sorting

## Related Commands

- `/가구정보`
- `/가구가방정리`
- `/가구전체정리`
- `/가구장착`
- `/가구제거`
- `/가구순위`

## AI Notes

- Canonical read path for sweet-home furniture bag
- This branch normalizes home user data before output
- If investigating furniture slot counts, inspect `getFurnitureMaxSlots`

---

# /길드영지시작

Status: VERIFIED

## Command Anchors

- `main.js:18349`

## Files

- `main.js`

## Related Helpers

- `ensureGuildTerritoryWar`
- `buildGuildTerritoryPrepareMessage`
- `buildGuildTerritoryTurnRows`
- `getGuildTerritoryAttackerNames`
- `getGuildTerritoryAttackLimit`
- `scheduleGuildTerritoryWarStart`
- `beginGuildTerritoryWarNow`
- `scheduleGuildTerritoryOpening`
- `buildGuildTerritoryOrderMessage`
- `buildGuildTerritoryStatusMessage`
- `buildGuildTerritoryStartMessage`
- `startGuildTerritoryTurnTimer`

## Data Usage

- `guildData.territoryWar.pendingStart`
- `guildData.territoryWar.pendingStartToken`
- `guildData.territoryWar.startReady`
- `guildData.territoryWar.openingToken`
- `guildData.territoryWar.turnOrder`
- `guildData.castleSiegeFlag`

## Save Flow

- Saves `guildData` when start reservation is created
- Reloads latest `member/pet/guild` data inside delayed start callback
- Saves `guildData` after turn order is created
- Saves `guildData` again when 5-second opening grace ends and attacks become available

## Related Commands

- `/길드영지준비`
- `/길드영지종료`
- `/길드영지순서`
- `/영지공격 [숫자]`

## AI Notes

- Start flow is staged: `NoticeMsg` prepare notice -> 20s wait -> castle-room order output -> 5s grace -> status output -> start notice -> first turn timer
- Turn order and guild attack limits may include `전투형 지휘관📙`, `기사단 증원📙` 길드마스터 effects at start time
- During the 5-second grace window, `/영지공격` is intentionally blocked by `territoryWar.startReady`
- Cancellation and forced finish should clear both pending-start and opening-grace timers

---

# /영지공격 [숫자]

Status: VERIFIED

## Command Anchors

- `main.js:18448`

## Files

- `main.js`

## Related Helpers

- `ensureGuildTerritoryWar`
- `getMyGuildInfo`
- `isGuildSwordMaster`
- `isGuildTerritoryAttacker`
- `hasGuildTerritoryCommanderSkill`
- `hasGuildTerritoryKnightOrderSkill`
- `getGuildTerritoryTurnRow`
- `getGuildTerritoryAttackLimitForWar`
- `applyGuildTerritoryTurnReward`
- `buildPetSkillTriggerMessage`
- `resolveGuildTerritoryAttack`
- `processGuildTerritoryRiftEvent`
- `advanceGuildTerritoryTurn`
- `buildGuildTerritoryCurrentTurnLine`
- `buildGuildTerritoryTurnMessage`
- `startGuildTerritoryTurnTimer`

## Data Usage

- `guildData.territoryWar.active`
- `guildData.territoryWar.startReady`
- `guildData.territoryWar.eliminatedUsers`
- `guildData.territoryWar.eliminatedGuilds`
- `guildData.territoryWar.readyGuilds`
- `guildData.territoryWar.guildAttackCounts`

## Save Flow

- Clears active turn timer before resolving a valid attack
- Saves `guildData` and `data` after attack resolution and turn advance
- Finish path saves `guildData` and `data` through `finishGuildTerritoryWar`

## Related Commands

- `/길드영지시작`
- `/길드영지준비`
- `/길드영지순서`
- `/길드영지종료`

## AI Notes

- Rejects attacks while the war is active but not yet start-ready
- `전투형 지휘관📙` 길드마스터는 소드마스터가 아니어도 공격 가능하며, 직접 공격 시 랜덤 발동 멘트를 prepend한다
- `기사단 증원📙` 길드마스터가 있으면 길드 전체 공격 횟수 `+5`가 적용되고, 공격 결과에 발동 멘트가 prepend된다
- `철벽수호자📙`, `바바리안📙`는 영지전 소모 아이템 판정이 먼저 실행된 뒤, 미발동 시 5% 확률의 80% 보정 판정으로 처리된다
- Non-final attack results prepend the next attacker's turn line before the result body
- Wrong-turn attacks eliminate the acting user from the current territory-war rotation
- `지휘관의 재량📙` 장착 유저는 wrong-turn 오입력 탈락을 영지전당 1회 무효 처리한다
- After a successful or blocked attack resolution, the next turn message is sent and a fresh turn timer starts

---

# /길드정보

Status: VERIFIED

## Command Anchors

- `main.js:27052`
- Alias: `ㅗㅗㅗ`

## Files

- `main.js`

## Related Helpers

- `getMyGuildId`
- `ensureGuildTerritoryWar`
- `getGuildTerritoryList`

## Data Usage

- `data.member[sender]`
- `guildData.guilds[myGid]`
- `guildData`
- guild territory war state inside guild data structures

## Save Flow

- Normal success path is read-only
- Nearby recovery paths may call `saveJsonFile(guildData, guildPath)` and `saveJsonFile(data, filePath)` when guild/member mismatch is corrected

## Related Commands

- `/길드목록`
- `/길드생성`
- `/길드상세정보`
- `/길드순위`
- `/길드상점`
- `/소드마스터`

## AI Notes

- Best entry point for current user's guild ownership and membership flow
- If a bug mentions guild mismatch auto-repair, inspect nearby warning branches with `길드 데이터 불일치`
- Territory-related display here depends on `ensureGuildTerritoryWar`

---

# /내정보

Status: VERIFIED

## Command Anchors

- `Info.js:330`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `getTitle`
- local branch helper `hasValidPet`

## Data Usage

- `data.member[sender]`
- `petData[sender]`
- `titleData.member[sender]`
- `homeData[sender]`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/정보 [닉네임]`
- `/펫정보`
- `/타이틀목록`

## AI Notes

- Main self-profile summary command in `Info.js`
- Good navigation anchor when debugging user-visible summary formatting
- Loads sweet-home data even though command is primarily informational

---

# /정보 [닉네임]

Status: VERIFIED

## Command Anchors

- `Info.js:175`
- Admin or master only

## Files

- `Info.js`

## Related Helpers

- `getTitle`
- `generateBagOutput`
- `isAdmin`
- `isMaster`

## Data Usage

- `data.member[targetUser]`
- `titleData.member[targetUser]`
- `data.member[targetUser].bag`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/펫정보`

## AI Notes

- Admin inspection path for another user's summary
- Useful when debugging user-specific bag/title visibility without impersonating sender

---

# /펫정보

Status: VERIFIED

## Command Anchors

- `Info.js:907`
- Alias: `ㅁㅁㅁ`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `getHomeTotalExp`
- `getCritChance`
- `calculateRaidExp`
- `calculateCastleExp`
- `calculateTotalExp`
- `getMemberRank`
- `getTitle`
- `initPetSkillUser`
- `getPetSkillSlotCount`
- `getIntimacyLvFromBag`
- `getIntimacyUserRank`
- `getUserIntimacyInfo`

## Data Usage

- `petData[sender]`
- `data.member[sender]`
- `homeData[sender]`
- `petExploreData`
- `trialTower.user[sender]`
- `castleBattleData`
- `petTitleData.member[sender]`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/종합순위`
- `/시련의탑`
- `/펫상태`
- `/미니펫통계`

## AI Notes

- High-value aggregation command for pet, mini-pet, home, tower, castle, intimacy, and skill state
- Best anchor for bugs involving displayed total charm or mismatch between ranking and profile output
- `calculateTotalExp` here is the canonical clue for rank formula investigations
- Pet skill slot display should stay aligned with `/펫스킬`, including `펫스킬 학개론` bonus slots
- `창조림📙` bonus should appear only while a `창조` grade mini-pet remains equipped

---

# /길드목록

Status: VERIFIED

## Command Anchors

- `main.js:26970`

## Files

- `main.js`

## Related Helpers

- `getJoinableGuildRows`

## Data Usage

- `guildData.guilds`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드생성`
- `/길드정보`
- `/길드가입`
- `/길드상점`

## AI Notes

- Entry point for joinable guild listing
- Uses the same filtered guild row set as guild join flow
- `징집명령📙`을 장착한 길드마스터의 길드는 최대 인원이 `+1` 보정된 값으로 노출된다

---

# /길드상세정보 [길드명]

Status: VERIFIED

## Command Anchors

- `main.js:28154`

## Files

- `main.js`

## Related Helpers

- `findGuildIdByNameSafe`

## Data Usage

- `guildData.guilds`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드정보`
- `/길드목록`

## AI Notes

- Admin/master investigation command for named guild lookup
- Good anchor when debugging guild member snapshots without relying on sender membership

---

# /길드상점

Status: VERIFIED

## Command Anchors

- `main.js:28567`

## Files

- `main.js`

## Related Helpers

- `ensureGuildShop`
- `numberWithCommas`

## Data Usage

- `guildData.shop`
- `data.HoiCastle.taxRate`

## Save Flow

- Read-only in the confirmed view branch

## Related Commands

- `/길드상점구매`
- `/길드상점추가`
- `/길드상점삭제`
- `/길드가입`

## AI Notes

- Canonical shop display for guild-only consumables and permissions items
- Nearby purchase branch mutates both guild and member state

---

# /길드순위

Status: VERIFIED

## Command Anchors

- `main.js:28808`

## Files

- `main.js`

## Related Helpers

- `buildGuildRankingRows`

## Data Usage

- `guildData.guilds`
- `data.member`
- `petData`
- `homeData`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/길드정보`
- `/길드목록`

## AI Notes

- Guild ranking aggregation depends on cross-file charm calculation inputs
- Open `buildGuildRankingRows` first when ranking output looks wrong

---

# /길드게시판

Status: VERIFIED

## Command Anchors

- `main.js:29330`
- Alias: `/길메`

## Files

- `main.js`

## Related Helpers

- `getMyGuildInfo`
- `ensureGuildBoard`

## Data Usage

- current sender guild object inside `guildData.guilds`
- guild board state on guild object

## Save Flow

- View branch is read-only
- Nearby write branches call `saveJsonFile(guildData, guildPath)`

## Related Commands

- `/길드게시판 내용`
- `/길드게시판공지`
- `/길드게시판초기화`

## AI Notes

- Use this as the main board structure anchor
- Posting and notice behavior is implemented in nearby branches

---

# /당근게시판

Status: VERIFIED

## Command Anchors

- `main.js:2788`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `carrotBoardPath`
- `carrotBoard.memo`

## Save Flow

- View branch is read-only
- Nearby board creation and cleanup branches save to `carrotBoardPath`

## Related Commands

- `/당근`
- `/당근완료`
- `/당근게시판삭제`

## AI Notes

- Canonical public market board display
- Good anchor for carrot-board schema and output order

---

# /가구정보 [닉네임]

Status: VERIFIED

## Command Anchors

- `main.js:25867`

## Files

- `main.js`

## Related Helpers

- `initSweetHomeUser`
- `sortFurnitureList`
- `checkRank`

## Data Usage

- `homeData[targetUser].furnitureBag`
- `homeData[targetUser].placedFurniture`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/가구가방`
- `/가구순위`

## AI Notes

- Admin/master inspection path for another user's furniture state
- Best anchor when home data exists but output for a target user looks wrong

---

# /가구순위

Status: VERIFIED

## Command Anchors

- `main.js:26046`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `homeData[*].placedFurniture`
- `data.member`
- `petData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/가구가방`
- `/가구정보`

## AI Notes

- Ranking is based on placed furniture items, not bag contents
- This branch reloads member and pet data locally before formatting names

---

# /가구가방정리 [기준매력]

Status: VERIFIED

## Command Anchors

- `main.js:26212`

## Files

- `main.js`

## Related Helpers

- `initSweetHomeUser`
- `checkRank`

## Data Usage

- `homeData[sender].furnitureBag`
- `data.member[sender].point`

## Save Flow

- Mutates `homeData`
- Mutates member point state
- Saves `homeData` and member data in branch

## Related Commands

- `/가구가방`
- `/가구전체정리`

## AI Notes

- Threshold-based bulk cleanup command for low-exp furniture
- Check reward point formula in this branch before changing cleanup balance

---

# /미니펫정보 [닉네임]

Status: VERIFIED

## Command Anchors

- `main.js:24828`

## Files

- `main.js`

## Related Helpers

- `buildMiniPetBagMessage`
- `isAdmin`
- `isMaster`

## Data Usage

- `petData[targetName]`

## Save Flow

- Calls `saveJsonFile(petData, memberPetPath)` after message build

## Related Commands

- `/미니펫가방`

## AI Notes

- Admin/master-only mirror of mini-pet bag view for another user
- Reuses the same renderer as `/미니펫가방`

---

# /미니펫가방정리 [기준매력]

Status: VERIFIED

## Command Anchors

- `main.js:24909`

## Files

- `main.js`

## Related Helpers

- `checkRank`

## Data Usage

- `petData[sender].miniPetBag`
- `data.member[sender].point`

## Save Flow

- Mutates mini-pet bag
- Mutates member point state
- Saves `petData` and member data in branch

## Related Commands

- `/미니펫가방`
- `/미니펫판매`

## AI Notes

- Threshold-based mini-pet cleanup and sale command
- Inspect this branch first for reports about unexpected bulk removals

---

# /시련의탑

Status: VERIFIED

## Command Anchors

- `main.js:24113`

## Files

- `main.js`

## Related Helpers

- `calculateTotalExp`
- trial tower reward and floor helpers in nearby branch logic

## Data Usage

- `data.member[sender].towerCnt`
- `trialTower.user[sender]`
- `homeData[sender]`
- `petData[sender]`

## Save Flow

- Mutates tower progress and member state
- Saves `trialTower`, member data, and sometimes pet data in branch

## Related Commands

- `/시련의탑순위`
- `/시련의탑시즌시작`
- `/시련의탑시즌종료`

## AI Notes

- High-impact progression branch with daily entry count and reward logic
- Best anchor for tower floor, entry limit, and reward regression investigations

---

# /펫스킬가방

Status: VERIFIED

## Command Anchors

- `main.js:2049`

## Files

- `main.js`

## Related Helpers

- `formatSkillBagMessage`

## Data Usage

- `petSkillData[user]`

## Save Flow

- Calls `saveJsonFile(petSkillData, petSkillDataPath)`

## Related Commands

- `/펫스킬`
- `/펫스킬정보`
- `/펫스킬장착`

## AI Notes

- Canonical full skill inventory display
- Best entry point for total skill count and bag listing format
- Top guide lines should point skill lookup to `/펫스킬정보 [스킬이름]`

---

# /펫스킬

Status: VERIFIED

## Command Anchors

- `main.js:2068`

## Files

- `main.js`

## Related Helpers

- `formatPetSkillStatusMessage`

## Data Usage

- equipped and bag skill state inside `petSkillData[user]`

## Save Flow

- Calls `saveJsonFile(petSkillData, petSkillDataPath)`

## Related Commands

- `/펫스킬가방`
- `/펫스킬장착`
- `/펫스킬해제`

## AI Notes

- Summary view for equipped and available skills
- Use this when the user report is about equip slots rather than whole bag totals

---

# /펫스킬정보 [스킬명|닉네임]

Status: VERIFIED

## Command Anchors

- `main.js:2092`

## Files

- `main.js`

## Related Helpers

- `formatSkillBagMessage`
- `getPetSkillData`
- `normalizePetSkillName`

## Data Usage

- `petSkillData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫스킬가방`
- `/스킬정보 [닉네임]`

## AI Notes

- Dual-purpose lookup: skill effect lookup or admin user-bag lookup
- Check role gating when another user's skill bag is unexpectedly visible

---

# /종합순위

Status: VERIFIED

## Command Anchors

- `Info.js:793`
- Alias: `ㅈㅈㅈ`

## Files

- `Info.js`

## Related Helpers

- `initSweetHomeUser`
- `generateRanking`

## Data Usage

- `data.member`
- `petData`
- `homeData`
- `petSkillData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/티어순위`

## AI Notes

- Top-level overall ranking view
- Ranking formula is conceptually tied to `/펫정보` total charm output

---

# /티어순위

Status: VERIFIED

## Command Anchors

- `Info.js:802`

## Files

- `Info.js`

## Related Helpers

- `getRankEmoji`

## Data Usage

- `data.member[*].bag["티어 승급티켓🎟"]`
- `data.member[*].bag["고급 티어 승급티켓🎫"]`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/티어확인`

## AI Notes

- Ranking is based on bag ticket totals, not current displayed rank tier

---

# /펫상태

Status: VERIFIED

## Command Anchors

- `Info.js:888`

## Files

- `Info.js`

## Related Helpers

- direct pet image selection logic in branch

## Data Usage

- `petData[sender].petimg`
- `petData[sender].newimg`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`

## AI Notes

- Minimal image/status output command
- Useful for debugging image field precedence between `newimg` and `petimg`

---

# /미니펫통계

Status: VERIFIED

## Command Anchors

- `Info.js:897`

## Files

- `Info.js`

## Related Helpers

- `getMiniPetGradeStats`

## Data Usage

- `petData`
- `miniPetData.gradeTable`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/미니펫가방`

## AI Notes

- Aggregated ownership statistics by mini-pet grade
- Best anchor for grade-table mismatch issues

---

# /시련의탑순위

Status: VERIFIED

## Command Anchors

- `Info.js:1113`

## Files

- `Info.js`

## Related Helpers

- `trialTowerRanking`

## Data Usage

- `trialTower.user`
- `data.member`
- `petData`
- `guildData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/시련의탑`

## AI Notes

- Ranking companion to the main tower progression command
- Open `trialTowerRanking` first when sorting or display order is incorrect

---

# /길드가입조건 [숫자]
Status: VERIFIED
## Command Anchors
- `main.js:27152`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- current sender guild join-condition fields in `guildData.guilds`
## Save Flow
- Mutates guild join-condition state and saves `guildData`
## Related Commands
- `/길드정보`
- `/길드목록`

---

# /길드가입 [번호]
Status: VERIFIED
## Command Anchors
- `main.js:27201`
## Files
- `main.js`
## Related Helpers
- `getJoinableGuildRows`
- `hasItem`
## Data Usage
- `guildData.guilds`
- `data.member[sender]`
- `userState[sender].guildJoin`
## Save Flow
- Starts staged join flow; persistence happens on confirmation branch
## Related Commands
- `/길드목록`
- `/가입한다`
- `/안한다`

## AI Notes
- 길드 정원 판정은 저장된 `g.maxMember`에 `징집명령📙` 길드마스터 보정 `+1`을 더한 기준을 사용한다

---

# /가입한다
Status: VERIFIED
## Command Anchors
- `main.js:27311`
## Files
- `main.js`
## Related Helpers
- `getMyGuildId`
- `hasItem`
## Data Usage
- `userState[sender].guildJoin`
- `guildData.guilds[guildId]`
- `data.member[sender].guild`
## Save Flow
- Finalizes join and saves both member data and `guildData`
## Related Commands
- `/길드가입`
- `/안한다`

---

# /안한다
Status: VERIFIED
## Command Anchors
- `main.js:27419`
## Files
- `main.js`
## Related Helpers
- user-state cancellation only
## Data Usage
- `userState[sender].guildJoin`
## Save Flow
- No file save; clears staged join state only
## Related Commands
- `/길드가입`
- `/가입한다`

---

# /길드탈퇴
Status: VERIFIED
## Command Anchors
- `main.js:27426`
## Files
- `main.js`
## Related Helpers
- `getMyGuildId`
- `hasItem`
## Data Usage
- `data.member[sender].guild`
- `guildData.guilds[myGid].members`
## Save Flow
- Mutates member and guild membership state and saves both stores
## Related Commands
- `/길드정보`
- `/길드상점`

---

# /길드인원마감
Status: VERIFIED
## Command Anchors
- `main.js:27777`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- `guildData.guilds[*].memberClose`
## Save Flow
- Mutates guild recruitment flag and saves `guildData`
## Related Commands
- `/길드인원마감해제`
- `/길드목록`

---

# /길드인원마감해제
Status: VERIFIED
## Command Anchors
- `main.js:27815`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
## Data Usage
- `guildData.guilds[*].memberClose`
## Save Flow
- Mutates guild recruitment flag and saves `guildData`
## Related Commands
- `/길드인원마감`
- `/길드목록`

---

# /길드마크변경 [이모지]
Status: VERIFIED
## Command Anchors
- `main.js:27854`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
- `hasItem`
## Data Usage
- `guildData.guilds[*].mark`
- `data.member[sender].bag`
## Save Flow
- Consumes ticket, mutates guild mark, saves member data and `guildData`
## Related Commands
- `/길드정보`
- `/길드상점`

---

# /길드분배
Status: VERIFIED
## Command Anchors
- `main.js:28229`
## Files
- `main.js`
## Related Helpers
- `syncMemberGuild`
- `getMyGuildInfo`
- `ensureGuildWarehouseObj`
- `getGuildMemberNames`
## Data Usage
- guild warehouse/fund state
- member point/item state
## Save Flow
- Saves member data during sync and saves both member data and `guildData` on distribution
## Related Commands
- `/길드창고패키지오픈`
- `/길드정보`

---

# /길드전체초기화
Status: VERIFIED
## Command Anchors
- `main.js:28553`
## Files
- `main.js`
## Related Helpers
- `resetAllGuildData`
## Data Usage
- all guild/member guild linkage state
## Save Flow
- Resets broad guild state and saves both member data and `guildData`
## Related Commands
- `/길드정보`
- `/길드목록`

---

# /길드계급표
Status: VERIFIED
## Command Anchors
- `main.js:28875`
## Files
- `main.js`
## Related Helpers
- `getGuildMasterRankTitle`
## Data Usage
- static guild rank-title mapping
## Save Flow
- Read-only
## Related Commands
- `/길드순위`

---

# /길드fund삭제
Status: VERIFIED
## Command Anchors
- `main.js:28961`
## Files
- `main.js`
## Related Helpers
- admin/master-only cleanup path
## Data Usage
- guild fund/warehouse related fields in `guildData`
## Save Flow
- Mutates guild fund state and saves `guildData`
## Related Commands
- `/길드정보`
- `/길드분배`

---

# /길드창고패키지오픈 [개수]
Status: VERIFIED
## Command Anchors
- `main.js:29109`
## Files
- `main.js`
## Related Helpers
- `getMyGuildInfo`
- `ensureGuildWarehouseObj`
- `hasItem`
## Data Usage
- `guildData.guilds[*].warehouse`
- `data.member[sender].bag`
## Save Flow
- Consumes package item, mutates guild warehouse, saves member data and `guildData`
## Related Commands
- `/길드분배`
- `/길드정보`

---

# /당근 [받을유저닉] [가방번호] [수량]
Status: VERIFIED
## Command Anchors
- `main.js:2874`
## Files
- `main.js`
## Related Helpers
- `generateBagOutput`
- `isTradableItem`
## Data Usage
- `data.member[sender].bag`
- `data.member[receiver].bag`
## Save Flow
- Trades bag items between users and saves member data
## Related Commands
- `/당근게시판`
- `/당근완료`

---

# /당근완료
Status: VERIFIED
## Command Anchors
- `main.js:2860`
## Files
- `main.js`
## Related Helpers
- carrot-board user filter in branch
## Data Usage
- `carrotBoard.memo`
## Save Flow
- Removes sender post and saves `carrotBoardPath`
## Related Commands
- `/당근게시판`
- `/당근`

---

# /당근게시판삭제
Status: VERIFIED
## Command Anchors
- `main.js:2850`
## Files
- `main.js`
## Related Helpers
- admin-only board reset
## Data Usage
- `carrotBoard.memo`
## Save Flow
- Resets board and saves `carrotBoardPath`
## Related Commands
- `/당근게시판`

---

# /편지 [내용]
Status: VERIFIED
## Command Anchors
- `main.js:22620`
## Files
- `main.js`
## Related Helpers
- `hasLetterInBag`
- `useLetterInBag`
- `hasPetSkill`
## Data Usage
- `board.memo`
- sender bag stamp item state
## Save Flow
- Mutates board entries and sender bag state; saves board and member data in branch
## Related Commands
- `/편지삭제`

---

# /편지삭제
Status: VERIFIED
## Command Anchors
- `main.js:3572`
## Files
- `main.js`
## Related Helpers
- master-only board reset
## Data Usage
- `board.memo`
## Save Flow
- Clears board and saves `boardPath`
## Related Commands
- `/편지`

---

# /돌가방
Status: VERIFIED
## Command Anchors
- `main.js:21589`
## Files
- `main.js`
## Related Helpers
- `checkRank`
## Data Usage
- `data.member[sender].bag[STONE_NAME]`
## Save Flow
- Read-only
## Related Commands
- `/가방`

---

# /가방속성 [유저명] [아이템번호] [갯수]
Status: VERIFIED
## Command Anchors
- `main.js:4603`
## Files
- `main.js`
## Related Helpers
- `generateBagOutput`
- `checkRank`
## Data Usage
- `data.member[targetUser].bag`
## Save Flow
- Mutates target bag item counts; surrounding persistence should be checked in local save cycle
## Related Commands
- `/가방`
- `/가방추가`

---

# /가방추가 [유저명], [아이템명] [갯수]
Status: VERIFIED
## Command Anchors
- `main.js:4633`
## Files
- `main.js`
## Related Helpers
- `checkRank`
## Data Usage
- `data.member[targetUser].bag[itemName]`
## Save Flow
- Mutates target bag state; surrounding persistence should be checked in local save cycle
## Related Commands
- `/가방속성`

---

# /펫스킬가방추가 [유저], [스킬명] [개수]
Status: VERIFIED
## Command Anchors
- `main.js:1762`
## Files
- `main.js`
## Related Helpers
- `normalizePetSkillName`
- `getPetSkillData`
- `getPetSkillBagRemainCount`
- `addPetSkillToBag`
## Data Usage
- `petSkillData[user].bag`
## Save Flow
- Mutates target skill bag and saves `petSkillData`
## Related Commands
- `/펫스킬가방`
- `/펫스킬일괄지급`

---

# /펫스킬일괄지급
Status: VERIFIED
## Command Anchors
- `main.js:1818`
## Files
- `main.js`
## Related Helpers
- `normalizePetSkillName`
- `getPetSkillData`
- `addPetSkillToBag`
## Data Usage
- multi-user `petSkillData[*].bag`
## Save Flow
- Bulk mutates skill bags and saves `petSkillData`
## Related Commands
- `/펫스킬가방추가`

---

# /펫스킬전체판매
Status: VERIFIED
## Command Anchors
- `main.js:1921`
## Files
- `main.js`
## Related Helpers
- `initPetSkillUser`
- `getPetSkillBagList`
- `getPetSkillBagTotalCount`
- `formatPetSkillName`
## Data Usage
- `petSkillData[sender].bag`
- `data.member[sender].point`
## Save Flow
- Empties skill bag, adds points, saves member data and `petSkillData`
## Related Commands
- `/펫스킬판매`
- `/펫스킬가방`

---

# /펫스킬판매 [번호] [개수]
Status: VERIFIED
## Command Anchors
- `main.js:1961`
## Files
- `main.js`
## Related Helpers
- `initPetSkillUser`
- `getPetSkillBagList`
- `removePetSkillFromBag`
## Data Usage
- `petSkillData[sender].bag`
- `data.member[sender].point`
## Save Flow
- Removes selected skill count, adds points, saves member data and `petSkillData`
## Related Commands
- `/펫스킬전체판매`

---

# /펫스킬확률
Status: VERIFIED
## Command Anchors
- `main.js:2074`
## Files
- `main.js`
## Related Helpers
- `getPetSkillActualRate`
- `formatPetSkillName`
## Data Usage
- `PET_SKILL_LIST`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬오픈`
- `/펫스킬정보`

---

# /펫스킬중복
Status: VERIFIED
## Command Anchors
- `main.js:2118`
## Files
- `main.js`
## Related Helpers
- `formatPetSkillName`
## Data Usage
- `PET_SKILL_COMPAT_GROUPS`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬장착`

---

# /펫스킬오픈 [개수]
Status: VERIFIED
## Command Anchors
- `main.js:2128`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagRemainCount`
- `getPetSkillBagTotalCount`
- `addPetSkillToBag`
## Data Usage
- skill-book item in `data.member[sender].bag`
- `petSkillData[sender].bag`
## Save Flow
- Consumes books, grants skills, saves member data and `petSkillData`
## Related Commands
- `/펫스킬확률`
- `/펫스킬가방`

---

# /펫스킬장착 [번호]
Status: VERIFIED
## Command Anchors
- `main.js:2205`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagList`
- `getPetSkillSlotCount`
- `initPetSkillUser`
- `hasPetSkill`
- `removePetSkillFromBag`
## Data Usage
- `petSkillData[sender].bag`
- `petSkillData[sender].equipped`
## Save Flow
- Moves skill from bag to equipped and saves `petSkillData`
## Related Commands
- `/펫스킬`
- `/펫스킬가방`
## AI Notes
- `전투형 지휘관📙`, `기사단 증원📙`, `징집명령📙`은 장착 시점에 길드마스터 여부를 검사하는 전용 스킬이다
- `야호📙`은 `/알림`에서 하루 3회까지 확성기 아이템 소모 없이 무료 사용을 허용한다
- `창조림📙`은 장착된 미니펫의 등급이 `창조`일 때만 레이드/캐슬 매력 보너스를 계산식으로 적용한다

---

# /펫스킬당근 [닉] [번호] [개수]
Status: VERIFIED
## Command Anchors
- `main.js:2282`
## Files
- `main.js`
## Related Helpers
- `getPetSkillBagList`
- `initPetSkillUser`
- `getPetSkillBagRemainCount`
- `addPetSkillToBag`
- `removePetSkillFromBag`
## Data Usage
- sender/receiver `petSkillData[*].bag`
## Save Flow
- Moves skills between users and saves `petSkillData`
## Related Commands
- `/펫스킬가방`
- `/당근`

---

# /미니펫장착 [번호]
Status: VERIFIED
## Command Anchors
- `main.js:24639`
## Files
- `main.js`
## Related Helpers
- `refreshMiniPetSortIndex`
- `formatPetInfo`
- `setMiniPetEquipState`
## Data Usage
- `petData[sender].miniPetBag`
- `petData[sender].miniPet`
- `userState[sender].miniPet`
## Save Flow
- Starts confirmation flow; final persistence happens on confirmation branch
## Related Commands
- `/귀속해제`
- `/미니펫가방`

---

# /미니펫조합태초+|창세|창조
Status: VERIFIED
## Command Anchors
- `main.js:24716`
## Files
- `main.js`
## Related Helpers
- `getMiniPetCombinationConfig`
- `refreshMiniPetSortIndex`
## Data Usage
- `petData[sender].miniPetBag`
- `miniPetData.gradeTable`
## Save Flow
- Consumes source mini-pets, creates result mini-pet, saves `petData`
## Related Commands
- `/미니펫가방`

---

# /미니펫전체정리
Status: VERIFIED
## Command Anchors
- `main.js:24857`
## Files
- `main.js`
## Related Helpers
- `refreshMiniPetSortIndex`
- `checkRank`
## Data Usage
- all users `petData[*].miniPetBag`
## Save Flow
- Admin bulk cleanup mutates many mini-pet bags and saves `petData`
## Related Commands
- `/미니펫가방정리`

---

# /미니펫판매 [번호]
Status: VERIFIED
## Command Anchors
- `main.js:25020`
## Files
- `main.js`
## Related Helpers
- `checkRank`
## Data Usage
- `petData[sender].miniPetBag`
- `data.member[sender].point`
## Save Flow
- Removes selected mini-pet, adds points, saves member data and `petData`
## Related Commands
- `/미니펫가방`
- `/미니펫가방정리`

---

# /귀속해제
Status: VERIFIED
## Command Anchors
- `main.js:25060`
## Files
- `main.js`
## Related Helpers
- `hasItem`
- `removeItem`
## Data Usage
- `petData[sender].miniPet`
- `petData[sender].miniPetBag`
- sender bag unbind-ticket item
## Save Flow
- Mutates mini-pet equipped/bag state and member bag state; re-check surrounding persistence when editing
## Related Commands
- `/미니펫장착`
- `/미니펫가방`

---

# /컬렉션등록 [번호...]
Status: VERIFIED
## Command Anchors
- `main.js:29672`
## Files
- `main.js`
## Related Helpers
- `sanitizeMiniPetCollectionData`
- collection registration helpers in nearby branch
## Data Usage
- `petData[sender].miniPetBag`
- `miniPetCollectionData.member[sender]`
- `miniPetTitleData`
## Save Flow
- Registers selected mini-pets, mutates collection/title/member/pet data, saves all touched stores
## Related Commands
- `/미니펫컬렉션`
- `/미니펫컬렉션순위`

---

# /미니펫컬렉션
Status: VERIFIED
## Command Anchors
- `main.js:30039`
## Files
- `main.js`
## Related Helpers
- `sanitizeMiniPetCollectionData`
- `ensureMiniPetCollection`
## Data Usage
- `miniPetCollectionData.member[sender]`
- `miniPetCollectionInfo.stageReward`
## Save Flow
- Primarily read-only; may sanitize then save collection data
## Related Commands
- `/컬렉션등록`
- `/미니펫컬렉션순위`

---

# /미니펫컬렉션순위
Status: VERIFIED
## Command Anchors
- `main.js:30085`
## Files
- `main.js`

## Related Helpers
- `sanitizeMiniPetCollectionData`
- `buildMiniPetCollectionRankingMessage`
## Data Usage
- `miniPetCollectionData.member`
## Save Flow
- Primarily read-only; may sanitize then save collection data
## Related Commands
- `/미니펫컬렉션`

---

# /자랑
Status: VERIFIED
## Command Anchors
- `main.js:30099`
## Files
- `main.js`
## Related Helpers
- `hasPetSkill`
- `checkRank`
## Data Usage
- equipped pet-skill state for `롤렉스`
## Save Flow
- Read-only
## Related Commands
- `/펫스킬`

---

# /포인트
Status: VERIFIED
## Command Anchors
- `Info.js:300`
- Alias: `ㅍㅍㅍ`
## Files
- `Info.js`
## Related Helpers
- `checkRank`
- `numberWithCommas`
## Data Usage
- `data.member[sender].point`
## Save Flow
- Read-only
## Related Commands
- `/레벨`
- `/포인트확인`

---

# /구매 [번호] [개수]

Status: VERIFIED

## Command Anchors

- `main.js:22030`

## Files

- `main.js`

## Related Helpers

- `hasPetSkill`
- `buildPetSkillTriggerMessage`
- `buildPointShopBuyMessage`
- `applyTax`

## Data Usage

- `data.shop`
- `data.HoiCastle.taxRate`
- `data.member[sender].point`
- `data.member[sender].bag`
- `petSkillData`

## Save Flow

- Deducts point-shop cost from member points
- Applies castle tax earnings through `applyTax(itemPrice, data, guildData)` when tax is not exempt
- Saves updated member/pet/guild state through the surrounding response flow

## Related Commands

- `/상점`
- `/길드상점`
- `/길드상점구매`

## AI Notes

- `쇼핑광📙` discount applies before tax calculation
- `탈세자📙` sets point-shop tax to 0 for `/구매` only, and does not affect `/길드상점구매`
- `티어 상승론📙` adds `floor(quantity * 0.01)` bonus only when `/구매` item is `티어 승급티켓🎟`

---

# Registry Expansion Queue

Status: PARTIAL

## Recommended Next Commands To Verify

- `/레벨`
- `/타이틀목록`
- `/펫타이틀목록`
- `/출석목록`
- `/상점`
- `/누좋순위`
- `/누렙순위`
- `/영주수익순위`
- `/정령순위`
- `/반지순위`
- `/티어확인`
- `/가구통계`
- `/서버통계`
- `/캐슬전적`
- `/캐슬대전순위`
- `/펫매력순위`
- `/캐슬매력순위`
- `/레이드매력순위`

## Known Gaps

- Most mutation-heavy commands are not indexed yet
- Admin-only maintenance commands are not indexed yet
- Save-flow cross-file interactions are only documented for representative commands
