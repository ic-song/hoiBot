# 작업 복구 체크포인트

- 체크포인트 버전: `2`
- 슬라이스 ID: `SL-INV-MUTATE`
- 도메인: 가방·인벤토리
- 작업 레인: 도메인
- 작업자명: 새봄
- 실행 ID: `새봄-SL-INV-MUTATE-20260818T010121Z-qu1e2h`
- 선점 행: `슬라이스_선점!15`
- Heartbeat: `2026-08-18 10:08:15 +09:00`
- Lease 만료: `2026-08-18 11:01:24 +09:00`
- 인계 상태: HANDOFF_READY
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/새봄-SL-INV-MUTATE-20260818T010121Z-qu1e2h`
- Branch: `feature/modernization-inv-mutate-saebom-qu1e2h`
- 기준 커밋: `a554f2c`
- 최신 운영 기준 병합: `a89b427`
- Commit/Push: `7c389be` (`인벤토리 변경 Shadow 재시작 검증 강화`)를 `origin/feature/modernization-inv-mutate-saebom-qu1e2h`에 push 완료
- Gate: `7/8` (`현행 조사`, `DB 매핑`, `합성데이터`, `구현`, `통합`, `parity`, `Shadow` 완료; `운영 준비` 미완료)

## 승계 근거

- 구현 커밋 `0ea01c6`의 `/가방속성`, `/가방추가`, `/소지품저장` Service·Repository·dispatch·migration 033·합성 probe를 승계했다.
- 이전 체크포인트는 runtime 158 tests, typecheck, build와 Rhino 소스 구문 검사를 통과했으나 MariaDB rehearsal은 미실행으로 기록했다.
- `bag-attribute` evidence의 parity는 통과했지만 전체 `bag-mutate` evidence의 parity·Shadow는 pending이다.

## 현재 명령·저장 흐름

- `/가방속성 [유저명] [아이템번호] [갯수]`: 레거시는 `member.<target>.bag`의 절대 수량 변경 또는 0 삭제 후 응답 종료부의 member 저장 흐름에 합류한다. 고도화는 stack·ledger·operation·execution·audit·outbox를 한 transaction으로 저장한다.
- `/가방추가 [유저명], [아이템명] [갯수]`: 레거시는 가방 수량을 누적한 뒤 member 저장 흐름에 합류한다. 고도화는 catalog·stack·ledger·operation·execution·audit·outbox를 한 transaction으로 저장한다.
- `/소지품저장`: 레거시는 `data.member[*].bag`을 `memberBagCheckPath`에 저장한다. 고도화는 전체 stack과 version, 건수·합계·SHA-256을 snapshot·entry·operation·execution·audit·outbox로 한 transaction에 저장한다.
- 입력 guard는 mutation 실행 전 full-pattern 또는 exact command로 검증하며 suffix 안내문은 실행하지 않는다.

## DB·fixture

- DB 객체: `item_definitions`, `inventory_stacks`, `inventory_ledger`, `inventory_snapshots`, `inventory_snapshot_entries`, `operations`, `command_executions`, `command_audit`, `outbox_messages`.
- fixture: `migration-control/fixtures/synthetic-relational/functional-v1.sql`의 비식별 synthetic identity·operator·inventory.
- 운영 `data/*` snapshot과 운영 DB는 읽거나 변경하지 않는다.

## 이번 실행 검증

- 실행 전용 `hoibot_rehearsal_inv_mutate_qu1e2h` DB에 migration 33개를 적용했다.
- 71문장 합성 fixture를 2회 적용하고 verify-only로 대표 35개 테이블을 검증했다.
- mutation 전에 `db:probe:bag-read`가 stack 5개·출력 7줄로 통과했다. mutation 뒤에는 고정 5개 전제를 가진 읽기 probe를 다시 실행하지 않았다.
- `/가방속성`은 수량 20→7·delta -13, `/가방추가`는 합성 아이템 수량 3, `/소지품저장`은 snapshot 1개·2명·11개 항목·SHA-256 `b7f594361d267463999a1216794f78b4b56fe574769b5d247a9246f908abcc6c`를 확인했다.
- MariaDB 재시작 뒤 같은 고정 event를 다시 실행해 결과가 완전히 같고 원장·operation·execution·audit·outbox·snapshot 효과가 각각 한 번만 남는 것을 확인했다.
- 재시작 재현을 위해 합성 probe에 검증된 `PROBE_RUN_KEY` 입력과 기존 inbox event 재사용을 추가했다. 운영 runtime 동작은 변경하지 않았다.
- runtime 158 tests, typecheck, build와 `main.js`·`Info.js` 구문 검사가 모두 통과했다.

## 남은 위험과 다음 행동

- 최종 운영 snapshot의 전체 bag property·특수 아이템 순서·수량 대사는 운영 준비 Gate 전까지 미완료다.
- 승인된 운영자 identity, 실운영방 smoke, backup/restore와 cutover 승인은 수행하지 않는다.
- 남은 1개 Gate는 승인된 운영 snapshot 전체 대사, backup/restore, 실운영방 smoke와 cutover 승인이다.
