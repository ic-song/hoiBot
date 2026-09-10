# WBS799 Wave32 correction checkpoint

- 작업 키: `object-db-wave32-wbs799-correction`
- 표시 이름: `SL-MEMBER-TITLE-LEGACY-INFO-READ-PARITY-01`
- 실행 프로필/등급: `STANDARD_CONSUMER / T1`
- consumer: `legacy-798257cac0e93e27`
- Lease: `Lease2660`
- worktree: `C:\Users\user\.codex\worktrees\w799\hoiBot`
- branch: `codex/object-db-wave32-member-title-legacy-info-read-parity-v1-20260910`
- correction base: `691eec82dbbf6c5ed604cbb33e0b8c112e2fe127`
- committed executable evidence: `33852aa0abe42d56ec71983565cebc17b4d0a254`
- 마지막 갱신: `2026-09-10 14:30:07 KST`
- 상태: `Gate 3~6 correction 검증 완료`
- 운영 자산: 변경 없음
- Gate 8: `FALSE`, 수행하지 않음

## correction과 실제 실행

- committed `main.js`의 `/타이틀정보` 분기 선두 `if (castleSiegeFlag) return;`을 source oracle로 사용했다.
- `PlayerTitleReadService.read()` transaction 첫 query에서 `guild_territory_wars WHERE active=TRUE`를 잠금 조회하고, 활성 row가 있으면 actor·title·operation·outbox 처리 전에 `null`을 반환한다.
- 실제 `buildApp` Iris ingress와 실제 `PlayerTitleReadService`를 사용한 동일 입력 5개가 committed legacy branch/helper와 exact reply parity를 통과했다.
- siege-active `NEGATIVE_GUARD`는 legacy/modern 모두 `NO_REPLY`, MODERN route 및 service invocation 1회를 확인했다.
- 모든 시나리오에서 source-domain DML `0`; 실행 감사·outbox DML만 transaction `COMMIT`으로 관찰했다.
- `RESTART_CONSISTENCY`는 서로 다른 child process ID와 module UUID에서 reply/result 동일성을 확인했다.
- `main.js`와 `runtime/src/app.ts`는 correction base 대비 diff `0`이다.

## 확정 수치

- receipts: `387` (`Wave31 382 + Wave32 5`), file SHA-256 `7272abf6957451483ba76e09e0eade87d3743d1941f233cf79f3387f76602163`
- ledger: manifest/entries `1133/1133`, DIRECT `55`, EQUIVALENT `12`, proven `67`, STATIC `984`, BLOCKED `82`
- ledger entrySet SHA-256: `44b864278ec996c34d13ee287d4c067190f6174a0b5160a2039676ea513a7bbe`
- ledger file SHA-256: `39a52d6be2fa1c99997dfd861e96e8ade06ab114aeca08ea58314527fcc2d5e3`
- residual: total `1066`, C_DIRECT_EXECUTION `984`, D_PREREQUISITE `82`, MEMBER-TITLE `18`
- residual file SHA-256: `86355b965ab32d1fb1b57270c9a6214aff052bb0cb1d0d1eac109bf58996d356`

## 불변 prefix

- prefix 243: bytes `970854`, SHA-256 `e21eeacea4c7c9b3fb733a349b928e0d1248579ddbb2cf770e20b1b0fd0b5f97`
- prefix 324: bytes `1260829`, SHA-256 `72522ab348255c339dc2e4918fac6ab1702643e6ba8725b99e74ab3457b35adb`
- prefix 352: bytes `1361204`, SHA-256 `70fca768ac020cc1b8dcbceb221c0beeba927e2b16e7bfc32ad09677b95cec5b`
- prefix 362: bytes `1382594`, SHA-256 `5cf3063b351bc18a343b075997dead5769cde57d7a8854218c7b89e3abed7373`
- prefix 372: bytes `1485238`, SHA-256 `f9b490aaea9ea67ece2188fcc1424b1c46c36871606d525ce1c0620a2d818546`
- prefix 382: bytes `1588071`, SHA-256 `df05843c2df41428086464814adab831961f78d784100b5e9eda962cc106b506`

## 주요 파일 SHA-256

- main.js: `91bd1c772aeb0979359ff2af86320850b77a738c1ddee295ae843ca5bcb10495`
- app.ts: `0d5f3da935e027a6e17b219e35524041c3b50beff1e220412425238aec8d14b8`
- contract: `cbaf8bfc0ef150840d9d6fef7109ec8c9b2db5a3c636eae5a324ee6f0fe2c189`
- harness: `11b922ab216a8940a7e8bfca645ac2dfef49f4c92b828b54dbb6ef00a8bb1617`
- target: `56478c95c81083030642a93ef7b0b38bdfab9fed41cfc2a07cd9a376c65c8274`
- player-title-read-service.ts: `b57e9d19275d7f7adf2e18b085054490f49ead8815b943a7c086d70113c644a8`
- ledger validator source: `dd25fd0cd72f492d7ffb620d90b189db1c1765d7f0f20380f90cb3ecc7ac96a9`
- generator: `fb50ec3d8ffc4f292733ba530069e2657de1a49c6626570898e1d655a8cafcb3`
- Wave32 focused test: `8e4b8e247179fe2a0264a25ffae4e2867d1a143bc98bb774c63a75c059917f48`
- player-title focused test: `4cd490cddd232e69c9ba9108cff855cb1dc018ca935aa93c958a695c54444f90`
- 기존 blocker observation은 수정하지 않았다.

## 실행 명령과 결과

- `node --import tsx scripts/generate-object-db-consumer-executable-parity-wave32-member-title-legacy-info.ts 33852aa0abe42d56ec71983565cebc17b4d0a254`: exit `0`, `PASS`, preserved `382`, added `5`, total `387`.
- `node --import tsx scripts/build-object-db-consumer-executable-parity-ledger.ts`: exit `0`, 목표 coverage exact.
- `node --import tsx scripts/build-object-db-consumer-residual-work-plan.ts`: exit `0`, residual `1066(C984/D82)`, MEMBER-TITLE `18`.
- `node --import tsx scripts/validate-object-db-consumer-executable-parity-ledger.ts`: exit `0`, `AJV2020_STRICT_PASS`, receipt schema strict PASS, actual Wave32 replay PASS.
- `node --import tsx --test test/player-title-read.test.ts test/object-db-consumer-executable-parity-wave30.test.ts test/object-db-consumer-executable-parity-wave31.test.ts test/object-db-consumer-executable-parity-wave32.test.ts test/object-db-consumer-residual-work-plan.test.ts`: exit `0`, `17/17 PASS`.
- `node --import tsx scripts/build-object-db-consumer-residual-work-plan.ts --check`: exit `0`, deterministic current.
- `npm run typecheck`: exit `0`.
- `npm run build`: exit `0`.
- `git diff --numstat 691eec82dbbf6c5ed604cbb33e0b8c112e2fe127 -- main.js 개발환경_고도화/runtime/src/app.ts`: 출력 없음.

## 제한과 인계

- 운영 DB/data/3306, migration, `feature/prod`, Gate 8, Google Sheets는 수정하거나 실행하지 않았다.
- Gate 7은 현재·이전 구현 및 evidence 작성자가 아닌 독립 검수자가 판정한다.
