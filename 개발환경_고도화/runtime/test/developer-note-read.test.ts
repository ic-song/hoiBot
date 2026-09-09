import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatDeveloperNotes,
  isDeveloperNoteReadCommand,
  type DeveloperNoteEntry
} from "../src/admin/developer-note-read-service.js";

describe("developer note read", () => {
  it("accepts only the exact command", () => {
    assert.equal(isDeveloperNoteReadCommand("/개발자노트"), true);
    assert.equal(isDeveloperNoteReadCommand("/개발자노트 "), false);
    assert.equal(isDeveloperNoteReadCommand("/개발자노트 1"), false);
    assert.equal(isDeveloperNoteReadCommand("/개발자노트보기"), false);
  });

  it("groups the same date and preserves entry and change order", () => {
    const data = formatDeveloperNotes([
      { version: "2.400", releasedOn: "2026-08-28", changes: ["첫 변경", "둘째 변경"] },
      { version: "2.399", releasedOn: "2026-08-28", changes: ["이전 변경"] },
      { version: "ver_2.398", releasedOn: "2026-08-27", changes: [] }
    ]);
    assert.equal((data.match(/📅 2026-08-28/g) ?? []).length, 1);
    assert.match(data, /ver_2\.400\n• 첫 변경\n• 둘째 변경/);
    assert.ok(data.indexOf("ver_2.400") < data.indexOf("ver_2.399"));
    assert.match(data, /ver_2\.398\n• 변경 내용 없음/);
  });

  it("limits output to the first ten entries", () => {
    const entries: DeveloperNoteEntry[] = Array.from({ length: 11 }, (_, index) => ({
      version: `2.${400 - index}`,
      releasedOn: "2026-08-28",
      changes: [`변경 ${index + 1}`]
    }));
    const data = formatDeveloperNotes(entries);
    assert.match(data, /ver_2\.391/);
    assert.doesNotMatch(data, /ver_2\.390/);
  });

  it("shows an explicit empty state", () => {
    assert.equal(formatDeveloperNotes([]), "📘 등록된 개발자 노트가 없습니다.");
  });
});
