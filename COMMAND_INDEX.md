# COMMAND_INDEX.md

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
- `COMMAND_REGISTRY.md` is the human-facing command checklist. This file is the AI-friendly code navigation index.

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

- `filePath`: member data, runtime path `/sdcard/호이랜드/member.json`, repo snapshot `data/member.json`
- `memberPetPath`: pet and mini-pet data, runtime path `/sdcard/호이랜드/member_pet.json`, repo snapshot `data/member_pet.json`
- `guildPath`: guild data, runtime path `/sdcard/호이랜드/guildData.json`, repo snapshot `data/guildData.json`
- `homeDataFile`: sweet-home data, runtime path `/sdcard/호이랜드/petSweetHomeData.json`, repo snapshot `data/petSweetHomeData.json`
- `petSkillDataPath`: pet skill data, runtime path `/sdcard/호이랜드/petSkillData.json`, repo snapshot `data/petSkillData.json`
- `trialTowerPath`: trial tower data, runtime path `/sdcard/호이랜드/trialTower.json`, repo snapshot `data/trialTower.json`
- `castleBattlePath`: castle battle data, runtime path `/sdcard/호이랜드/castleBattle2.json`, repo snapshot `data/castleBattle.json`
- `petTitlePath`: pet title data, runtime path `/sdcard/호이랜드/pet_title.json`, repo snapshot `data/pet_title.json`
- `memberTitlePath`: member title data, runtime path `/sdcard/호이랜드/member_title.json`, repo snapshot `data/member_title.json`
- `boardPath`: public letter board, runtime path `/sdcard/호이랜드/board.json`, repo snapshot `data/board.json`
- `carrotBoardPath`: carrot market board, runtime path `/sdcard/호이랜드/carrotBoard.json`, repo snapshot `data/carrotBoard.json`
- `freeMarketPath`: free-market listing/log data, runtime path `/sdcard/호이랜드/freeMarket.json`, repo snapshot `data/freeMarket.json`
- `hoiBotChangeLogPath`: bot change-log data, runtime path `/sdcard/호이랜드/hoiBotChangeLog.json`, repo snapshot `data/hoiBotChangeLog.json`
- `miniPetCollectionPath`: mini-pet collection data, runtime path `/sdcard/호이랜드/miniPet_collection.json`, repo snapshot `data/miniPet_collection.json`

## Runtime / Save-Flow Hotspots

- `main.js:1328`: main `response(...)` entry point for almost all mutable gameplay commands
- `Info.js:115`: info/query-oriented `response(...)` entry point
- `main.js:31185`: `loadJsonFile(path)` resolves DEV/PROD path via `resolveActiveDataPath(path)` and parses UTF-8 JSON through `parseJsonContent(...)`
- `main.js:31209`: `saveJsonFile(data, path)` resolves DEV/PROD path, ensures parent folders, and writes UTF-8 JSON
- `Info.js:1383`: separate `loadJsonFile(path)` implementation used by info commands
- `main.js:1029-1059`: production/DEV root constants and major runtime data-file constants

## DEV / PROD Path Rules

- `main.js` creates a command context with `createCommandContext(isDevCommandMessage(msg))` near the top of `response(...)`
- DEV-prefixed messages are normalized through `stripDevCommandPrefix(msg)` before regular command branching continues
- Both `loadJsonFile(...)` and `saveJsonFile(...)` pass through `resolveActiveDataPath(...)`, so save-flow verification should check path resolution rather than only literal file constants
- `dev/데이터백업` is gated early in the main response flow and is the canonical bootstrap path when DEV files are missing
- If a command looks read-only but still writes, inspect whether it sanitizes or normalizes data before display

## Core Helper Hotspots

