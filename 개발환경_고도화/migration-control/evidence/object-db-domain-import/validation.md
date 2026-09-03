# 오브젝트 도메인 이관 Gate 1~5 검증

- 슬라이스: `SL-DATA-MIGRATION-OBJECT-DOMAIN-IMPORT-01` (WBS742)
- 카탈로그: `SC-20260902-1`
- 검증일: `2026-09-03 KST`
- 범위: 현행 조사, 65개 canonical table별 disposition/소스 매핑, 합성 fixture, 45개 직접 대상 atomic importer, 격리 MariaDB 리허설
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
| importer + object model + disposition focused suite (3 files) | `47/47 PASS` |
| Catalog Projection + importer + object model/disposition focused suite | `59/59 PASS` |
| `npm test` | `1788 PASS / 8 SKIP / 0 FAIL` (`1796` tests) |
| `npm run object-data:validate` | 등록 대상 `73`, PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Gate 판정 경계

- 이 근거는 WBS742 Gate 1(현행 조사), Gate 2(DB 매핑), Gate 3(합성 fixture), Gate 4(domain importer), Gate 5(격리 DB 리허설)를 대상으로 한다.
- Gate 5는 독립 reviewer 판정과 커밋 전 근거이며, 일반 전체 suite의 환경 의존 SKIP 8건을 Gate 5 증거로 대체하지 않는다. 위의 명시적 격리 harness가 별도의 실DB 증거이다.
- 데이터 실이관, consumer parity, Shadow, 운영 배포 완료 근거로 사용하지 않는다.
