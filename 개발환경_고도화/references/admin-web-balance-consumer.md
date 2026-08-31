# 관리자 확률·수치 웹 소비자

## 범위

- WBS: 639
- DB 매핑: 1917
- Lease: 2421
- 실행 ID: `개발자-SL-COMMON-ADMIN-WEB-BALANCE-CONSUMER-01-20260831T0935`
- 기준선: `b18b3efe59b17d2bb4dc51c0f88f439ee7f1600c`

## 소비자 계약

관리 웹은 WBS637 `AdminBalanceReadModelProvider`와 WBS638 `AdminBalanceMutationProvider`만 소비합니다.

- `GET /api/v1/admin/balance`: 세 도메인 projection 조회, exact domain/group/search 필터, 감사·모니터링 링크
- `POST /api/v1/admin/balance/:domain/preview`: CSRF를 확인한 apply 또는 rollback 사전검증
- `POST /api/v1/admin/balance/:domain/apply`: preview token, confirmation, expectedVersion, reason, Idempotency-Key로 새 버전 적용
- `POST /api/v1/admin/balance/:domain/rollback`: 같은 계약으로 과거 내용을 새 버전으로 복제

브라우저는 decimal과 bigint 값을 number로 변환하지 않습니다. 서버와 화면 모두 `home_badge`, `home_furniture`, `pendant` 외 도메인을 거부하며 SQL, 테이블명, 컬럼명을 입력받지 않습니다.

## 화면 계약

- 도메인과 stable group별 접기 가능한 목록
- label·stable key 검색과 domain/group 필터
- editable 값만 입력 제공, min·max·step exact decimal 사전검증
- 가구 확률 변경 시 동일 sumGroup의 정확한 100% 합계 사전검증
- provider preview의 before/after diff와 확률·비용·조건 영향 경고
- 명시적 최종 확인 후 apply 또는 rollback
- replay 결과와 새 version·audit ID 표시
- 기존 감사 기록과 이벤트 모니터링 화면으로 이동
- 980px 및 640px 이하 반응형 레이아웃

## 권한 GAP

현재 permission source를 재확인했지만 확률·수치 변경에 의미상 맞는 기존 권한은 없습니다. `package.catalog.manage`, `point_shop.catalog.manage`, `admin.request_monitor.configure`는 서로 다른 자원과 책임을 가지므로 재사용하지 않았습니다.

웹 소비자는 향후 독립 승인 대상인 `admin.balance.manage`를 요구해 fail-closed로 동작합니다. 이번 슬라이스에서는 permission schema, seed, role grant를 추가하지 않았습니다. 합성 Shadow 세션만 이 permission을 주입해 REST/UI 계약을 검증합니다.

## Shadow 및 제외 범위

- 합성 Fastify 서버에서 로그인, 권한별 메뉴, 조회, preview/apply/rollback/replay API를 검증합니다.
- 정적 클라이언트 계약과 반응형 CSS로 desktop/mobile 레이아웃을 검증합니다.
- 인앱 브라우저 런타임은 로컬 kernel asset 경로 오류로 연결되지 않았으며, 운영 브라우저 세션이나 다른 브라우저 수단으로 우회하지 않았습니다.
- schema/migration/permission seed, generic SQL/direct DB, `main.js`, 운영 DB, `feature/prod`, Gate8은 제외합니다.