| Helper | Anchor | Why it matters |
| --- | --- | --- |
| `generateBagOutput` | `main.js:35217`, `Info.js:2330` | Canonical bag numbering and text renderer |
| `initSweetHomeUser` | `main.js:37569`, `Info.js:2999` | Normalizes home/sweet-home user state before access |
| `getHomeTotalExp` | `main.js:37749`, `Info.js:2948` | Home ranking and profile summary calculation |
| `buildMiniPetBagMessage` | `main.js:40722` | Main mini-pet bag formatter and viewer/target split |
| `initPetSkillUser` | `main.js:36606`, `Info.js:2000` | Normalizes pet-skill storage before use |
| `getPetSkillSlotCount` | `main.js:36730`, `Info.js:2031` | Slot-count source for pet-skill display/equip rules |
| `calculateTotalExp` | `main.js:38263`, `Info.js:3104` | High-value aggregate formula for user progression/rank output |
| `getMyGuildId` | `main.js:39821`, `Info.js:3342` | Fastest guild membership lookup anchor |
| `getMyGuildInfo` | `main.js:39943`, `Info.js:3347` | Guild object + sender membership validation hub |
| `getJoinableGuildRows` | `main.js:39834` | Joinable guild filtering and listing logic |
| `findGuildIdByNameSafe` | `main.js:39879` | Safer guild-name-to-id resolution |
| `ensureGuildWarehouseObj` | `main.js:31244` | Warehouse/fund branches should usually pass here first |
| `ensureGuildTerritoryWar` | `main.js:31259` | Canonical territory-war state normalizer |
| `ensureGuildBoard` | `main.js:40695` | Guild board schema normalization |
| `buildGuildRankingRows` | `main.js:40353` | Cross-store guild ranking aggregation |
| `syncMemberGuild` | `main.js:40570` | Member/guild mismatch repair path |
| `trialTowerRanking` | `Info.js:1888` | Ranking renderer for tower-related info output |
| `getMiniPetGradeStats` | `Info.js:2865` | Aggregate mini-pet grade statistics |
| `getTitle` | `Info.js:1970` | Member/pet title display helper used by info summaries |

## Command Family Hotspots

| Family | Primary files | Good first anchors |
| --- | --- | --- |
| Inventory / bag / trade | `main.js`, `Info.js` | `/가방`, `generateBagOutput`, `/당근`, `/구매` |
| Guild / territory / warehouse | `main.js`, `Info.js` | `/길드정보`, `/길드목록`, `/길드영지시작`, `ensureGuildTerritoryWar` |
| Mini-pet / collection | `main.js`, `Info.js` | `/미니펫가방`, `buildMiniPetBagMessage`, `/컬렉션등록`, `/미니펫컬렉션` |
| Pet skill | `main.js`, `Info.js` | `/펫스정보`, `initPetSkillUser`, `getPetSkillSlotCount`, `/펫스장착` |
| Sweet home / furniture | `main.js`, `Info.js` | `/가구가방`, `initSweetHomeUser`, `getHomeTotalExp`, `/가구순위` |
| Ranking / profile / info | `Info.js`, `main.js` | `/내정보`, `/정보 [닉네임]`, `/펫정보`, `calculateTotalExp` |
| Board / social / letters | `main.js` | `/게시판`, `/편지`, `boardPath`, `carrotBoardPath` |

## Quick Search Recipes

- Entry-point scan: `rg -n "function response|if \\(msg ==|msg\\.startsWith\\(" main.js Info.js`
- Save-flow scan: `rg -n "saveJsonFile\\(|loadJsonFile\\(" main.js Info.js`
- Guild scan: `rg -n "Guild|guild|영지" main.js Info.js`
- Mini-pet scan: `rg -n "miniPet|미니펫|컬렉션" main.js Info.js`
- Home scan: `rg -n "SweetHome|furniture|가구|homeData" main.js Info.js`
- Pet-skill scan: `rg -n "petSkill|펫스" main.js Info.js`

## Coverage Snapshot

- Current heuristic command-pattern count across `main.js` + `Info.js`: about `1010`
- This registry is strongest on representative high-traffic commands, helper anchors, and save-flow notes
- Mutation-heavy admin tooling still has broader coverage gaps than user-facing info commands
- `COMMAND_REGISTRY.md` is better for human usage/removal checks; this file is better for "where should I inspect first?" decisions

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

