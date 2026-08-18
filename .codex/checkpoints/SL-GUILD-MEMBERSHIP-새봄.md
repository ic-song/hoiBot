# 작업 복구 체크포인트

- 체크포인트 버전: `2`
- 슬라이스 ID: `SL-GUILD-MEMBERSHIP`
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: 도메인
- 작업자명: 새봄
- 실행 ID: `새봄-SL-GUILD-MEMBERSHIP-20260818T023237Z-6ijr53`
- 선점 행: `슬라이스_선점!16`
- Heartbeat: `2026-08-18 11:37:22 +09:00`
- Lease 만료: `2026-08-18 12:32:45 +09:00`
- 인계 상태: HANDOFF_READY
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/새봄-SL-GUILD-MEMBERSHIP-20260818T023237Z-6ijr53`
- Branch: `feature/modernization-guild-membership-saebom-6ijr53`
- 기준 커밋: `a554f2c`
- 최신 운영 기준 병합: `66b080e`
- Commit/Push: `7f62e75` (`길드 가입 흐름 Shadow 재시작 검증 강화`)를 `origin/feature/modernization-guild-membership-saebom-6ijr53`에 push 완료
- Gate: `7/8` (`현행 조사`, `DB 매핑`, `합성데이터`, `구현`, `통합`, `parity`, `Shadow` 완료; `운영 준비` 미완료)

## 승계 근거

- `guild-join`, `guild-join-condition`, `guild-force-expel` evidence가 구현, 합성 fixture, transaction, 멱등성, 재시작과 parity 통과를 기록한다.
- WBS의 세 명령은 검증 완료이며 슬라이스 단위 Shadow와 운영 준비만 미완료다.
- 현재 Git·DB·테스트로 다시 확인되지 않은 Shadow와 운영 준비 Gate는 승계하지 않는다.

## 대상 명령

- `/길드가입 [번호]`, `/가입한다`, `가입한다`, `/안한다`
- `/길드가입조건 [숫자]`
- `/길드강제제명 [닉네임]`

## DB·fixture

- DB 객체: `guilds`, `guild_members`, `guild_join_requests`, `item_definitions`, `inventory_stacks`, `inventory_ledger`, `operations`, `command_executions`, `command_audit`, `outbox_messages`.
- fixture: `migration-control/fixtures/synthetic-relational/functional-v1.sql`과 probe별 비식별 합성 행.
- 운영 `data/*` snapshot과 운영 DB는 시험 입력으로 읽거나 변경하지 않는다.

## 이번 실행 검증

- 현재 Rhino 명령 guard, helper와 가입 `guildData → member data`, 가입조건 길드 단일 저장, 강제제명 길드·회원 저장 흐름을 재확인했다.
- 실행 전용 `hoibot_rehearsal_guild_membership_6ijr53` DB에 migration 33개를 적용했다.
- checksum `ddab14f172b31057792ab9cb8da658e609a8861f7fb928d469766fbb05ac3cf9`의 71문장 합성 fixture를 2회 적용하고 verify-only로 대표 35개 테이블을 검증했다.
- 길드가입은 membership 1·가입권 0·완료 request, 가입조건은 12,345 EXP, 강제제명은 대상 membership 0을 확인했다.
- MariaDB 재시작 뒤 같은 세 event 결과가 완전히 같고 operation·execution·audit·outbox가 각 명령에서 한 번만 남는 것을 확인했다.
- 합성 probe에 현재 FK 계약에 필요한 가입조건 inbox 행과 길드가입 확인 event 재사용을 추가했다. 운영 runtime 동작은 변경하지 않았다.
- runtime 158 tests, typecheck, build와 `main.js`·`Info.js` 구문 검사가 모두 통과했다.
- 시험 DB는 대사 후 삭제했고 MariaDB 컨테이너는 healthy다.

## 남은 위험과 다음 행동

- 남은 1개 Gate는 최종 운영 guild/member/bag snapshot 전체 대사, 역할 코드, backup/restore, 승인된 실운영방 smoke와 cutover 승인이다.
