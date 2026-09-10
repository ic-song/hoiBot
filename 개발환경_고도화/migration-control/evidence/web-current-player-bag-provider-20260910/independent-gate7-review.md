# WEB-WBS-011A current-player bag provider 독립 Gate 7 검토

- 구현 commit: `5c9b0b7f5bf71d515c7c79bc4a2f8385084f083d`
- clean 검증 HEAD: `32934cdf2540cbd3aa47192a7837bba4b31a2d45`
- evidence 보정 commit: `7b6f4cf2faeed2ea7d5421e56041cfba8fbbf329`
- 원격 검증: `HEAD == origin/feature/web-portal == 7b6f4cf2faeed2ea7d5421e56041cfba8fbbf329`
- claim / CONTROL: `Lease2641` / `슬라이스_보고수신!5670`
- delta / schema: `SCD-WEB-20260910-5` / `web-current-player-bag-provider-v1`
- execution profile / tier: `SHARED_PROVIDER` / `T2`
- 검토자 역할: 구현 및 evidence 작성에 참여하지 않은 독립 검토자

## 발견 사항

- P0: 없음
- P1: 1건
- P2: 없음

### P1 — 실제 consumer matrix와 동일 입력 Shadow가 없다

provider 계약과 repository 결합 검증은 통과했지만, 현재 `app.ts`, API route, UI는 의도적으로 미연결 상태다. 따라서 실제 인증 session이 확정한 player ID가 provider로 전달되는 경로, public target player ID 차단, API/UI의 first·middle·last·empty·missing·inactive·expired-session 결과를 확인할 consumer matrix가 없다. 같은 fixture를 provider 결과와 legacy comparator 결과에 넣어 page 순서·수량을 대조하는 representative Shadow도 아직 없다.

이는 `SHARED_PROVIDER/T2` Gate 7의 consumer 영향 회귀와 대표 consumer Shadow 조건을 충족하지 못한다. WEB-WBS-011A의 후속 consumer Lease에서 이 두 근거를 만든 뒤 독립 재검토해야 한다.

## 독립 검증 결과

| 검토 항목 | 결과 | 근거 |
|---|---|---|
| current-player self scope | PASS | service 입력은 `currentPlayerId`와 pagination뿐이고 별도 target player 입력이 없다. ID는 1 이상 unsigned 64-bit decimal 범위만 허용한다. 실제 인증 session과의 결합은 후속 consumer 범위다. |
| active·undeleted player | PASS | repository가 `players.id` exact 조건과 `status='active'`, `deleted_at IS NULL`을 함께 적용하고 profile inner join으로 존재를 확인한다. |
| pagination | PASS | `limit`은 safe integer 1..100, `offset`은 safe integer 0 이상만 허용한다. 전체 legacy 정렬 후 page를 잘라 순서가 페이지 경계에서 바뀌지 않는다. |
| unsigned 64-bit quantity | PASS | `inventory_stacks.quantity`는 `BIGINT UNSIGNED`이며 repository가 bigint를 decimal string으로 변환한다. 최대값 `18446744073709551615` fixture가 손실 없이 통과했다. |
| legacy comparator | PASS | 기존 `compareLegacyBagItems`를 직접 재사용한다. `/가방` renderer와 comparator는 수정되지 않았고 기존 3개 회귀 test가 통과했다. |
| empty·missing·inactive | PASS | 활성 사용자의 빈 가방은 빈 items page로 반환한다. missing/inactive player는 inventory 조회 전에 `CURRENT_PLAYER_NOT_AVAILABLE` 404로 종료한다. |
| 식별자·metadata 비노출 | PASS | public response에는 `ownerLabel`, `advertisement`, `displayName`, string quantity, pagination만 있다. 내부 `playerId`와 `legacyBagOrder`는 응답에 포함되지 않는다. |
| SQL DML 0 | PASS | scripted DB의 모든 실행문이 SELECT이며 `execute`와 transaction 진입은 실패하도록 고정됐다. source 정적 DML token 검사도 0건이다. |
| focused test | PASS | `node --import tsx --test test/current-player-bag.test.ts test/bag-read.test.ts`: 9/9 통과, 실패·skip 0. |
| typecheck / build / diff | PASS | `npm run typecheck`, `npm run build`, target/evidence commit의 `git diff --check`가 통과했다. |
| evidence 무결성 | PASS | 세 provider source/test 파일의 SHA-256이 `summary.json`과 3/3 일치한다. 과거 `b5175489` 연결 오류는 보정되어 구현 5c9, clean 검증 329, evidence 7b6의 역할이 분리 기록됐다. |
| Lease·CONTROL | PASS | `슬라이스_선점!2641`은 provider source/test와 provider key만 W로 소유한다. CONTROL5670은 Lease2641을 ACTIVE로 유지하고 Lease2642·2643과 W 자원이 겹치지 않음을 기록한다. |
| 범위 이탈 | PASS | 구현 target에 `app.ts`, user-auth routes, site-web UI, DB schema/migration, writer, ledger, receipt 변경이 없다. 운영 DB/data, `feature/prod`, Gate 8도 건드리지 않았다. |

## 독립 실행 명령과 원장 조회

```powershell
git show --stat --oneline 5c9b0b7f
git diff-tree --no-commit-id --name-only -r 5c9b0b7f
git diff --check b5175489 5c9b0b7f
git diff --check 7b6f4cf2^ 7b6f4cf2
node --import tsx --test test/current-player-bag.test.ts test/bag-read.test.ts
npm run typecheck
npm run build
git rev-parse HEAD
git rev-parse origin/feature/web-portal
```

Google Sheets `슬라이스_선점!A2641:N2641`과 `슬라이스_보고수신!A5670:N5670`을 읽기 전용으로 재조회했다. `inventory_stacks.quantity`의 unsigned 계약은 적용 migration과 함께 확인했다.

## 해제 조건

1. 현재 인증 session의 player ID만 전달하는 API consumer를 연결하고 public query/body의 target player ID를 거부한다.
2. API/UI에서 first·middle·last page, empty, missing/inactive, expired session, unsigned 64-bit quantity matrix를 검증한다.
3. 같은 fixture에 대해 provider pagination과 legacy comparator의 전체 순서·수량을 Shadow 비교한다.
4. 위 근거를 immutable commit과 T2 evidence에 연결하고 독립 Gate 7 재검토를 받는다.

## Gate 7 판정

**NO-GO / HANDOFF_READY**

provider 구현 자체는 계약, 보안 범위, read-only SQL, 기존 `/가방` 회귀와 빌드 검증을 통과해 consumer 작업에 인계할 수 있다. 실제 consumer matrix와 representative Shadow가 없어 `SHARED_PROVIDER/T2` Gate 7 완료로 승인할 수는 없다. Gate 8은 계속 false다.