- Start flow is staged: `NoticeMsg` two-line prepare notice -> 20s wait -> castle-room order output -> 5s grace -> castle-room start notice -> first turn timer
- Turn order and guild attack limits may include `전투형 지휘관📙`, `기사단 증원📙` 길드마스터 effects at start time
- During the 5-second grace window, `/영지공격` is intentionally blocked by `territoryWar.startReady`
- Cancellation and forced finish should clear both pending-start and opening-grace timers

---

# /영지공격 [숫자]

Status: VERIFIED

## Command Anchors

- `main.js:13004`

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
- `guildData.territoryWar.guildAttackLimits`

## Save Flow

- Clears active turn timer before resolving a valid attack
- Wrong-turn penalty path saves `guildData` after user/guild elimination and attack-count penalty updates
- Saves `guildData` and `data` after attack resolution and turn advance
- Finish path saves `guildData` and `data` through `finishGuildTerritoryWar`

## Related Commands

- `/길드영지시작`
- `/길드영지준비`
- `/길드영지순서`
- `/길드영지종료`

## AI Notes

- Rejects attacks while the war is active but not yet start-ready
- `전투형 지휘관📙` 보유 길드마스터는 영지전에서 소드마스터로 취급되며, 같은 길드 턴에는 현재 차례 유저가 아니어도 같은 길드의 다른 소드마스터 또는 길드마스터가 대신 공격할 수 있다. 해당 스킬 보유 상태로 직접 공격하면 랜덤 발동 멘트가 prepend한다
- `/불안정`, `/안정`, `/균열`, `/대균열`도 `isGuildTerritoryAttacker` 기준을 따라 `전투형 지휘관📙` 길드마스터가 사용할 수 있다
- DEV 컨텍스트에서는 테스트용으로 `dev/강제균열`, `dev/강제대균열` 명령으로 확률 없이 이벤트를 즉시 발생시킬 수 있다
- `🌌균열` 또는 `🌋대균열`이 실제 발생하면 누적 전쟁불안정도는 즉시 0으로 초기화된다
- `기사단 증원📙` 길드마스터가 있으면 소드마스터 슬롯이 1명 추가되며, 공격 결과에 발동 멘트가 prepend된다
- `/소드마스터`에서 4번째 소드마스터가 추가될 때 `기사단 증원📙 [체크랭크] 소드마스터가 길드를 위하여 헌신합니다` 멘트를 추가 출력하며, 체크랭크는 추가된 4번째 인원 기준이다
- Non-final attack results prepend the next attacker's turn line before the result body
- Wrong-turn attacks eliminate the acting user from the current territory-war rotation
- Wrong-turn attacks subtract `GUILD_TERRITORY_WRONG_TURN_PENALTY` turns from the user's guild when remaining turns are at least 5
- Wrong-turn attacks eliminate the whole guild when remaining turns are less than `GUILD_TERRITORY_WRONG_TURN_PENALTY`
- `/영지공격` is accepted only as `/영지공격 [1-5]`; suffix text such as `/영지공격 2 해봐` must not execute
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

# /호이봇버전, /수정내용

Status: VERIFIED

## Command Anchors

- `main.js:3939`

## Files

- `main.js`

## Related Helpers

- `buildHoiBotChangeLogMessage`

## Data Usage

- `hoiBotChangeLogPath`

## Save Flow

- `/수정내용` reads `hoiBotChangeLogPath`
- Read-only; no save

## Related Commands

- `/호이봇버전`
- `/수정내용`

## AI Notes

- `/호이봇버전` replies with `ver_` + `HoiBotVersion`
- `/수정내용` is admin/master-only and shows the manually maintained `data/hoiBotChangeLog.json`
- `HoiBotVersion` should be increased by `0.001` whenever source changes are intentionally reflected

---

# /자동일퀘

Status: VERIFIED

## Command Anchors

- `main.js:14670`

## Files

- `main.js`

## Related Helpers

- `runAutoDailyQuest`
- `runAutoDailyInternalCommand`
- `runAutoDailyQuestCommands`
- `buildAutoDailyQuestMessage`
- `getDailyQuestStatus`
- `claimQuestReward`

## Data Usage

