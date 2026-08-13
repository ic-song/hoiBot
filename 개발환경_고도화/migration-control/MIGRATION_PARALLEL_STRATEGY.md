# A/B/C 업무범위와 하위 작업번호 전략

## 업무범위 배정

| 범위 | 책임자 | 주 도메인 | 책임 |
|---|---|---|---|
| A | 현재 채팅 | 통합·회원·재화·인벤토리·제작·패키지·운영 | 공통 DB·fixture·dispatch·통합 probe, 최종 판정·푸시 |
| B | 별도 채팅 | 펫·미니펫·펫홈·가구 | 도메인 Service/Policy/Repository, 단위 테스트, evidence 초안 |
| C | 별도 채팅 | 정령·반지·스킬·길드·영지·캐슬·레이드·시련탑·거래소 | 도메인 Service/Policy/Repository, 단위 테스트, evidence 초안 |

## 하위 작업번호

- 형식: `<업무범위>-<일련번호>` (예: `A-1`, `B-3`, `C-2`)
- 하위 작업번호 하나는 대표 명령, 모든 별칭, 관련 자동 흐름을 포함하는 기능 슬라이스 하나를 뜻한다.
- 작업번호는 완료 후 재사용하지 않는다.
- 브랜치, checkpoint, evidence와 Queue는 같은 작업번호를 기록한다.
- 여러 하위 작업을 한 채팅에서 순차 처리할 수 있지만 동시에 같은 번호를 선점할 수 없다.

## A 전용 파일

B/C는 아래 공통 파일을 수정하지 않는다.

- `개발환경_고도화/runtime/src/app.ts`
- `개발환경_고도화/runtime/migrations/*`
- `개발환경_고도화/migration-control/fixtures/synthetic-relational/*`
- `개발환경_고도화/runtime/scripts/load-synthetic-relational.ts`
- `개발환경_고도화/migration-control/progress.json`
- `개발환경_고도화/migration-control/CHECKPOINT.md`
- `개발환경_고도화/migration-control/MIGRATION_STATUS.md`
- `개발환경_고도화/migration-control/logic-migration-queue.json`
- `COMMAND_INDEX.md`, `COMMAND_REGISTRY.md`

## 선점과 중복 방지

1. A가 작업번호, `sliceId`, 대표 명령, 모든 별칭, 업무범위와 브랜치를 Queue에 먼저 기록한다.
2. `claimed`, `implementing`, `ready_for_integration`, `verified`, `pushed` 상태인 명령은 다른 역할이 선택하지 않는다.
3. B/C는 각각 별도 worktree와 `codex/migrate-b-<domain>`, `codex/migrate-c-<domain>` 브랜치를 사용한다.
4. 명령 별칭과 같은 mutation helper는 대표 `sliceId` 하나에 포함한다.
5. 새 테이블·컬럼이 필요하면 B/C가 임의 migration 번호를 만들지 않고 schema 요구사항을 A에 전달한다.

## B/C 산출물

- 도메인 전용 `Service`, `Policy`, `Repository`
- 도메인 전용 단위 테스트
- 공통 fixture를 수정하지 않는 독립 test fixture 또는 probe 초안
- `migration-control/evidence/<sliceId>/slice.json` 초안
- 검색 키워드, legacy guard, read/write path, save 누락과 불확실성
- 커밋 SHA와 실행한 검증 결과

## 통합 판정

| 단계 | 담당 | 완료 조건 |
|---|---|---|
| 조사·구현 | B/C 또는 A | 도메인 코드와 단위 테스트 통과 |
| 통합 준비 | B/C | 전용 브랜치 푸시, `ready_for_integration` 인계 |
| 공통 연결 | A | schema·fixture·`app.ts`·문서 충돌 해결 |
| 합성 DB 검증 | A | 반복 적재, 실제 MariaDB probe, 멱등성·원장 확인 |
| 완료 | A | 전체 회귀, evidence validator, Queue·대시보드 갱신, source branch 푸시 |

## 최초 하위 작업 배정

| 작업번호 | 업무범위 | 기능 |
|---|---|
| A-1 | A | `/펫먹이조합` |
| A-2 | A | `/랜덤조합` |
| A-3 | A | `/부띠끄조합` |
| B-1 | B | `/컬렉션창조오픈` |
| B-2 | B | `/로열오픈` |
| B-3 | B | `/창세오픈` |
| B-4 | B | `/컬렉션창세오픈` |
| B-5 | B | `/미니펫창조조합` |
| B-6 | B | `/미니펫창세조합` |
| C-1 | C | `/정령조합` |
| C-2 | C | `/고급티켓조합` |
| C-3 | C | `/반지이름조합` |
| C-4 | C | `/정령이름조합` |

운영 데이터 전체 이관과 `feature/prod` 반영은 A도 사용자 승인 전에는 수행하지 않는다.
