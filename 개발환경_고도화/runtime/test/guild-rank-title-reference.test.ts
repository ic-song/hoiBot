import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGuildRankTitleReferenceMessage,
  getLegacyGuildMasterRankTitle,
  GuildRankTitleReferenceService,
  isGuildRankTitleReferenceCommand
} from "../src/guild/guild-rank-title-reference-service.js";

const EXPECTED_TITLES = [
  "황제☬", "국왕♔", "대공♛", "공작♕", "후작⚝", "백작❁", "자작⌺", "남작⍌", "기사⍫", "준기사⚔︎",
  "종사⚚", "시종✥", "영주민❖", "시민◈", "상인◉", "주민◍", "일꾼◌", "견습생△", "떠돌이◇", "외곽민◻︎"
];

describe("guild rank title reference", () => {
  it("accepts only the exact legacy command", () => {
    assert.equal(isGuildRankTitleReferenceCommand("/길드계급표"), true);
    assert.equal(isGuildRankTitleReferenceCommand("/길드계급표 "), false);
    assert.equal(isGuildRankTitleReferenceCommand("/길드계급표 알려줘"), false);
    assert.equal(isGuildRankTitleReferenceCommand("/길드순위"), false);
  });

  it("preserves the source authority for ranks 1 through 20 and rank 21+", () => {
    assert.deepEqual(EXPECTED_TITLES, EXPECTED_TITLES.map((_title, index) => getLegacyGuildMasterRankTitle(index + 1)));
    assert.equal(getLegacyGuildMasterRankTitle(21), "외곽민◻︎");
    assert.equal(getLegacyGuildMasterRankTitle(999), "외곽민◻︎");
  });

  it("keeps the exact 1-to-20 output order and legacy guide", () => {
    const expectedRows = EXPECTED_TITLES.map((title, index) => title + "  " + (index + 1) + "등").join("\n");
    assert.equal(
      buildGuildRankTitleReferenceMessage(),
      "👑 길드 계급표 👑\n\n길드 순위를 기준으로 계급이 결정됩니다.\n\n" + expectedRows
        + "\n\n21등 이후부터는 길드계급표시가 없습니다."
    );
  });

  it("is read-only and deterministic for repeated calls", () => {
    const service = new GuildRankTitleReferenceService();
    const first = service.handle("/길드계급표");
    const second = service.handle("/길드계급표");
    assert.deepEqual(second, first);
    assert.deepEqual(service.handle("/길드계급표 1"), { status: "ignored" });
  });
});