- `data.member[sender].bag["자동일퀘권📝"]`
- `data.member[sender].towerCnt`
- `data.member[sender].battle`
- `petData[sender].miniPetBattle`
- `trialTower.user[sender]`
- `petExploreData.record[sender]`

## Save Flow

- Creates member, pet, and pet-skill backup snapshots before automated mutation
- Silently executes existing `/시련의탑`, `/캐슬대전`, and `/미니펫대전` command paths for remaining daily counts
- Reloads data after automated runs and saves member data when daily/weekly quest reward is claimed

## Related Commands

- `/시련의탑`
- `/캐슬대전`
- `/미니펫대전`
- `/퀘스트`
- `/퀘스트완료`

## AI Notes

- Triggers: `/자동일퀘`, `ㅇㅋㅋ`
- Requires `자동일퀘권📝` in the user bag
- Pet exploration is intentionally excluded; daily quest reward is only claimed when all four daily quest categories are complete
- Internal command execution is excluded from rapid request monitoring and command backup duplication

---

# /일퀘횟수수정

Status: VERIFIED

## Command Anchors

- `main.js:3020`

## Files

- `main.js`

## Related Helpers

- `editDailyQuestCountsForTest`
- `isValidDailyQuestCount`
- `getDailyQuestStatus`

## Data Usage

- `data.member[targetUser].towerCnt`
- `data.member[targetUser].battle.count`
- `data.member[targetUser].battle.ticket`
- `data.member[targetUser].exploreCnt`
- `data.member[targetUser].dailyQuestCnt`
- `petData[targetUser].miniPetBattle.count`

## Save Flow

- Saves `member.json` through `saveJsonFile(data, filePath)`
- Saves `memberPet.json` through `saveJsonFile(petData, memberPetPath)`

## Related Commands

- `/자동일퀘`
- `/퀘스트`
- `/퀘스트완료`
- `/캐슬대전횟수리셋`
- `/미니펫대전횟수`
- `/탐험횟수수정`

## AI Notes

- Master-only test helper for setting daily quest counters in one command
- Usage: `/일퀘횟수수정 유저명 시탑 캐대전 미대전 펫탐험 [일일보상횟수]`
- The outer command guard accepts `/일퀘횟수수정` and spaced arguments, then `editDailyQuestCountsForTest` returns usage/validation errors
- Count values must be 0~10
- Castle `battle.ticket` is normalized to `min(캐대전, 3)` so test state matches free-battle usage

---

# /패키지리스트

Status: VERIFIED

## Command Anchors

- `main.js:14681`

## Files

- `main.js`
- `data/packageInfo.json`
- `data/packageLog.json`

## Related Helpers

- `buildPackageInitResult`
- `getDefaultPackageInfoData`
- `assertPackageLogData`
- `buildPackageListMessage`
- `buildPackageAddGuideMessage`
- `addPackageInfoByCommand`
- `setPackageEnabledByCommand`
- `grantPackageToUser`
- `buildUserPackageBagMessage`
- `usePackageFromBag`

## Data Usage

- `packageInfo.json`
- `packageLog.json`
- `data.member[user].bag`
- `data.member[user].point`

## Save Flow

- `/패키지초기화` loads package data in the command branch, then creates `packageInfo.json` from default package data and empty `packageLog.json` only when missing, empty, or structurally invalid
- `/패키지추가`, `/패키지제거`, `/패키지활성` mutate and save `packageInfo.json`
- `/패키지지급` mutates member bag and saves `member.json`, then appends a `GRANT` log to `packageLog.json`
- `/패키지사용` validates first, then deducts from member bag, applies `item`/`point` rewards, saves `member.json`, and appends a `USE` log to `packageLog.json`

## Related Commands

- `/패키지초기화`
- `/패키지추가방법`
- `/패키지추가시작`
- `/패키지추가취소`
- `/패키지추가상태`
- `/패키지추가`
- `/패키지제거`
- `/패키지활성`
- `/패키지지급`
- `/패키지가방`
- `/패키지사용`

## AI Notes

