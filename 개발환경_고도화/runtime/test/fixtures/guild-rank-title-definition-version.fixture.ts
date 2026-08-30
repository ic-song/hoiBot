import type { GuildRankTitleDefinition } from "../../src/guild/guild-rank-title-definition-read-model.js";

export const GUILD_RANK_TITLE_SOURCE_HASH =
  "b717506da8dfcdd725f8255b9c0c58982192ea4c15abe50decbbb98d3a1db5ef";

const titles = [
  "황제☬", "국왕♔", "대공♛", "공작♕", "후작⚝", "백작❁", "자작⌺", "남작⍌", "기사⍫", "준기사⚔︎",
  "종사⚚", "시종✥", "영주민❖", "시민◈", "상인◉", "주민◍", "일꾼◌", "견습생△", "떠돌이◇", "외곽민◻︎",
] as const;

export const GUILD_RANK_TITLE_DEFINITIONS: readonly GuildRankTitleDefinition[] =
  titles.map((displayName, index) => {
    const rank = index + 1;
    return {
      sourceRow: rank,
      stableCode:
        rank === 20
          ? "GUILD-RANK-020-PLUS"
          : `GUILD-RANK-${String(rank).padStart(3, "0")}-${String(rank).padStart(3, "0")}`,
      displayName,
      minimumRank: rank,
      maximumRank: rank === 20 ? null : rank,
      policyCode: "GUILD_RANK_TITLE",
      policyVersion: 1,
      lifecycle: "ACTIVE",
    };
  });
