# WEB-WBS-010 current-profile DTO 표시 교정

- 실제 `ProfileView`의 `displayName`을 닉네임으로 표시한다.
- 실제 `server` 객체의 `displayName`을 서버명으로 표시하고 객체 문자열 노출을 막는다.
- 누적 레벨은 실제 `accumulatedLevel` 문자열을 그대로 표시한다.
- 기존 preview 호환 필드는 fallback으로만 유지한다.
- 현재 로그인 세션의 프로필 API만 소비하며 새 endpoint나 mutation을 추가하지 않는다.

## 검증

- `node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts`: 7/7 PASS
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- 독립 Gate 7 검토는 다음 단계에서 확정한다.
