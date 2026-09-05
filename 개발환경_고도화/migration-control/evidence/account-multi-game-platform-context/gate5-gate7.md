# WBS746 Gate 5~7 — 계정 권위 기반 PET_TITLE 관리자 동기화

## 범위

- `ADMIN_PET_TITLE_SYNC`만 WBS746 계정 권위와 연결한다.
- 운영 DB/운영 JSON, `feature/prod`, Gate 8은 변경하지 않는다.
- WBS743의 PET_TITLE batch receipt와 app-wiring checkpoint를 승인된 선행 자산으로 통합한다.

## Gate 5 구현 경계

- 잠금 순서: `ACCOUNT_AUTHORITY` mutex → `PET_TITLE` mutex → 호출자 room context/super_admin → 회원 권위 행 → title 보유 행.
- 호출자는 실행한 Kakao room의 `ACTIVE_CONTEXT` 선택을 가져야 하며 `super_admin` 한 명으로 식별되어야 한다.
- 전역 회원 권위는 room/server selection과 무관하게 legacy `players.status='active'`, `deleted_at IS NULL`, `player_profiles` 존재로 판정한다.
- 활성 REPRESENTATIVE, SUB, portal 미연결 회원, SUSPENDED portal의 활성 회원을 모두 보존한다.
- 명시적인 inactive/deleted 회원만 제거 대상으로 인정하며 player 유실·profile 유실은 전체 실패로 처리한다.
- canonical `LEGACY_DB` source와 LINKED crosswalk를 양방향 대사하고, 후보 밖 canonical까지 포함한 1:1 역매핑 중복을 전체 실패로 처리한다.
- active portal link가 PENDING/DELETED portal을 가리키거나 active link가 둘 이상이면 전체 실패로 처리한다.
- SHADOW/LEGACY route는 회원 권위 조회와 business/receipt/outbox DML을 실행하지 않는다.

## Gate 6 parity

- legacy 동기화의 핵심 의미인 "활성 회원의 보유 타이틀 보존, 비활성 회원 보유 타이틀 제거"를 canonical owned occurrence에 적용한다.
- batch target/participant에는 제거된 정확한 owner/occurrence 집합과 `pet_title_admin_operator_<operator_id>` 감사 주체를 기록한다.
- 동일 event replay는 mutation과 outbox를 중복 생성하지 않고 저장된 typed receipt를 검증한다.

## Gate 7 검증

- TypeScript typecheck: PASS.
- focused unit/contract: active-member authority, account mutex schema, account switch/context, admin ingress, canonical mutation PASS.
- 전체 suite 기준점: 2026-09-05 실행에서 새 동작 외 manifest/source-hash 동기화 차이를 발견했고 manifest를 1,111 consumer, SHA-256 `669c0f3926735f2cbc26d9643c3465574722973b250cb78a9fe077f875d61826`로 재생성했다.
- MariaDB 전용 schema `hoibot_wbs743_it746g5`에 migration 001~473 총 461개를 적용했다.
- `pet-title-admin-batch-app-wiring-mariadb.integration.test.ts`: 3/3 PASS, fail 0, duration 8.797초.
- MariaDB 증적: SHADOW business/receipt/outbox DML 0, child-evidence drift 실패, provider 재구성 후 replay, PET_TITLE mutex 대기, ACCOUNT_AUTHORITY mutex 대기, 실제 `/계정변경` writer와 sync 병렬 완료, 활성 REPRESENTATIVE/SUB 보존, 비활성 owner만 제거, 권위 ambiguity 시 FAILED claim만 1건 기록하고 batch/target/receipt-link/outbox/ownership DML은 0건이다.
- 테스트 종료 후 전용 schema는 guard가 확인한 정확한 이름만 제거했다. 운영 DB/운영 JSON은 조회·변경하지 않았다.
- 최종 전체 suite 1회를 실행해 stable-ID 계약의 이전 consumer 고정 수치 `1,108/4`가 현재 manifest `1,111/7`과 다른 1건을 발견했다. 기존 registry 1,104개 ID 불변 검사는 유지하고 현재 consumer 수와 신규 logical key 수만 현행화했다.
- 실패한 `object-db-consumer-stable-id.test.ts`만 표적 재실행해 5/5 PASS, fail 0, duration 3.126초를 확인했으며 전체 suite는 반복 실행하지 않았다.
- 총괄 최종 정적 리뷰: P0 0건, P1 0건, Gate 5~7 차단 없음. 추가 테스트 없이 승인 범위 커밋·푸시를 진행한다.

## 고도화_보완기준 재개 체크포인트

- 기준 위치: Google Sheets `고도화_보완기준`(gid `313273077`), Lease 2544 체크포인트 M:N, WBS 746 비고 V.
- BC-02, BC-03, BC-08은 기존 AMGP/WBS 권위·잠금·재실행 증적으로 충족한다. 이 재개 작업 때문에 Gate, owner, Lease, 진행률을 초기화하지 않는다.
- BC-05 보완 증적은 SHADOW/LEGACY sync가 회원 권위 조회, canonical mutation, business/receipt/outbox DML을 모두 0회 수행하는 focused test와 위 MariaDB 3/3 실행 결과로 고정했다.
- Inbox/receipt의 기존 재전송·재실행 정책은 그대로 유지한다. 이 작업에서 별도 retry 정책을 만들거나 의미를 변경하지 않는다.
- 공통 자산 변경이 추가로 필요하면 총괄 운영자의 배정 이후에만 진행한다.
- Gate 8의 승인·운영 반영 순서는 유지하며, Gate 5~7 완료만으로 Gate 8을 완료 처리하지 않는다.

## 안전 경계

- migration 473은 단일 additive mutex와 seed만 추가하며 rollback은 runtime 의존성을 먼저 되돌린 뒤 테이블만 제거한다.
- 운영 반영과 운영 데이터 mutation은 수행하지 않았다.
- Gate 8은 완료 처리하지 않는다.
