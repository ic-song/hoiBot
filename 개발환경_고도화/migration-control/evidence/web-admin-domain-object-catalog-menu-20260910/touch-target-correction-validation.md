# WEB-WBS-016A 터치영역 보정 검증

- catalog_version: `SC-20260902-1`
- delta_id: `SCD-WEB-20260910-22`
- evidence_schema_version: `web-admin-domain-object-catalog-menu-touch-correction-v1`
- Lease: `Lease2674`
- 기준 커밋: `2b6e97fe1466e74b6071097ce7bac65c18ed64a1`

## 보정

- 다이아상점 확인 label에 `min-height: 44px`를 적용했다.
- 공통 위험 버튼에 `min-width: 44px`를 추가하고 기존 `min-height: 44px`를 유지했다.
- 메뉴 순서, deep link, 전용 다이아상점·펫스킬 흐름, 준비 화면과 범용 오브젝트 UI 제거 계약은 변경하지 않았다.

## 자동 검증

| 검증 | 결과 |
|---|---|
| focused admin shell 4 suites | 31/31 PASS |
| admin non-integration regression 35 files | 138/138 PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| 정적 44×44 계약 | PASS |

admin 회귀 첫 실행에서 기존 테스트가 위험 버튼의 `min-height` 첫 선언을 고정해 검사해 137/138이었다. 기존 선언 순서를 보존하고 `min-width`를 뒤에 배치한 뒤 138/138로 재검증했다.

## Chrome 실제 검증

- 5개 deep link × 375/768/1024/1440px = 20/20 조합을 Chrome에서 측정했다.
- exact viewport 20/20, overflow 0 20/20, active menu·heading 20/20, focus outline 20/20, 유효 조작 대상 44×44 이상 20/20이다.
- P1 지점은 확인 label 높이 44px(375/768/1440), 위험 버튼 너비 44px(1024)를 확인했다.
- 다이아상점은 success/form 1, 펫스킬은 기존 preview fixture 부재에 따른 error/form 0, 아이템·가구·미니펫은 empty/form 0이다. 로딩 종료 상태와 범용 오브젝트 UI 0건을 확인했다.

## Gate 근거

- Gate 1~6: TRUE 근거 확보. 최소 변경, 정적 계약, focused/admin 회귀, typecheck/build, Chrome 매트릭스가 통과했다.
- Gate 7: FALSE. 이 correction의 독립 재검수 전이며 기존 `independent-gate7-review.md`는 수정하지 않았다.
- Gate 8: FALSE. 범위 밖이다.

중앙 Sheets, 운영 데이터, DB/migration, provider, `web-shell.ts`, `app.ts`, `feature/prod`는 변경하지 않았다.
