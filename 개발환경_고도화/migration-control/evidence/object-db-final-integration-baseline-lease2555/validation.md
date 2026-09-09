# 오브젝트 DB 최종 통합 기준선 검증

- Lease: `2555`
- branch: `codex/object-db-final-integration-baseline-v1-20260905`
- base: `3e5cbd48ba94f23277adbb2327fab6c93c6a25b9`
- 범위: 승인된 provider/consumer 성과의 선택 통합과 파생 계약 정합화만 수행했다. 신규 기능, migration, DDL/DML, 운영 JSON/DB, 실방, Gate 8 및 운영 반영은 수행하지 않았다.

## 선택 통합

| 원본 commit | 통합 commit | 결과 |
| --- | --- | --- |
| `10690cf05a9f78e8e1bdf41f86a7b7a65f47be42` | `af361f47` | 적용. `data-migration-object-domain-import.test.ts` 충돌에서 기준선의 pre-466 호환성 검증을 보존했다. 나머지 패치는 기준선에 이미 동등하게 존재했다. |
| `f8a767c33d56a6e07c7930fd1d8a82c0d3cf8246` | `2c663c15` | 적용. 같은 테스트의 최신 semantic hash 정책과 Gate 5/6 fixture count를 함께 보존했다. |
| `cecfd27dc9489b07cd047586dce948e896d1998c` | `9ef18619` | 적용. validation 양쪽 근거를 보존하고, add/add 테스트 2개는 최신 component/contract hash 정책과 Gate 7 combined endpoint 검증을 병합했다. |
| `ab7a347d4572e453b11918fda987bc58c55d4cf1` | `3cc6cf6a` | 무충돌 적용, patch-id 동일. |
| `ab2930a98cdda256bf9c1db066f415eaf892a4b0` | `0ae64e73` | 무충돌 적용, patch-id 동일. |

- `fd3f11a331109d8baeeab093935db9179ee0ce73`는 지시대로 직접 적용하지 않았다. `git cherry HEAD ab7a347d...`에서 `- fd3f11a3`로 확인되어 기준선의 patch-equivalent 성과만 재사용한다.
- 전체 branch merge는 수행하지 않았다.
- 충돌 표식 잔존과 중복 consumer ID는 0이다.

## 통합 정합화

- 기준선의 정령정보 연결로 `runtime/src/app.ts`가 변경된 상태였으므로 canonical-LF SHA-256 `ceb68305f560a8ea47b924694f6dc579a847ce9f93e2271a0fed56d3238da3f9`를 runtime-boundary와 consumer-transition 계약의 해당 파생 필드에만 반영했다.
- 현재 소스에서 consumer manifest 전체를 재생성했다. 총수는 `1,111`, 종류별 count는 불변이며 stable consumer ID는 추가 `0`, 삭제 `0`, 중복 `0`이다. source span뿐 아니라 `observedSqlReadTables`, symbol/trigger, `interfaceId`, `transactionOwnerInterfaceId` 등 생성기가 산출하는 현재 source-derived metadata 전체가 현행화되어 consumer set SHA-256은 `aa543be346efc6916c66c2867a3904dfd39c09409eb9cfa71f3219fee1dab6e0`에서 `f103c427a8e632ada272149529c3dcc740734832c8fadb89c7bd254ae59ff0a1`로 바뀌었다.
- Gate 6 parity 테스트는 최신 importer 계약에 맞춰 component/contract semantic hash와 명시적 pre-466 compatible hash allowlist를 사용하도록 충돌 해결을 보완했다. runtime 동작 변경은 없다.
- 독립 리뷰 P1 보완으로 parity verifier도 importer의 정책 validator를 먼저 적용하고, 저장된 `import_contract_sha256`이 동일 allowlist에 포함되는지 검사한다. import fingerprint는 현재 policy hash로 덮어 계산하지 않고 저장된 계약 identity를 입력으로 재계산한다. current 계약과 pre-466 허용 계약은 각각 성공하고, 임의 계약 hash와 fingerprint drift는 실패하는 계약 테스트를 추가했다.

## 검증

- 선택 focused 묶음: `64/64 PASS`
- 총괄 재실행 집중 묶음: `77/77 PASS` (독립 리뷰 `P0/P1/P2 = 0` 이후 현재 작업 트리에서 재확인)
- P1 관련 importer/parity/catalog focused 재검증: `30/30 PASS`
- consumer manifest 전체 재산출 계약: `11/11 PASS`
- stable consumer ID 계약: 위 focused 묶음 내 `5/5 PASS`
- `npm run typecheck`: PASS
- `npm run build`: PASS
- `npm run object-data:validate`: PASS, 등록 대상 `98`
- 변경 JSON 3개 parse와 `git diff --check`: PASS
- migration 변경: `0`
- 최초 focused 실행의 4개 module-resolution 실패는 전용 worktree에 의존성이 없어서 발생했으며 `npm ci --no-audit --no-fund` 후 해소했다. 최초 typecheck/build가 찾은 Gate 6 테스트 계약 누락도 위 최신 hash 정책 병합으로 해소했고 최종 typecheck/build는 모두 통과했다.
- 전체 `npm test`와 MariaDB 리허설은 실행하지 않았다.

## 잔여 경계

- 이 기준선은 독립 리뷰 전 상태이며 commit/push/Sheets Gate 상향을 하지 않는다.
- 실제 운영 데이터 이관, 운영 cutover, `feature/prod` 반영 및 Gate 8은 별도 승인 범위다.
