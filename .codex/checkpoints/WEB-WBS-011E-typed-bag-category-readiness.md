# WEB-WBS-011E typed 가방 category 준비도 체크포인트

- mode: `WEB_PORTAL / READINESS_AUDIT`
- validation tier: `T0`
- Lease: `Lease2658` (`CONTROL row5716` 증분 포함)
- catalog delta: `SCD-WEB-20260910-17`
- evidence schema: `web-typed-bag-category-readiness-v1`
- assigned base / observed head: `e0d3c871` / `d4dc4050`
- evidence: `개발환경_고도화/migration-control/evidence/web-typed-bag-category-readiness-20260910/`

## 판정

현재 웹 가방 provider는 `general|furniture`와 세션 self-scope만 제공한다. 미니펫·펫스킬은 canonical schema/import 자산이 있지만 consumer read port와 category provider가 없고, 펜던트는 canonical 보유/import schema가 없으며, 패키지는 별도 typed inventory가 아니라 일반 item stack과 package catalog의 projection이다. 따라서 네 category 모두 현재 웹 API에 빈 응답이나 이름 기반 필터로 추가할 수 없다.

권장 순서는 `펫스킬 → 미니펫 → 패키지 → 펜던트`다. 공용 category enum, route, repository와 UI tab state는 W/W 직렬화한다. 운영자 대상조회는 current-player route와 분리하고 펜던트는 총괄 운영자(`isMaster`) 전용, 나머지는 운영자(`isAdmin`) 또는 총괄 운영자(`isMaster`) 현행 권한을 보존한다.

## Gate 상태

- Gate 1: 현행 명령·권한·원천·formatter·정렬·번호·capacity·mutation 연계와 modern schema/import/provider/evidence 재확인.
- Gate 2: category별 최소 DTO, self-scope, 선행 WBS, exact repository-qualified Lease와 fallback 금지 동결.
- Gate 3~6: `FALSE`; 구현·fixture·격리 DB·same-input Shadow 범위 밖.
- Gate 7: `FALSE`; 독립 검토 전.
- Gate 8: `FALSE`; 운영 준비 범위 밖.

기존 evidence의 Gate를 `web-typed-bag-category-readiness-v1`로 재라벨링하지 않았다.
