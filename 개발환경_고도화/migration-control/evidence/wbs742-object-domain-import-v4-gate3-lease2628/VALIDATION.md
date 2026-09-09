# WBS742 Gate 3 V4 합성 fixture 검증

- Lease: `2628`
- CONTROL: `슬라이스_보고수신!5642`
- 등급: `T2`
- 기준 커밋: `9f909288ba82ff6445e0a781d972153b45ed56f6`
- catalog version: `SC-20260902-1`
- delta ID: `SCD-WBS742-G3-20260909-1`
- evidence schema version: `object-domain-import-gate3-evidence-v1`

읽기 전용 harness와 독립 oracle이 현행 V4 계약을 `119 tables / 47 direct targets / 263 columns / 25 definitions / 49 rows / 272 compared values`로 재계산했다. 49행은 47개 direct target을 한 번씩 포함하고 package graph 검증용 정의·보상 행을 각각 한 번 추가한다.

검증 결과:

- 신규 Gate3 oracle 및 table/target/column/row/version 변조 검증: `2/2 PASS`
- 기존 V2 profile 및 WBS779 V4 reseal 회귀: `12/12 PASS`
- TypeScript typecheck: `PASS`
- TypeScript build: `PASS`
- fixture JSON parse: `PASS`
- `git diff --check`: `PASS`

기존 V1/V2 exact-schema 계약·fixture·test·evidence, WBS779/WBS782 evidence, 공용 aggregate ledger/residual 및 `.codex/checkpoints/object-db-migration.md`는 수정하지 않았다. 운영 DB·운영 데이터·`feature/prod`·Gate8 작업도 수행하지 않았다.
