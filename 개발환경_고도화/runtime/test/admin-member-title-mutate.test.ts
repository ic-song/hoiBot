import assert from "node:assert/strict";
import test from "node:test";
import { isAdminMemberTitleMutateCandidate, normalizeAdminMemberTitleMutateDispatchMessage, parseAdminMemberTitleMutateCommand } from "../src/admin/admin-member-title-mutate-service.js";

test("관리자 타이틀 변경은 정확 안내와 완전한 세 형식만 허용한다", () => {
  assert.equal(parseAdminMemberTitleMutateCommand("/타이틀추가 대상, 칭호 000")?.kind, "add");
  assert.equal(parseAdminMemberTitleMutateCommand("/타이틀지급 대상1,대상2/칭호/0")?.kind, "grant");
  assert.equal(parseAdminMemberTitleMutateCommand("/타이틀제거 대상 1")?.kind, "remove");
  assert.equal(isAdminMemberTitleMutateCandidate("/타이틀제거 대상 1 안내"), false);
});

test("관리자 타이틀 변경 별칭은 세 command registry 키로 분리된다", () => {
  assert.equal(normalizeAdminMemberTitleMutateDispatchMessage("/타이틀추가 대상, 칭호 1"), "/타이틀추가");
  assert.equal(normalizeAdminMemberTitleMutateDispatchMessage("/타이틀지급 대상/칭호/1"), "/타이틀지급");
  assert.equal(normalizeAdminMemberTitleMutateDispatchMessage("/타이틀제거 대상 1"), "/타이틀제거");
});
