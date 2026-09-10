# WEB-WBS-011F 사용자 타이틀 독립 메뉴 readiness

- Lease: `Lease2664`
- branch: `feature/web-portal`
- assigned base: `0e36833bc250e7dd857181f9cb7731d9aa087072`
- catalog/delta: `SC-20260902-1` / `SCD-WEB-20260910-20`
- evidence: `개발환경_고도화/migration-control/evidence/web-user-title-menu-readiness-20260910`
- evidence schema: `web-user-title-menu-readiness-v1`
- profile/tier: `READINESS_AUDIT / T0`
- 결정: 타이틀을 가방 탭에서 제외하고 `/account/titles` 별도 메뉴로 구성
- 판정: `READY_AFTER_PREDECESSORS`

Gate 1~2만 TRUE다. Gate 3~8은 FALSE이며 운영 DB/data, migration, runtime source/test, `feature/prod`, Gate 8을 변경하지 않았다.

구현은 WBS799 독립 Gate 7 GO 및 통합 뒤 시작한다. 현재 명령용 `PlayerTitleReadService`는 execution/audit/outbox DML과 내부 ID를 포함하므로 웹 GET에 직접 연결하지 않는다. 별도 SELECT-only current-player provider가 보유 순서, 1-based 표시 번호, 획득일, 구매액/판매가, 장착 상태만 최소 DTO로 반환해야 한다.

Backend는 `GET /api/v1/titles/current`와 새 provider/service/tests/app wiring을 먼저 구현한다. UI는 backend Gate 1~6 handoff 뒤 별도 Lease로 `/account/titles` navigation, 목록, 상세 펼침, 장착 배지, loading/empty/error/retry, session clearing, four-viewport accessibility를 구현한다. 현재 Lease2662의 shell R claim과는 R/R이며, 향후 WEB-WBS-009A가 같은 shell 파일을 W로 claim하면 두 UI 구현을 직렬화한다.

Strict canonical source 전환은 현재 transitional title projection과 섞지 않는다. canonical player crosswalk, domain import occurrence, definition/owned/selection의 exact binding을 T2로 증명한 후 단일 provider authority로 전환한다. nullable acquisition price는 definition 가격으로 추정하지 않는다.

다음 작업:

1. 작업반장이 Lease2663 WBS799 Gate 7 결과와 공용 shell의 실제 W Lease 충돌 여부를 확인한다.
2. backend exact Lease를 발급해 `READ_UI/T1` 구현과 evidence를 수행한다.
3. UI exact Lease를 직렬 발급한다.
4. 구현·evidence 작성자가 아닌 검토자가 actual service→route→shell→browser 동일 입력 Gate 7을 수행한다.
