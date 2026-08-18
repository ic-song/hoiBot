# SL-MINIPET-GUARANTEED-CREATION-OPEN 체크포인트

- 작업자: 새봄
- 실행 ID: 새봄-SL-MINIPET-GUARANTEED-CREATION-OPEN-20260818T061847Z-tekxp2
- 선점 행: 36
- branch: feature/modernization-minipet-guaranteed-creation-open-saebom-tekxp2
- 기준: feature/prod f79f21b + origin/feature/modernization a554f2c
- 상태: Gate 1~7 검증 완료, Gate 8 미완료

## 보존한 현행 동작

- exact `/창조오픈`, 미가입자 무응답
- 패키지 부족 응답을 가방 검사보다 먼저 처리
- 미니펫 가방 최대 8개, 가득 차면 패키지 미소모
- `[🐹미니펫]창조패키지 확정(/창조오픈)` 1개 차감
- `호이빛💖`, `창조`, battle/castle/raid 경험치 1,350,000 지급
- 성공 응답과 member_pet/member 저장 순서
- 저장 실패 시 지급 제거·패키지 복원 및 재저장 시도

## 검증

- 188 tests, typecheck, build 통과
- migration 36개 반복 적용
- functional-v1 fixture checksum ddab14f172b31057792ab9cb8da658e609a8861f7fb928d469766fbb05ac3cf9 반복 적용·35 tables 검증
- 정상·미가입·미보유·가방 가득·중복 event·transaction 실패 검증
- 전용 MariaDB 컨테이너 재시작 후 동일 event replay 및 원장 건수 보존
- Rhino source, 운영 JSON/DB, 실운영방, feature/prod 변경 없음

## 남은 위험

- `/창세오픈`은 WBS에서 사용이나 현재 실행 guard가 없고 주석/기존 COMMAND_INDEX가 `/창조오픈` 코드와 불일치한다. 별칭으로 추정하지 않았고 별도 재확인이 필요하다.
- Rhino 저장 실패는 수동 복원 재저장 시도이고 DB는 transaction 원자 rollback이다.
- 운영 snapshot 대사, backup/restore, 승인된 실운영방 smoke, cutover 승인 전까지 Gate 8은 미완료다.

## Git·Sheets 체크포인트

- 구현 commit: `00932f6` (`origin/feature/modernization-minipet-guaranteed-creation-open-saebom-tekxp2` push 확인)
- WBS: `슬라이스_WBS` 23행, Gate 1~7 TRUE / Gate 8 FALSE / 87.5%
- 명령 매핑: `슬라이스_명령매핑` 33행
- DB 매핑: `슬라이스_DB매핑` 23행
- 검증: `슬라이스_검증` 46행
- 선점: `슬라이스_선점` 36행
- append 과정에서 `슬라이스_WBS` 1001행에 임시 생성된 중복 행은 23행으로 옮긴 뒤 비워 재확인했다.
- CMD-05-0051 `명령어_이관` 376행의 사용 상태는 `사용` 그대로다.
