# 오브젝트 도메인 이관 Gate 1~7 검증

- 슬라이스: `SL-DATA-MIGRATION-OBJECT-DOMAIN-IMPORT-01` (WBS742)
- 카탈로그: `SC-20260902-1`
- 검증일: `2026-09-03 KST`
- 범위: 현행 조사, 65개 canonical table별 disposition/소스 매핑, 합성 fixture, 45개 직접 대상 atomic importer, 격리 MariaDB 리허설, 독립 projection-target parity oracle, combined Shadow
- 운영 영향: 없음. 운영 DB, 운영 배포, `data/*.json`, `main.js`, `Info.js`를 변경하지 않았다.

## 확정된 결과

- 표준 계약 테이블 `65/65`를 정확히 한 번씩 분류했다.
- 정의 `SEED`, 현재 상태 `IMPORT`, source에서 생성하는 `DERIVE`, 재화 최초 원장 `INITIAL_LEDGER`, 오류 보존 `QUARANTINE`, 전환 후 생성 `RUNTIME_ONLY` 경계를 동결했다.
- 일반 타이틀·펫 타이틀·미니펫 타이틀과 펫스킬을 서로 다른 정의/보유/선택·장착 흐름으로 고정했다.
- 표시명과 legacy CODE를 canonical identity로 사용하지 않고 bundle/payload와 분리한 source locator SHA-256 → CUID2 8자리 crosswalk를 사용한다. 동일 locator의 payload/type drift는 실패하고 exact replay는 쓰기 0건이어야 한다.
- 같은 미니펫·가구·장비 N개는 수량 합산이 아니라 N개의 distinct instance로 유지한다.
- 가구 `exp`는 기본 매력 원천이고 `rate`는 뽑기 확률이므로 강화 증가값으로 사용하지 않는다. JSON에 없는 구매가·강화 증가값은 WBS725 projection이 제공하지 않으면 해당 정의 transaction을 차단한다.
- 보유 가구 5,327건 전수 대조 결과 현 JSON catalog exact unique 3,525건, duplicate ambiguity 87건, missing 1,715건이다. 검증된 `main.js` CODE_SEED가 90건을 해소한다. Git 후보 `82a0373d3666b6afa29912ef9441273d20375266:data/petSweetHomeInfo.json`(SHA-256 `9aa01517393750942992547223445ad0c77f0351d4a6700c05c36bd10cc7e288`)은 재현상 326건/235 signature를 해소하지만 WBS725 승인 전에는 후보일 뿐이다. 이후 잔여 1,299건/789 signature도 WBS725의 provenance·balance 값이 명시된 inactive legacy-recovered definition crosswalk 없이는 격리한다.
- 동일 catalog 행 10개씩으로 구성된 두 가구 signature의 보유 87건은 원본 catalog index가 없어 임의 연결하지 않는다. WBS725가 business definition 병합과 draw multiplicity 분리를 승인하기 전에는 `DEFINITION_REFERENCE_AMBIGUOUS`이다.
- 과거 이력이 완전하지 않은 operation/ledger를 추정 생성하지 않는다. 재화는 현재 잔액 대사를 위한 `INITIAL_IMPORT` operation/ledger만 만든다.
- RAW/Common/Catalog provider가 완료되기 전 WBS742 내부에 임시 staging/projector를 구현하지 않는다.
- 12개 domain mapping이 직접 쓰는 정확히 45개 테이블의 비감사 컬럼 `241/241`을 `TABLE.COLUMN`으로 연결했다. 별도 target-schema 계약은 각 컬럼의 실제 SQL type, nullability, owning migration을 고정한다.
- 45개 직접 대상 PK를 generated CUID binding 40종과 기존 PK 재사용 5종으로 정확히 한 번씩 분류했다. locator, payload fingerprint, run replay key를 분리하고 player graph outer transaction 안에서만 결합한다.
- 타이틀 3종의 `title.num`은 1-based이며 `null|0`은 미선택이다. 장착 미니펫은 가방에서 제거되는 별도 occurrence이므로 `miniPetBag[]`과 합치지 않는다.
- optional 배치 가구 split 파일, embedded fallback, 불완전한 완료 가구 시장 이력, title selection과 pet-skill equipment의 현 schema 한계를 명시해 추정 import를 금지했다.
- 봉인 스냅샷의 미니펫 3,890개 중 JSON catalog의 이름·이모지·등급 exact 후보가 없는 239개와 복수 후보 50개를 확인했다. 모든 보유 행에는 immutable definition locator가 없으므로 display-exact 행도 자동 연결하지 않는다. WBS725가 exact occurrence locator별 crosswalk를 승인한 행만 연결하고 차이값은 nullable `custom_name`·`custom_emoji`에 보존하며 나머지는 격리한다. `member_pet.json`, `miniPetData.json`, `main.js` 비교 원천은 각각 SHA-256으로 봉인했다.
- migration 455의 `acquisition_price`는 신규 legacy import에서 `list[].price`를 정확히 저장한다. 기존 canonical 타이틀 행은 occurrence 가격이 알려지지 않았으므로 NULL을 유지하며 definition 기본가로 역추론하지 않는다.
- item/pet/equipment canonical 소비자는 현재 `ownership_status='owned'`만 활성 보유로 조회하며 다른 상태 literal을 쓰지 않는다. 기존 미니펫 lifecycle과 같은 `owned`, `listed`, `consumed`, `removed` 집합으로 CHECK를 추가해 현재 동작을 보존하면서 잘못된 상태 입력을 차단한다.
- migration `443`~`453`의 domain table set hash를 실제 SQL에서 검증한다. `454`는 crosswalk payload fingerprint, `455`는 타이틀 3종 occurrence별 획득가격, `456`은 미니펫 사용자별 표시 상태와 item/pet/equipment 보유 상태 CHECK를 보완하며 table set은 바꾸지 않는다.
- WBS724 Common Staging과 WBS725 Catalog Projection의 COMPLETE run, source decision/count coverage, quarantine/ignore 경계 및 projection record를 읽고, importer 내부에서 source locator/payload와 decision/record fingerprint를 다시 계산한다.
- migration 458 projection manifest identity와 migration 459 upstream envelope identity를 별도 해시로 검증한다. 구 migration 458 run의 manifest hash를 새 envelope로 해석하지 않는다.
- 합성 fixture는 정확히 45개 직접 대상 테이블과 241개 비감사 필드를 47개 projection row로 모두 포함하며, 23개 정의/규칙 대상을 ownership보다 먼저 기록한다. 패키지 item/nested typed extension은 서로 다른 reward entry를 사용하고 nested package graph는 비순환이다.
- 동일 locator의 CUID2 binding은 target type, payload, origin, reference approval까지 포함한 fingerprint로 고정한다. reused PK 5종은 manifest source identity 또는 승인 crosswalk만 허용한다.
- importer는 identity binding, canonical target, import run/decision/record 영수증을 하나의 outer transaction에서 기록한다. 중간 target 실패 시 모두 rollback하고, exact replay는 기존 영수증의 전수 coverage, projection별 import order, identity PK, binding/row fingerprint 및 canonical 전체 값을 재검증한 뒤 쓰기 0건으로 끝난다.
- unknown target/column, SQL type/nullability/range·DB CHECK 위반, projection drift, quarantine 전파, cross-owner relation, 실행 가능한 펫스킬 option은 canonical write 전 fail-closed 처리한다. 펫스킬 장착은 동일 사용자·동일 스킬의 양수 보유 stack을 요구하고, 타이틀 3종 selection의 reused player PK도 implicit owner로 대사한다.
- 가구 구매가/매력/강화 증가값, 미니펫 occurrence와 BAG/EQUIPPED, 타이틀 3종 획득가 provenance, 펫스킬 handler/options, 재화 `INITIAL_IMPORT` baseline, 건물 중복 floor 첫 행 우선 정책을 domain validation으로 강제한다.
- migration 460은 import run/decision/record 영수증 3개 테이블을 추가하며, rollback은 import_order 역순으로 canonical target을 삭제하고 upstream projection과 reusable identity provenance는 보존한다.
- target-schema fingerprint는 WBS725가 공개한 canonical semantic JSON SHA-256 helper를 사용한다. 파일의 LF/CRLF 차이는 동일 해시이며 raw file-byte SHA-256은 사용하지 않는다.
- rollback은 삭제 전에 모든 영수증을 frozen 45-table allowlist, 정확한 PK, 원본 projection target/locator와 전수 대사한다. 정상 테이블·PK로 redirect된 영수증도 첫 DELETE 전에 실패한다.
- Gate 5 harness는 운영 3306과 분리된 `127.0.0.1:3321`의 새 MariaDB 12.2 datadir 및 allowlist DB `hoibot_rehearsal_wbs742_gate5`만 사용한다. 실행 전 포트 미사용, listener PID 소유권, 정확한 임시 경로를 검사하고 종료 시 환경 변수 복원, listener 종료, 임시 datadir 삭제 및 3306 listener 소유권 불변을 검증한다.
- 새 DB에 migration 448개(`001`~`460`, 병렬 번호 포함)를 전부 적용했다. 강제 중간 실패는 target/identity/crosswalk/import receipt를 모두 0건으로 원자 rollback했으며, 정상 실행은 12 source decision의 47 projection row를 45개 직접 target에 적재했다.
- MariaDB를 PID `21672`에서 종료하고 새 PID `10660`으로 재시작한 뒤 동일 projection을 실행했다. global `Com_insert/update/delete/replace`가 모두 `0→0`이고 canonical/identity/receipt/upstream count도 전혀 바뀌지 않은 exact replay 0-write를 확인했다. 이후 47 receipt를 역순 rollback하여 45 target의 47행을 0행으로 만들면서 identity/crosswalk `42/42`와 upstream projection `1/12/47`을 보존했다.
- `-ForceStartupFailure` 반례는 process 생성 직후 의도적으로 실패(exit `1`)시켰으며, 상위 소유 handle로 정확한 프로세스를 종료한 뒤 3321 listener `0`, 임시 datadir 없음, 운영 3306 PID `5328` 불변을 확인했다. cleanup 단계별 오류가 발생해도 환경 변수 복원은 독립적으로 끝까지 수행된다.
- 최초 재시작 대사에서 `canonical_mini_pet_enhancement_rules.success_probability`의 projection 값 `1`과 MariaDB `DECIMAL(12,10)` 저장값 `1.0000000000` 차이를 검출했다. importer는 expected/actual 양쪽에 동일 SQL-type canonical 비교를 적용하며 DECIMAL은 부동소수 변환 없이 문자열로 scale만 정규화하고, INTEGER·BOOLEAN·JSON도 대칭 변환한다. 실제 값 차이는 계속 drift로 실패한다.
- Gate 5와 Gate 6의 source decision 수치는 서로 다른 목적의 새 격리 DB fixture이다. Gate 5의 `completeInput`은 `PROJECT 12 / QUARANTINE 0 / IGNORE 0`, projection record `47`이며 rollback 뒤 upstream `run/decision/record=1/12/47`을 보존한다. Gate 6의 `withQuarantineAndIgnore`는 같은 47개 PROJECT record를 생성하는 `PROJECT 12`에 0-row `QUARANTINE 1`, 0-row `IGNORE 1`을 추가하여 source decision `14`(`12/1/1`)를 검증한다. Gate 5 DB에서 decision이 늘어난 것이 아니며 verifier가 임의 기대값에 맞춘 것도 아니다.
- Gate 6 oracle은 importer의 `verifyReplay` 또는 import plan builder를 호출하지 않는다. projection record, identity locator와 generated/reused binding, manifest/approved-crosswalk FK를 독립 해석하고 45개 실제 target table의 241개 비감사 schema field를 전수 조회하여 47개 행의 250개 field value를 대사한다.
- 최신 격리 실행의 projection canonical hash와 target canonical hash는 `6e3716a93bcfb8792a2cccc75b52cfe227508e3ff6080707a859184679771ef2`로 같고 row diff는 `0`이다. 생성 CUID를 포함하므로 실행 간 고정 상수로 취급하지 않고 같은 실행의 양쪽 hash 동일성으로 판정한다. 45개 table별 count도 모두 일치하며 package definition/reward entry 2개 테이블은 각 2행, 나머지 43개 테이블은 각 1행이다.
- oracle은 persisted projection run의 target schema, projection, upstream envelope, manifest hash와 import run의 projection, upstream, schema, import contract, import hash를 독립 재계산·상호 대사한다. identity/object-model/disposition/field-map 네 component semantic hash도 상위 import contract의 동결값과 정확히 일치해야 하며, 각 persisted hash와 component drift 반례는 fail-closed 된다.
- definition/ownership 순서는 마지막 definition import order `24`, 첫 non-definition import order `25`로 전수 대사했다. import run은 정확히 1개이고 receipt 47개의 projection ID, target PK, dense order, uniqueness를 독립 검증한다.
- receipt의 `identity_locator_sha256`, `binding_fingerprint`, `imported_row_fingerprint`도 projection identity와 독립 재계산한 canonical payload/reference fingerprint에 정확히 결박하며 두 fingerprint/locator 변조 반례는 fail-closed 된다. compared field value `250`은 fixture와 테스트 assertion에 고정했다.
- positive parity 실행 전후 MariaDB global DML counter는 `Com_delete=76`, `Com_insert=2028`, `Com_replace=0`, `Com_update=97`로 모두 불변하여 verifier 자체 write `0`을 확인했다.
- 실제 DB transaction 안에서 target 누락, extra row, 값 drift, 유효한 다른 FK로 redirect, decision status/count drift, definition/ownership import order swap의 6개 반례가 각각 fail-closed 되었고 transaction rollback 뒤 clean parity를 다시 확인했다.
- Gate7의 WBS724 및 WBS725 provider Shadow는 각각 synthetic 1-row 범위이며 운영 전체 데이터 proof로 해석하지 않는다. WBS724은 Raw 1 file→Common 3 records→Projection 1 row(`PROJECT/QUARANTINE/IGNORE=1/1/1`), WBS725는 Common 3→Projection 1→canonical 1을 증명한다.
- actual production-like snapshot 13개 파일은 read-only inventory만 수행했다. source aggregate SHA-256은 `351e4a2a9bce402d652897355606c12fb77b004b0f626d35c01e4627464e3284`, inventory SHA-256은 `e2920422f0076b89cd9385d785cd48e198e578dd4d56e957c5e549250cef48de`이며 전후 byte hash가 같다. PII나 raw payload는 증빙에 기록하지 않았다.
- actual inventory 분류는 가구 `unique candidate 3,525 / missing quarantine 1,715 / ambiguous quarantine 87`, 미니펫 `unique candidate 3,601 / missing quarantine 239 / ambiguous quarantine 50`이다. unique candidate는 승인된 identity가 아니며, 승인된 occurrence crosswalk가 없으므로 actual PROJECT는 `0`이다. 미해결·모호 값과 승인 전 unique candidate 모두 fail-closed 경계를 유지한다.
- 동일 fresh MariaDB `127.0.0.1:3323`, allowlist DB `hoibot_rehearsal_wbs742_gate7`에서 migration 448개와 provider synthetic 체인 다음 WBS742 full 47→45 control을 실행했다. 독립 oracle은 재시작 전후 projection/target `47/47`, tables `45`, schema fields `241`, compared values `250`, definition order `24<25`, canonical hash 동일, diff `0`, verifier DML `0`을 확인했다.
- importer restart replay의 global DML은 정확히 0이고 rollback 후 canonical target은 0이다. upstream projection `run/decision/record=1/14/47`과 identity/crosswalk `43/43`은 보존됐다. Maria PID는 `17400→17168→11048→7548`로 매 재시작마다 바뀌었다.
- harness 정상 종료와 forced startup failure 모두 `WaitForExit` 결과와 `Refresh().HasExited`를 확인하고 모든 captured owned PID가 사라졌음을 전수 검사했다. 3323 listener 및 exact `.tmp/wbs742-gate7-mariadb`를 제거하고 환경을 복원했으며, 모든 정상·실패 cleanup 이후 운영 3306 listener PID set `5328` 불변을 검증했다.

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `node --import tsx --test test/object-domain-import-disposition.test.ts test/object-domain-import-field-map.test.ts test/object-domain-import-target-schema.test.ts test/object-domain-import-source-semantics.test.ts` | `18/18 PASS` |
| `node --import tsx --test test/object-domain-import-target-schema.test.ts test/owned-object-state-hardening-migration.test.ts test/mini-pet-definition-binding-semantics.test.ts test/object-domain-import-field-map.test.ts test/object-data-model-contract.test.ts` | `35/35 PASS` |
| Gate 1·2 전체 focused 계약·source semantics·migration suite (10 files) | `57/57 PASS` |
| `node --import tsx --test test/data-migration-object-domain-import.test.ts` | `24/24 PASS` |
| Gate 5 prepare / restart replay-rollback (각 importer 24 + integration 1) | `25/25 PASS`, `25/25 PASS` |
| `scripts/rehearse-object-domain-import-gate5.ps1` | `GATE5_HARNESS_PASS`, port `3321`, PID `21672→10660`, replay DML `0→0`, 3306 unchanged, exit `0` after cleanup |
| Gate 5 forced startup failure cleanup | expected exit `1`; 3321 listener `0`, temp 없음, 3306 PID `5328` unchanged |
| Gate 6 prepare / independent parity oracle | importer `25/25 PASS`; oracle `2/2 PASS`; source decisions `14=12 PROJECT+1 QUARANTINE+1 IGNORE`, records/targets `47/47`, tables `45`, fields `241`, compared values `250`, diff `0` |
| `scripts/rehearse-object-domain-import-gate5.ps1 -Mode Gate6` | migration `448`, `GATE6_HARNESS_PASS`, port `3321`, PID `13016`, verifier DML counters unchanged, 3306 PID `5328` unchanged, exit `0` after cleanup |
| importer + Gate 6 oracle contract + object model + disposition focused suite (4 files) | `48/48 PASS` |
| Catalog Projection + importer + Gate 6 oracle contract + object model/disposition focused suite | `60/60 PASS` |
| `npm test` | `1789 PASS / 8 SKIP / 0 FAIL` (`1797` tests) |
| `npm run object-data:validate` | 등록 대상 `73`, PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Gate7 actual snapshot read-only inventory | 13 files, byte hash unchanged, approved PROJECT `0`, furniture candidate/missing/ambiguous `3525/1715/87`, mini-pet `3601/239/50` |
| `scripts/rehearse-object-domain-import-gate7.ps1` | migration `448`, provider synthetic `1-row` chains, full `47→45`, oracle diff `0`, restart replay DML `0`, rollback/upstream/identity preservation, 3323/3306 safety PASS |
| Gate7 forced startup failure cleanup | expected failure; 3323 listener `0`, exact temp 없음, environment restored |
| Gate7 focused snapshot/provider parity | `4/4 PASS` |
| Gate7 전체 `npm test` | `1793 PASS / 8 SKIP / 0 FAIL` (`1801` tests) |

## Gate 판정 경계

- 이 근거는 WBS742 Gate 1(현행 조사), Gate 2(DB 매핑), Gate 3(합성 fixture), Gate 4(domain importer), Gate 5(격리 DB 리허설), Gate 6(독립 데이터 parity), Gate 7(combined Shadow)을 대상으로 한다.
- Gate 5는 독립 reviewer 판정과 커밋 전 근거이며, 일반 전체 suite의 환경 의존 SKIP 8건을 Gate 5 증거로 대체하지 않는다. 위의 명시적 격리 harness가 별도의 실DB 증거이다.
- Gate 6는 합성 projection과 canonical target의 데이터 parity 근거이다. 운영 데이터 실이관, consumer command parity, Shadow, 운영 배포 완료 근거로 사용하지 않는다.
- Gate 7도 실제 snapshot 전체를 canonical target에 적재했다는 근거가 아니다. 실제 snapshot은 read-only aggregate inventory이며, full 47→45 parity는 비식별 합성 control이다. 운영 실이관·Gate8·배포 근거로 사용하지 않는다.
