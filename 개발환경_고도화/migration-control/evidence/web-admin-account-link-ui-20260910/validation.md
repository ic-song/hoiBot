# WEB-WBS-013A 관리자 계정 연결 조회 UI 검증

- Lease: `Lease2653`; 책임 소유자: `/root/web_wbs013a_api`; 좁은 UI 구현자: `/root/web_wbs013a_ui`.
- 실행 profile/tier: `READ_UI` / `T1`.
- 기준선: `512db10fff923f5d731bbc6d0ae4ca9c240c798c`.
- UI deep-link: `/admin/players/:playerId/account-links`.
- 소비 API: `GET /api/v1/admin/players/:playerId/account-links`.

## Gate 1~6

1. 기존 회원 목록·상세 흐름과 `player.read` 메뉴 권한, 관리자 세션, 계정 연결 API DTO를 다시 확인했다.
2. 마스킹 식별자와 empty, 404, 일반 오류, 권한 부족, 세션 만료 계약을 고정했다.
3. 합성 fixture 한 건을 API 응답과 UI browser replay의 같은 입력으로 사용했다.
4. 회원 상세에 읽기 전용 패널, deep-link/새로고침 복원, history 뒤로가기, 포커스 이동, 44px 선택 영역을 구현했다.
5. 합성 Fastify 서버에서 shell deep-link와 success/empty/404/error/session/permission 응답을 검증했다.
6. API 응답 fixture와 UI 표시가 같은 마스킹 값을 사용함을 확인하고 네 viewport browser replay를 완료했다.

## 검증 결과

- Focused: `node --import tsx --test --test-name-pattern="admin web shell" test/admin-web-shell.test.ts` — 14 passed, 0 failed, 0 skipped.
- Typecheck: `npm run typecheck` — PASS.
- Build: `npm run build` — PASS.
- Browser replay: 375×812, 768×1024, 1024×900, 1440×1000 모두 deep-link 유지, 패널 1건, `account-link-title` 포커스, 회원 선택 target 44px, `overflowX=0`.
- 렌더링 값은 `maskedLoginId=s******r`, `maskedExternalUserKey=k********y`이며 portal account ID, link ID, selection version은 DOM에 없었다.
- 계정 연결 success 패널의 form/button은 0개다. 오류 상태에는 동일 GET을 다시 요청하는 재시도 버튼만 존재한다.
- `git diff --check` — PASS.

## 남은 Gate

Gate 7은 책임 소유자 및 구현·evidence 작성자가 아닌 독립 검수자가 수행해야 한다. Gate 8 운영 준비는 이 subclaim 범위가 아니다.