- `packageInfo.json` is order-sensitive; never delete entries to preserve list numbers
- `/패키지제거` sets `enabled:false`; `/패키지활성` restores `enabled:true`
- 1차 지원 보상 타입은 `item`, `point` only
- Package name is also the bag item name; package data no longer needs a separate `itemName`
- Step flow uses `/패키지추가시작`, then package name, desc, repeated rewards, preview, and `등록`
- Default package data is initialized by `/패키지초기화`; package helpers receive loaded data and do not perform file IO
- `packageInfo.json` load results are not normalized to an empty list; missing or invalid package data should follow the existing load/error flow
- `packageLog.json` is also not auto-created during grant/use; missing or invalid log data should be initialized through `/패키지초기화`
- New package quick command format: `/패키지추가 패키지명 | 설명 | 보상목록`
- Step reward choices: `1/포인트`, `2/아이템`, `3/완료`, `4/취소`
- Reward spec examples: `point:10000000`, `item:펫 강화석⭐:10`

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
- `야호📙`은 `/알림`에서 확성기 아이템 사용 횟수와 합산해 하루 총 3회 한도 안에서만 무료 사용을 허용한다
- `기분탓📙`은 `?` 단일 채팅 입력 시 전체 유저 중 해당 스킬 장착자 전원의 연출 멘트를 출력하며 수치 변화는 없다
- `종의 본능📙`은 `이쁘다` 정확 일치 입력 시 전체 유저 중 해당 스킬 장착자 전원의 연출 멘트를 출력한다
- `품행제로📙`은 `/맞짱 [아이디]` 입력 시 70% 확률로 승리 연출 멘트, 30% 확률로 실패 연출 멘트를 출력하며 실제 승패 수치 변화는 없다
- `망한건 맞아📙`는 장착 시 랜덤 연출 멘트만 출력하며 실제 효과는 없다
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

# /미니펫조합엘리트
Status: VERIFIED
## Command Anchors
- `main.js`
## Files
- `main.js`
## Related Helpers
- `isEliteMiniPetCombinationMaterial`
- `pickEliteMiniPetCombinationReward`
- `createEliteMiniPetFromCombination`
- `removeMiniPetsFromBag`
- `refreshMiniPetSortIndex`
## Data Usage
- `petData[sender].miniPetBag`
- `data.member[sender].point`
## Save Flow
- Failure consumes only 500억 points and saves `filePath`
- Success consumes 500억 points, removes the selected two 창조 300강 mini-pets, adds one 엘리트 mini-pet, saves `filePath` and `memberPetPath`
## Related Commands
- `/미니펫조합엘리트 [미니펫가방번호] [미니펫가방번호]`
- `/미니펫가방`
- `/미니펫강화`
## AI Notes
- `컬렉션창조 미니펫🐹(+1💕)[창조]` is explicitly excluded from elite-combination materials
- Elite reward pool contains 아르케, 카오스, 데미우르고스, 아이온, 로고스
- Existing upgrade cap logic was not changed by this command entry

---

# /관리자명단|관리자추가|관리자삭제|관리자일당|부방상여
Status: VERIFIED
## Command Anchors
- `main.js`
## Files
- `main.js`
## Related Helpers
- `getAdminPayoutUsers`
- `buildAdminListMessage`
## Data Usage
- `data.admin`
- `data.member[*].point`
- `data.member[*].bag["미니펫뽑기🐹(/미니펫오픈)"]`
## Save Flow
- `/관리자추가` and `/관리자삭제` mutate `data.admin` and save `filePath`
- `/관리자일당` reads `data.admin`, gives existing members 3억 points, reports actual paid count, and saves `filePath`
- `/부방상여` reads `data.admin`, gives existing members 미니펫뽑기 1000개, reports actual rewarded count, and saves `filePath`
## Related Commands
- `/관리자명단`
- `/관리자추가`
- `/관리자삭제`
- `/관리자일당`
- `/부방상여`
## AI Notes
- Payout commands no longer keep separate hardcoded recipient arrays
- `/관리자일당` authorization remains `호이 남` and `오픈채팅봇`
- `/부방상여` authorization remains `호이 남`

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

# /타이틀목록

