# 작업 복구 체크포인트

- 슬라이스 ID: `SL-INV-READ`
- 작업자명: 새봄
- 실행 ID: `새봄-SL-INV-READ-20260817T174455Z-w9or92`
- Branch: `feature/modernization-inv-read-saebom-w9or92`
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/새봄-SL-INV-READ-20260817T174455Z-w9or92`
- 기준 커밋: `a554f2c`
- 최신 운영 기준 병합: `d16d32a`
- Heartbeat: `2026-08-18 02:50:00 +09:00`
- 상태: Shadow 검증 완료, 운영 준비 대기
- Gate: `7/8` (`현행 조사`, `DB 매핑`, `합성데이터`, `구현`, `통합`, `parity`, `Shadow` 완료)

## 승계 및 현재 근거

- 기존 `/가방`, `ㄴㄴㄴ` 관계형 조회 구현과 `0ea01c6` 증빙을 승계했다.
- 현재 Rhino 명령은 정확한 `/가방` 또는 `ㄴㄴㄴ`만 허용하며 조회 흐름에서 member 데이터를 저장하지 않는다.
- 고도화 경로는 지정 운영 채널의 exact command를 `GetBagService -> MariaBagRepository -> formatLegacyBag` 순서로 처리한다.
- 운영 `data/` snapshot과 운영 DB는 읽거나 변경하지 않는다.

## 이번 실행 범위

- 실행 전용 `hoibot_rehearsal_*` MariaDB에 migration 전체를 적용한다.
- 합성 fixture를 dry-run, 2회 apply, verify-only로 검증한다.
- `db:probe:bag-read`를 MariaDB 재시작 전후 실행해 동일한 조회 결과를 확인한다.
- runtime 전체 test, typecheck, build와 Rhino JavaScript 구문 검사를 수행한다.

## 검증 결과

- 실행 전용 `hoibot_rehearsal_inv_read_w9or92`에 migration 33개를 적용했다.
- checksum `ddab14f172b31057792ab9cb8da658e609a8861f7fb928d469766fbb05ac3cf9`인 합성 fixture 71문장을 dry-run, 2회 apply, verify-only로 검증했다.
- 대표 35개 테이블의 합성 행 수가 재적용 뒤에도 동일했다.
- MariaDB 재시작 전후 `db:probe:bag-read`가 모두 stack 5개, 출력 7줄을 반환했고 JSON 결과가 일치했다.
- runtime 테스트 158개, typecheck, build와 `main.js`·`Info.js` 구문 검사가 통과했다.
- 운영 `data/` snapshot과 운영 DB는 읽거나 변경하지 않았다.

## 다음 작업

- 남은 운영 준비 Gate는 최종 운영 snapshot 대사, backup/restore, 승인된 실운영방 smoke와 cutover 승인 후에만 완료한다.
