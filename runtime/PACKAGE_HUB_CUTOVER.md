# 패키지허브 운영 전환 절차

## 현재 범위

- 독립 패키지 명령 `29/29`
- 보상 정의 `164/164`행
- MariaDB 보상 규칙 `158/158`
- 미니펫 정의 `1,078개`, 추첨 가능 카탈로그 `1,066개`
- 신규 package, item, catalog 데이터는 운영 승인 전까지 모두 비활성으로 유지한다.
- 레거시 `main.js`와 기존 MariaDB `3306`은 cutover 성공 확인 전까지 변경하거나 제거하지 않는다.

## 승인된 안전 차이

신규 provider는 다음 차이를 의도적으로 적용한다.

1. 할로윈 패키지는 보상 일부만 지급된 상태를 남기지 않고, 실패하면 전체 transaction을 rollback한다.
2. 미니펫 패키지는 가방의 남은 용량까지만 지급하고 실제 지급된 수량만 소비한다.
3. 동일 idempotency key의 재요청은 저장된 결과를 반환하며 보상을 다시 지급하지 않는다.
4. 포인트와 수량형 아이템은 signed BIGINT 범위를 넘기기 전에 실패한다.
5. 펫 외형 교체는 `PET_APPEARANCE`에만 허용하고 다른 아이템 유형은 기존 소유 데이터를 덮어쓰지 않는다.

## Gate 6 parity 기준

- 29개 명령과 DB alias가 모두 일치한다.
- 고정 보상, 가중치 보상, 묶음 보상, 범위 보상과 동적 미니펫 카탈로그를 exact fixture와 대조한다.
- 낚시 성공 후보의 정규화 가중치 합은 `1.0`이어야 한다.
- transaction 중 후반 FK 오류가 발생하면 소비, 선행 보상, operation과 ledger가 모두 rollback되어야 한다.
- 재시작 및 동일 요청 replay에서 중복 소비·중복 지급이 없어야 한다.

## Gate 7 격리 Shadow 기준

- `runtime/.env.package-db`가 가리키는 격리 포트만 사용한다.
- 기본 포트 `3306`, 운영 사용자 데이터와 실운영방을 사용하지 않는다.
- 모든 package와 신규 item은 비활성 상태에서 합성 사용자로 실행한다.
- exact fixture의 기대 결과와 DB 조회 결과를 비교한다.
- 허용 차이는 위의 안전 차이 다섯 가지뿐이다.
- Shadow 종료 후 합성 balance, instance, operation, ledger와 capacity 행이 `0`이어야 한다.

## Snapshot 및 restore 리허설

격리 DB에서 다음 명령으로 snapshot과 임시 DB restore parity를 검증한다.

```powershell
./package-db-snapshot.ps1 -RestoreDrill
```

스크립트는 기본 포트 `3306`을 거부한다. 운영 포트 실행은 총괄 운영자와 개발자의 명시 승인, 대상 DB 확인, 유지보수 시간 확보 후에만 `-AllowDefaultPort`를 사용한다.

Restore 리허설에는 `CREATE DATABASE`, `DROP DATABASE` 권한이 있는 별도 관리자 계정이 필요하다. `DATABASE_ADMIN_USER`, `DATABASE_ADMIN_PASSWORD`를 비밀 환경 파일에 추가하거나 `-AdminUser`, `-AdminPassword`로 전달한다. 애플리케이션 계정에는 이 권한을 추가하지 않는다.

## Cutover 순서

1. 전체 대상 슬라이스의 Gate 1~7 완료 여부를 확인한다.
2. 총괄 운영자와 개발자의 cutover 및 rollback 승인을 기록한다.
3. 운영 DB snapshot을 생성하고 restore 가능한지 확인한다.
4. migration checksum과 대상 schema를 확인한다.
5. package와 item이 비활성인 상태로 migration과 seed를 적용한다.
6. 읽기 전용 smoke로 `29/29`, alias `29/29`, rule `158/158`을 확인한다.
7. 제한된 canary 대상에서 신규 dispatch를 활성화한다.
8. 소비·지급·ledger·operation·오류율을 대조한다.
9. 승인된 관찰 시간 동안 이상이 없을 때 package 활성 범위를 확대한다.
10. 안정화가 확인된 뒤에만 레거시 provider 연결을 해제한다.

## 즉시 중단 기준

- 중복 소비 또는 중복 지급 1건 이상
- 소비와 지급 ledger 불일치 1건 이상
- package, alias 또는 rule 기준 수량 불일치
- 미승인 아이템 유형이나 소유 범위 변경
- transaction rollback 뒤 잔존 mutation 발견
- canary 외 사용자에게 신규 dispatch 발생
- DB 연결 대상 또는 포트가 승인값과 다름

## Rollback 순서

1. 신규 dispatch와 package 활성화를 즉시 중지한다.
2. 레거시 dispatch를 유지하거나 재연결한다.
3. 신규 operation 수신을 막고 진행 중 transaction 종료를 기다린다.
4. operation, ledger, 소비와 지급 상태를 마지막 정상 checkpoint와 대조한다.
5. schema rollback보다 먼저 DB snapshot 복원 필요 여부를 판단한다.
6. 중복 이름을 허용하기 위해 제거한 unique index는 데이터 중복을 정리하거나 유지 정책을 승인하기 전까지 재생성하지 않는다.
7. 복구 후 동일 canary smoke를 다시 수행하고 승인 전까지 신규 provider를 비활성으로 유지한다.

## Gate 8 완료 조건

다음 항목이 모두 증거로 남아야 Gate 8을 완료할 수 있다.

- 전체 대상 슬라이스 Gate 1~7 완료
- 운영 snapshot 대사와 backup/restore 성공
- 승인된 canary smoke 성공
- cutover 시각, 대상 버전과 담당자 기록
- rollback 리허설 성공
- 총괄 운영자와 개발자 승인