Status: VERIFIED

## Command Anchors

- `Info.js:495`
- `Info.js:519` target-user admin path

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `isAdmin`

## Data Usage

- `titleData.member[sender].title.list`
- `titleData.member[sender].title.num`
- `titleData.member[targetUser].title.list`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/정보 [닉네임]`
- `/펫타이틀목록`

## AI Notes

- Primary member-title inventory viewer
- Admin path can inspect another user's title list without impersonating sender

---

# /펫타이틀목록

Status: VERIFIED

## Command Anchors

- `Info.js:551`
- `Info.js:574` target-user admin path

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `isAdmin`

## Data Usage

- `petTitleData.member[sender].title.list`
- `petTitleData.member[sender].title.num`
- `petTitleData.member[targetUser].title.list`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫상태`
- `/타이틀목록`

## AI Notes

- Pet-title inventory viewer parallel to `/타이틀목록`
- Useful when checking title-equip state mismatches between pet profile output and title storage

---

# /출석목록

Status: VERIFIED

## Command Anchors

- `Info.js:606`

## Files

- `Info.js`

## Related Helpers

- direct branch formatting only

## Data Usage

- `data.attend_list`
- `data.member[user].rank.emoji`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`

## AI Notes

- Simple attendance snapshot output
- Good first anchor when debugging daily attendance ordering or missing users

---

# /상점

Status: VERIFIED

## Command Anchors

- `Info.js:624`

## Files

- `Info.js`

## Related Helpers

- `numberWithCommas`
- `getMyGuildInfo`

## Data Usage

- `data.shop`
- `data.HoiCastle.taxRate`
- `data.HoiCastle.lord`
- `guildData.guilds`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/구매 [번호] [개수]`
- `/길드상점`

## AI Notes

- Canonical read path for point-shop item list and visible tax text
- If shop tax or lord-guild display looks wrong, inspect this branch before `/구매`

---

# /펫강순위

Status: VERIFIED

## Command Anchors

- `Info.js:763`

## Files

- `Info.js`

## Related Helpers

- `generatePetUpgradeRanking`

## Data Usage

- `petData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫매력순위`

## AI Notes

- Ranking output focused on pet upgrade values
- Best first anchor when upgrade-based ordering and displayed ranking diverge

---

# /누좋순위

Status: VERIFIED

## Command Anchors

- `Info.js:768`

## Files

- `Info.js`

## Related Helpers

- `generatelike2Ranking`

## Data Usage

- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/종합순위`

## AI Notes

- Legacy cumulative-like ranking output
- Good quick anchor for total-like counter sorting bugs

---

# /누렙순위

Status: VERIFIED

## Command Anchors

- `Info.js:773`

## Files

- `Info.js`

## Related Helpers

- `generate2Ranking`

## Data Usage

- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/종합순위`

## AI Notes

- Legacy cumulative-level ranking output
- Useful when user total-level ordering looks inconsistent with profile displays

---

# /영주수익순위

Status: VERIFIED

## Command Anchors

- `Info.js:778`

## Files

- `Info.js`

## Related Helpers

- `generateEarningsRanking`

## Data Usage

- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/종합순위`
- `/길드정보`

## AI Notes

- Ranking output for stored lord-earnings totals
- Good first anchor if castle/lord income leaderboard and member summaries disagree

---

# /정령순위

Status: VERIFIED

## Command Anchors

- `Info.js:783`

## Files

- `Info.js`

## Related Helpers

- `generateElementalRanking`

## Data Usage

- `petData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/종합순위`

## AI Notes

- Ranking output for elemental/spirit enhancement state
- Investigate here before checking broader pet-summary commands

---

# /반지순위

Status: VERIFIED

## Command Anchors

- `Info.js:788`

## Files

- `Info.js`

## Related Helpers

- `generateRingRanking`

## Data Usage

- `petData`
- `data.member`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/종합순위`

## AI Notes

- Ring-enhancement leaderboard
- Useful when ring-related contribution in pet/profile output needs isolation

---

# /티어확인

Status: VERIFIED

## Command Anchors

- `Info.js:845`

