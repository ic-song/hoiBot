# 작업 복구 체크포인트

- 작업 키: iteminfo-raid-definitions
- 작업 이름: itemInfo 레이드 특수 아이템 9개 typed 정의
- 작업 상태: 검증 완료
- 정리 후보: 아니요
- 정리 후보 기준 커밋:
- 체크포인트 버전: 3
- 마지막 갱신: 2026-08-30 15:50 KST
- 대화 식별명: 펫무쌍 명령어 및 패스 수정

허용 상태: `진행 중 → 검증 완료 → 작업 완료`

## 현재 목표

- WBS 604 `SL-ASSET-ITEMINFO-RAID-DEFINITIONS-01`을 기존 자산 카탈로그와 중복 없이 Gate 1~7까지 구현·검증한다.

## 사용자 요청과 승인 범위

- 최신 요청: 모든 아이템성 게임 자산을 전수 식별하고 승인된 dependency graph에 따라 도메인 슬라이스를 Gate 1~7까지 완료한다.
- 허용된 변경: 레이드 9개 canonical item/object/source binding 및 typed bonus 정의, 합성 fixture, 격리 DB 검증 자산.
- 별도 승인이 필요한 작업: Gate 8, `feature/prod`, 운영 DB와 운영 데이터 반영.
- 선언된 파일 범위: 아래 변경 파일 8개와 이 체크포인트만.

## 작업 위치

- 저장소: `C:\Users\user\Desktop\hoiBot`
- 작업 트리: `C:\Users\user\Desktop\hoiBot-worktrees\iteminfo-raid-definitions-v2400-20260830`
- 브랜치: `codex/modernization-iteminfo-raid-definitions-v2400-20260830`
- 원격 저장소: `https://github.com/ic-song/hoiBot.git`
- 업스트림 브랜치: 미설정
- 마지막 푸시 커밋: 없음
- 원격 동기화 상태: baseline `bd2ee30458a122397894dbd66eaf7204fc243956`, 신규 파일 미커밋
- 체크포인트 Git 추적: 아니요
- 체크포인트 포함 푸시 커밋:

## 완료된 작업

- 현재 baseline `bd2ee304`에서 원천 `dept1 8 + dept2 1`을 재확인했다.
- dept2 1개는 안정 identity 근거로 기존 `ITEM-RWD-043`을 재사용하고 나머지 8개는 신규 item code로 설계했다.
- migration 386, fixture, evidence, catalog/repository, focused test, MariaDB probe, Shadow 스크립트 초안을 생성했다.
- focused test 5/5, typecheck, build를 통과했다.
- fresh MariaDB에서 migration-count 376, 레이드 정의·아이템·오브젝트·소스 바인딩 9/9 및 기존 `ITEM-RWD-043` 재사용을 확인했다.
- 트랜잭션 rollback, migration replay, 재접속 9/9, Shadow 6/6을 통과했다.
- 전체 회귀 1,171건 중 1,164 PASS, 0 FAIL, 7 SKIP을 확인했다.

## 진행 중인 작업

- 기존 Lease 2341은 `EXPIRED` 이력으로 보존됐다.
- 복구 실행 ID `작업반장-SL-ASSET-ITEMINFO-RAID-DEFINITIONS-01-복구-202608301545`, Lease 2342가 2026-08-30 16:45:19 KST까지 단독 ACTIVE로 발급됐다.
- 구현·검증은 완료됐으며 source branch 커밋·푸시와 WBS Gate 1~7 마감만 남았다.

## 변경 파일

- `개발환경_고도화/runtime/migrations/386_iteminfo_raid_definitions.sql`
- `개발환경_고도화/migration-control/fixtures/synthetic-relational/iteminfo-raid-definitions-v1.json`
- `개발환경_고도화/migration-control/evidence/iteminfo-raid-definitions/slice.json`
- `개발환경_고도화/runtime/src/catalog/raid-item-bonus-catalog.ts`
- `개발환경_고도화/runtime/src/catalog/maria-raid-item-bonus-repository.ts`
- `개발환경_고도화/runtime/test/raid-item-bonus-catalog.test.ts`
- `개발환경_고도화/runtime/scripts/iteminfo-raid-mariadb-probe.mjs`
- `개발환경_고도화/runtime/scripts/iteminfo-raid-shadow.mjs`

## 검증

- 집중 테스트: 5/5 PASS
- 타입검사·빌드: PASS
- 전체 회귀: 1,171 total / 1,164 pass / 0 fail / 7 skip
- 격리 MariaDB: migration-count 376, parity 9/9, rollback·replay·reconnect PASS
- Shadow: 6/6 PASS

## 충돌·막힘·미승인 사항

- Lease 2342 범위 밖 파일과 공용 provider는 변경하지 않는다.
- Gate 8, 운영 DB, `feature/prod`는 금지 상태다.

## 다음 행동

1. 변경 파일과 체크포인트를 커밋·푸시한 뒤 WBS 604, DB 매핑, 검증, Lease 2342와 Gate7 보고를 마감한다.

## 보안

- 비밀 값, 평문 자격 증명과 불필요한 개인정보를 기록하지 않는다.
