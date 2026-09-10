# WEB-WBS-011A 현재 사용자 가방 UI T2 증거

- 실행 ID: `가방UI-SL-ITEM-USER-WEB-BAG-READ-UI-01-20260910092513`
- Lease: `Lease2644` (ACTIVE 확인)
- CONTROL: `슬라이스_보고수신!5675` (ACTIVE, supersedes row5674 확인)
- 계약: `GET /api/v1/inventory/current?limit=20&offset=<offset>` mock 소비
- 범위: `/account/inventory`, user shell/assets, UI 테스트 및 설계 문서만 변경

## 검증 시나리오

1. mock 세션·프로필·가방 응답에서 아이템 이름과 수량을 `textContent`로 렌더링하고, 첫 페이지 다음 버튼이 활성화되는 것을 검증했다.
2. 다음 페이지에서 provider가 반환한 `pagination.limit`과 `offset`을 사용해 다음 요청과 이전/다음 비활성 상태를 검증했다.
3. 가방 `401`은 가방 DOM 및 client state를 제거하고 로그인 만료 안내와 포커스를 표시함을 검증했다.
4. 프로필 `401` 뒤에는 후속 가방 성공 fixture가 있어도 가방 endpoint를 호출하지 않고 로그인 상태와 빈 inventory DOM/state를 유지함을 검증했다.
5. 빈 가방은 빈 상태·숨겨진 목록/페이지와 `가방이 비어 있어요` live announcement를 표시함을 검증했다.
6. 500 오류는 recovery message와 재시도 버튼을 표시하고, 재시도 성공은 오류를 제거하고 안전한 아이템 렌더링 및 최종 항목 수 announcement로 대체함을 검증했다.
7. 로딩 상태, visible focus, reduced-motion CSS, 375px 모바일 재배치를 source와 focused test로 검증했다.

## 실행 결과

2026-09-10에 runtime 작업 디렉터리에서 `node --import tsx --test test/user-shell.test.ts test/site-web-app-wiring.test.ts`를 실행해 12/12 통과했다. `npm run typecheck`, `npm run build`, `git diff --check`도 통과했다. 작업반장 브라우저 검증은 `foreman-visual-qa.md`, 기계 판독 가능한 4개 viewport 측정은 `responsive-metrics.json`에 분리해 기록했다. API 등록/provider/app.ts 통합은 Lease2642 종료 후 수행해야 하므로 Gate 7 및 Gate 8 근거는 이 UI evidence에 포함하지 않는다.
