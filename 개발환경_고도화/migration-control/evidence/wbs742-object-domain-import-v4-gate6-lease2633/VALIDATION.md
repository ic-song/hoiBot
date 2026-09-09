# WBS742 Gate 6 V4 독립 데이터 parity 검증

- Lease: `2633`
- CONTROL: `슬라이스_보고수신!5642`
- 기준 커밋: `13e404f614b5e7315afadb9fd9734532621c2242`
- catalog version: `SC-20260902-1`
- delta ID: `SCD-WBS742-G6-20260909-1`
- evidence schema version: `object-domain-import-gate6-evidence-v1`

공용 parity verifier의 V1 고정 수치 47/45/241/23을 호출자가 제공하는 trusted expectations로 최소 일반화했다. persisted run과 rows에서 예상 수를 추론하지 않는다. V1 호출은 봉인된 47 rows, 45 targets, 241 fields, 23 definitions, 250 compared values를 전달하고 V4 호출은 49/47/263/25/272를 전달한다. 잘못된 V1 target 수는 DB read 전에 거부됐고 잘못된 V4 projection row 수는 persisted run 대사에서 거부됐다.

전용 `127.0.0.1:3365/hoibot_rehearsal_wbs742_v4_gate6`에 migration 480개를 fresh 적용했다. 실제 importer 결과를 대상으로 persisted projection, generated/reused identity와 crosswalk, FK binding, 47개 target table의 49행, 263 schema fields, 272 field values를 독립 조회했다. projection과 target SHA-256은 모두 `8bc4eb01ca082a6448b26eb148c9ccc27f3d4bcd3f5408218226842dd89ce536`였고 row diff는 0이다.

positive verifier 전후 MariaDB global insert/update/delete/replace counter는 불변이었다. DB drift는 target value, import record identity locator, persisted projection fingerprint 3종을 각각 fail-close했다. 각 transaction rollback 뒤 마지막 positive parity가 다시 통과했다. expectation tamper 1종과 DB drift 3종은 별도로 집계했다.

검증 결과:

- isolated MariaDB V4 parity: `PASS`
- V1·V2·V4 focused regression: `22/22 PASS`
- TypeScript typecheck/build: `PASS`
- PowerShell parser, diff check, secret scan, strict UTF-8 decode: `PASS`
- 실행 후 3365 listener 제거 및 운영 3306 PID `4872` 불변: `PASS`

기존 V1 parity 의미와 evidence, Gate1~5 evidence, WBS779/WBS782 evidence, importer, CLI, migrations, 공용 ledger/residual을 보존했다. 운영 DB·운영 데이터·`feature/prod`·Gate8은 변경하지 않았다. Gate7 구현·증빙과 판정은 독립 reviewer가 수행한다.
