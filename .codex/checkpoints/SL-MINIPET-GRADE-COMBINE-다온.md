# SL-MINIPET-GRADE-COMBINE 실행 체크포인트

- 작업 키: minipet-grade-combine
- 작업 이름: 미니펫 등급 조합 고도화
- 작업 상태: 완료(운영 준비 제외)
- 정리 후보: 아니요
- 정리 후보 기준 커밋:
- 체크포인트 버전: 4
- 마지막 갱신: 2026-08-18 15:44 KST
- 대화 식별명: 작업반장 01a0132e-f8db-7172-8192-101f6b8f4070

## 현재 목표

- CMD-05-0028/0029/0030의 기존 분류 증거를 승계해 Gate 3~6과 가능한 Gate 7을 비식별 합성 데이터로 구현·검증한다.

## 사용자 요청과 승인 범위

- 최신 요청: 고도화 이어서 진행 SL-MINIPET-GRADE-COMBINE
- 허용된 변경: 전용 branch의 고도화 runtime 서비스·통합·테스트·합성 probe·evidence·체크포인트
- 별도 승인이 필요한 작업: reward 누락 rollback 안전 차이 parity 승인, 운영 준비 Gate 8, feature/prod 반영
- 선언된 파일 범위: 개발환경_고도화/runtime, 개발환경_고도화/migration-control/evidence/minipet-grade-combine, .codex/checkpoints/SL-MINIPET-GRADE-COMBINE-다온.md

## 작업 위치

- 저장소: https://github.com/ic-song/hoiBot.git
- 작업 트리: C:\Users\user\Desktop\hoiBot-worktrees\다온-SL-MINIPET-GRADE-COMBINE-20260818T061300Z-bicbsq
- 브랜치: feature/modernization-minipet-grade-combine-daon-bicbsq
- 원격 저장소: origin
- 업스트림 브랜치: origin/feature/modernization-minipet-collection-genesis-saebom-58lpev
- 마지막 푸시 커밋: 8116800 구현 · 5bbfa2e 체크포인트
- 원격 동기화 상태: origin/feature/modernization-minipet-grade-combine-daon-bicbsq와 5bbfa2e 일치 확인
- 체크포인트 Git 추적: 예(이번 커밋 예정)
- 체크포인트 포함 푸시 커밋: 5bbfa2e

## 완료된 작업

- 최신 권위 WBS의 이전 분류 행과 CMD 사용 상태 '사용'을 읽기 확인했다.
- 새 실행 ID 다온-SL-MINIPET-GRADE-COMBINE-20260818T061300Z-bicbsq로 슬라이스_선점 35행의 유일한 ACTIVE 소유권을 확인했다.
- migration은 기존 035까지 재사용하고 새 번호를 만들지 않아 병렬 번호 충돌을 피하기로 했다.
- collection creation/genesis의 mini_pet_definitions, owned_mini_pets, operations, command_executions, command_audit, outbox 구조를 기준으로 선택했다.
- Rhino의 보상 풀 151개(태초+ 100, 창세 50, 창조 1)를 읽기 전용 parity 스냅샷으로 옮기고 validator로 완전 일치를 확인했다.
- broad startsWith와 parseInt 접미 허용, 창조 자동/수동 선택, legacy 정렬, 50%/30%/100% 성공률과 응답 형식을 서비스에 반영했다.
- source 2개 삭제, optional reward, operation/execution/audit/outbox를 단일 transaction에 묶고 event idempotency를 구현했다.
- 보상 정의 누락은 transaction 안의 source 삭제 후 예외로 전체 rollback되어 합성 MariaDB에서 source 2개 보존을 확인했다.
- 합성 DB 정상·태초+ 실패·창세 실패·창조 자동·창조 수동·중복 event와 MariaDB 재시작 replay를 검증했다.
- 병렬 작업자가 migration 036을 사용한 것을 최종 확인했다. 이 슬라이스는 새 migration 없이 기존 공용 schema만 재사용한다.

## 진행 중인 작업

- 없음. 최종 인계 체크포인트 push와 WBS/선점 종료 기록만 남았다.

## 변경 파일

- .codex/checkpoints/SL-MINIPET-GRADE-COMBINE-다온.md
- 개발환경_고도화/runtime/src/mini-pet/grade-combine-service.ts
- 개발환경_고도화/runtime/src/mini-pet/grade-combine-rewards.ts
- 개발환경_고도화/runtime/src/app.ts
- 개발환경_고도화/runtime/test/grade-combine.test.ts
- 개발환경_고도화/runtime/scripts/probe-grade-combine-synthetic.ts
- 개발환경_고도화/runtime/scripts/validate-grade-combine-parity.ts
- 개발환경_고도화/runtime/package.json
- 개발환경_고도화/migration-control/evidence/mini-pet-grade-combine/slice.json
- 개발환경_고도화/migration-control/scripts/validate-slice-evidence.mjs

## 검증

- 실행 명령: npm run build; npm test; npm run parity:grade-combine
- 결과: TypeScript build 통과, runtime 182 tests 통과, Rhino 보상 풀 151개·guard/order parity 통과
- 실행 명령: db:probe:grade-combine -- --prepare; MariaDB container restart; db:probe:grade-combine
- 결과: 합성 6시나리오, operation/execution/audit/outbox 각 5, 중복 멱등성, 실제 rollback source 2개 보존, restartSafeReplay=true
- 실행 명령: node --check main.js; node --check Info.js; validate-slice-evidence.mjs
- 결과: Rhino 파일 syntax 통과, valid slice evidence: mini-pet-grade-combine

## 충돌·막힘·미승인 사항

- reward 정의 누락 시 DB rollback으로 source를 보존하는 동작은 legacy 메모리 선삭제 위험과 다른 안전 차이이며 parity 승인이 필요하다.
- broad startsWith와 parseInt 접미 허용은 현행 parity로 보존하고 Rhino source는 수정하지 않는다.
- 병렬 migration 036과 app.ts dispatch는 후속 통합 시 병합해야 하지만 이 슬라이스는 migration 번호를 선점하지 않아 번호 충돌은 없다.
- 실제 운영 snapshot 대사, backup/restore, 승인된 실운영방 smoke가 없으므로 Gate 8은 미완료다.

## 다음 행동

1. 이 최종 인계 기록을 push하고 WBS에 원격 커밋을 기록한 뒤 선점을 RELEASED로 닫는다.

## 보안

- 비밀 값, 평문 자격 증명과 불필요한 개인정보를 기록하지 않는다.
