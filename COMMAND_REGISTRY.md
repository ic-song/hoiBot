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

---

# Registry Expansion Queue

Status: PARTIAL

## Recommended Next Commands To Verify

- `/길드상세정보`
- `/길드순위`
- `/가구순위`
- `/미니펫정보`
- `/펫스킬가방`
- `/시련의탑`
- `/당근`
- `/길드게시판`

## Known Gaps

- Most mutation-heavy commands are not indexed yet
- Admin-only maintenance commands are not indexed yet
- Save-flow cross-file interactions are only documented for representative commands
