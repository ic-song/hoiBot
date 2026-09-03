# 오브젝트 도메인 이관 Gate 1·2 검증

- 슬라이스: `SL-DATA-MIGRATION-OBJECT-DOMAIN-IMPORT-01` (WBS742)
- 카탈로그: `SC-20260902-1`
- 검증일: `2026-09-03 KST`
- 범위: 현행 조사와 65개 canonical table별 import disposition/소스 매핑
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

## 검증 결과

| 검증 | 결과 |
| --- | --- |
| `node --import tsx --test test/object-domain-import-disposition.test.ts test/object-domain-import-field-map.test.ts test/object-domain-import-target-schema.test.ts test/object-domain-import-source-semantics.test.ts` | `18/18 PASS` |
| `node --import tsx --test test/object-domain-import-target-schema.test.ts test/owned-object-state-hardening-migration.test.ts test/mini-pet-definition-binding-semantics.test.ts test/object-domain-import-field-map.test.ts test/object-data-model-contract.test.ts` | `35/35 PASS` |
| Gate 1·2 전체 focused 계약·source semantics·migration suite (10 files) | `57/57 PASS` |
| `npm run object-data:validate` | 등록 대상 `65`, PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS |
| `git diff --check` | PASS |

## Gate 판정 경계

- 이 근거는 WBS742 Gate 1(현행 조사)과 Gate 2(DB 매핑)만 대상으로 한다.
- Gate 3 합성 fixture와 Gate 4 domain importer 구현은 WBS724 Common Staging 및 WBS725 Catalog Projection Gate 4 완료 후 수행한다.
- 데이터 실이관, consumer parity, Shadow, 운영 배포 완료 근거로 사용하지 않는다.