## Files

- `Info.js`

## Related Helpers

- `ticketTierData`

## Data Usage

- `data.member[*].rank.tier`
- `ticketTierData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/티어순위`
- `/내정보`

## AI Notes

- Bucketed view of current member tier distribution
- Best first anchor when tier assignment looks present in data but wrong in grouped output

---

# /펫매력순위

Status: VERIFIED

## Command Anchors

- `Info.js:1089`

## Files

- `Info.js`

## Related Helpers

- `generatePetRanking`

## Data Usage

- `petData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/펫정보`
- `/펫강순위`
- `/캐슬매력순위`

## AI Notes

- Pure pet-charm leaderboard
- Good anchor when pet-only charm should be isolated from castle/raid/home bonuses

---

# /캐슬매력순위

Status: VERIFIED

## Command Anchors

- `Info.js:1095`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `initSweetHomeUser`
- `generateCastleRanking`

## Data Usage

- `petData`
- `data.member`
- `homeData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬전적`
- `/레이드매력순위`
- `/펫매력순위`

## AI Notes

- Castle-focused charm leaderboard that depends on loaded home data
- Re-check `initSweetHomeUser` when home normalization affects ranking totals

---

# /레이드매력순위

Status: VERIFIED

## Command Anchors

- `Info.js:1105`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `initSweetHomeUser`
- `generateRaidRanking`

## Data Usage

- `petData`
- `data.member`
- `homeData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬매력순위`
- `/펫매력순위`
- `/종합순위`

## AI Notes

- Raid-focused charm leaderboard parallel to `/캐슬매력순위`
- Good anchor when raid total calculations diverge from displayed pet/home state

---

# /가구통계

Status: VERIFIED

## Command Anchors

- `Info.js:1120`

## Files

- `Info.js`

## Related Helpers

- `loadJsonFile`
- `numberWithCommas`

## Data Usage

- `homeData[*].furnitureBag[*].grade`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/가구가방`
- `/가구순위`
- `/가구정보 [닉네임]`

## AI Notes

- Aggregate furniture-grade distribution viewer across all users
- Best first anchor for furniture-grade count mismatches before per-user bag inspection

---

# /서버통계

Status: VERIFIED

## Command Anchors

- `Info.js:1170`

## Files

- `Info.js`

## Related Helpers

- `numberWithCommas`

## Data Usage

- `data.member[*].server`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/내정보`
- `/종합순위`

## AI Notes

- Aggregates server-name distribution from member profiles
- Missing or blank `member.server` values are folded into unknown counts

---

# /캐슬전적

Status: VERIFIED

## Command Anchors

- `Info.js:1243`

## Files

- `Info.js`

## Related Helpers

- `checkRank`
- `numberWithCommas`
- `calculateCastleItem`
- `calculateItemInfoAll`
- `getCastleBattleRank`
- `getCastleBattleRankEmoji`

## Data Usage

- `data.member[sender].battle.win`
- `data.member[sender].battle.lose`
- `data.member[sender].battle.score`
- `petData[sender].miniPet.castleExp`
- `castleBattleData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬대전순위`
- `/캐슬매력순위`

## AI Notes

- Primary self-profile for castle battle record and CP display
- Good first anchor when win-rate, castle rank emoji, or CP totals look inconsistent

---

# /캐슬대전순위

Status: VERIFIED

## Command Anchors

- `Info.js:1265`

## Files

- `Info.js`

## Related Helpers

- `sortCastleBattle`
- `getCastleBattleRankEmoji`
- `getRankEmoji`
- `checkRank`

## Data Usage

- `data.member[*].battle.score`
- `castleBattleData`

## Save Flow

- Read-only in the confirmed branch

## Related Commands

- `/캐슬전적`
- `/캐슬매력순위`

## AI Notes

- Ranking view for castle battle CP standings
- Open `sortCastleBattle` first when order or top-rank badge output is wrong

---

# Registry Expansion Queue

Status: PARTIAL

## Recommended Next Commands To Verify

- `/상점추가 [물건] [가격]`
- `/상점삭제 [번호]`
- `/영주수익순위초기화`
- `/타이틀지급`
- `/타이틀제거`
- `/펫타이틀지급`
- `/펫타이틀제거`
- `/출석`
- `/캐슬대전`
- `/가구장착 [번호]`
- `/가구판매 [번호]`
- `/이체`

## Known Gaps

- Most mutation-heavy commands are not indexed yet
- Admin-only maintenance commands are not indexed yet
- Save-flow cross-file interactions are only documented for representative commands

---

# /자유시장

Status: VERIFIED

## Command Anchors

- `main.js:2404`
- Registration commands: `main.js:2449`
- Purchase/cancel commands: `main.js:2732`

## Files

- `main.js`
- `data/freeMarket.json`

## Related Helpers

- `ensureFreeMarketData`
- `getFreeMarketActiveListings`
- `addFreeMarketListing`
- `returnFreeMarketItemToOwner`
- `addFreeMarketCompletedLog`
- `removeFreeMarketDataByUser`
- `generateBagOutput`
- `refreshMiniPetSortIndex`
- `initSweetHomeUser`
- `initPetSkillUser`
- `addHappyFoundationFee`

## Data Usage

- `freeMarketPath`
- `data.member[*].bag`
- `data.member[*].point`
- `petData[*].miniPetBag`
- `homeData[*].furnitureBag`
- `petSkillData[*].petSkills.bag`
- `data.hoiHappyFoundation.totalAmount`

## Save Flow

- `/자유시장` and `/자유시장현황` read `freeMarketPath`
- `/자유시장생성` creates `freeMarketPath` only when the file does not already exist
- Registration saves `freeMarketPath` and the mutated owner storage file
- Purchase saves `freeMarketPath`, `filePath`, and the purchased item storage file
- Cancel/force-cancel saves `freeMarketPath` and the restored item storage file
- Account deletion removes related free-market listings/logs and saves `freeMarketPath`

## Related Commands

- `/가방거래등록 [가방번호] [갯수] [판매금액]`
- `/미니펫거래등록 [미니펫가방번호] [갯수] [판매금액]`
- `/가구거래등록 [가구가방번호] [갯수] [판매금액]`
- `/스킬거래등록 [스킬가방번호] [갯수] [판매금액]`
- `/자유시장확인`
- `/자유시장확인취소`
- `/자유시장구매 [번호]`
- `/자유시장취소 [번호]`
- `/거래소강제취소 [번호]`
- `/자유시장생성`
- `/자유시장현황`
- `/거래현황`

## AI Notes

- Free-market storage is isolated in `freeMarket.json`; item ownership still mutates the original owner/buyer storage files
- Active listing numbers are display-order numbers from recent-first `/자유시장`; purchase confirmation stores the immutable listing id to avoid buying a shifted listing
- Registration and purchase commands show a confirmation UI first; `/자유시장확인` re-runs validation before mutation, and `/자유시장확인취소` clears the pending request
- Mini-pet same-item matching includes name, emoji, grade, upgrade, battleExp, castleExp, and raidExp
- Completed logs keep only sold trades, newest first, capped at 100 entries
- Registration fees consume `🥕당근이세요?` immediately and are not refunded on cancel/force-cancel
- Sale fee is 10%, paid by the seller from proceeds and recorded to the foundation ledger without paying the foundation captain account
- `/자유시장거래현황` displays the original completed trade price (`price`), while settlement still uses `sellerReceive`
- Free-market registration commands require tier `킹` or higher through `isTierKing`; `/자유시장구매` has no tier gate
- Free-market quantity limit is additive: base 1 + equipped `타고난 장사꾼📙` 2 + `자유시장회원권🏪` 7, so ticket-only allows 8 and both active bonuses allow 10 active registered items
- `자유시장회원권🏪` checks tolerate bag-name suffixes such as parenthesized guide text
- Invalid `/가방거래등록`, `/미니펫거래등록`, `/가구거래등록`, and `/스킬거래등록` input now replies with the exact numeric-index registration usage guide
- Furniture listings display furniture charm as `(+n💕)[grade]` in free-market item text when payload furniture data exists
