# WBS737 타이틀 도메인 Gate 1~4 evidence

## 범위와 기준

- 카탈로그: `SC-20260902-1`
- 대상: 일반 타이틀, 펫타이틀, 미니펫타이틀
- 기준: `docs/database/OBJECT_DATA_MODEL_STANDARD.md`
- migration: `448_canonical_title_domains.sql`
- 공용 dependency: `443_object_identity_audit_provider.sql`, `444_canonical_item_inventory.sql`의 `canonical_players(player_id)`
- 제외: 운영 JSON 수정, 운영 DB 적용, Rhino consumer 전환, 실사용자 Shadow

## Gate 1 현행 조사

검색어: `타이틀`, `펫타이틀`, `미니펫타이틀`, `memberTitlePath`, `petTitlePath`, `miniPetTitlePath`, `ensureTitleUser`, `addTitle`, `title.list`, `title.num`, `saveJsonFile`.

확인한 저장소와 형태:

- 일반: `data/member_title.json` → `member[user].title.list[{name,inDate,price}]`, 현재 선택은 `title.num` 1-base index
- 펫: `data/pet_title.json` → 동일 형태. 특정 펫 인스턴스가 아니라 사용자 단위로 저장하고 현재 펫 정보에 표시
- 미니펫: `data/miniPet_title.json` → 동일 형태. `miniPetCollectionInfo.titles[stage]`에서 정의된 단계 보상과 관리자 임의 지급이 공존

읽기 전용 snapshot 구조 대사:

| 도메인 | 사용자 행 | 보유 인스턴스 | 고유 이름 | 선택값 보유 사용자 |
| --- | ---: | ---: | ---: | ---: |
| 일반 | 1,321 | 4,431 | 1,532 | 188 |
| 펫 | 145 | 538 | 518 | 131 |
| 미니펫 | 34 | 102 | 25 | 34 |

소비자:

- 일반: `/타이틀`, `/타이틀목록`, `/타이틀정보`, `/타이틀판매`, `/타이틀지정판매`, `/타이틀선물`, 관리자 지급·제거, 낚시·펀치·이벤트 자동 지급
- 펫: `/펫타이틀`, `/펫타이틀목록`, `/펫타이틀이름`, `/펫타이틀판매`, 관리자 지급·제거·동기화, 펫정보 표시
- 미니펫: `/미니펫타이틀`, `/미니펫타이틀목록`, `/미니펫타이틀판매`, 관리자 지급·제거, 미니펫 컬렉션 단계 자동 지급, 미니펫정보 표시

save flow:

- 각 도메인은 전용 path로 `loadJsonFile`한 뒤 선택·지급·제거·판매 성공 시 같은 path에 `saveJsonFile`한다.
- 타이틀 선물·펫타이틀 이름생성·판매·미니펫타이틀 판매는 멤버 가방/포인트도 함께 변경한다. DB consumer 전환 시 타이틀·아이템·재화를 하나의 transaction으로 묶어야 한다.
- 미니펫 컬렉션 완료는 collection, title, member item, pet data를 함께 변경하므로 후속 consumer transaction 경계에서 가장 큰 위험이다.

불확실/후속 확인:

- 임의 타이틀은 생성 이벤트별 정의로 보고 source crosswalk로 식별한다. 동일 표시명이라도 원천·판매 기준이 다르면 임의로 합치지 않는다.
- 펫타이틀을 특정 `owned_pet_id`에 묶을 근거는 현행 JSON/소비자에서 확인되지 않았다. 현행 parity를 위해 `player_id` 단위로 모델링했다.
- `ensureTitleUserData`와 `ensureTitleUser`, 개별 자동 지급 블록에 중복 로직이 있지만 이 슬라이스에서 Rhino source는 변경하지 않았다.

## Gate 2 DB 매핑

각 도메인은 다음 3개 테이블을 가진다.

1. `canonical_*_title_definitions`: `title_name`, `base_sale_price`, `active_flag`
2. `canonical_owned_*_title_instances`: `player_id`, 정의 FK, `acquisition_sequence`, `acquired_time`, `ownership_status`
3. `canonical_*_title_selections`: 사용자별 현재 선택한 owned-title FK

정의값은 보유 테이블에 복제하지 않았다. selection의 `(owned_*_title_id, player_id)` 복합 FK로 타인 보유 타이틀 선택을 DB에서 차단한다. 동일 정의를 여러 사용자가 참조하며, 정의 갱신은 보유 행 순회 없이 한 행만 변경한다.

## Gate 3 합성 fixture

- `canonical-title-domains-v1.json`
- 실사용자 정보 없이 한글·이모지, 공유 정의 2인 보유, 도메인별 선택, 획득 순서·시각 보존을 고정한다.
- 운영 snapshot은 수정하거나 fixture로 복사하지 않았다.

## Gate 4 구현

- 공용 CUID2 8자/object identity provider를 사용한 정의 등록과 보유 지급
- source locator/request key replay 시 기존 PK 재사용, 다른 payload는 conflict
- 정의 변경은 정의 행만 UPDATE
- 보유자 일치를 잠긴 뒤 사용자별 현재 선택 UPSERT
- 판매/제거는 선택 관계 정리와 ownership status 변경을 하나의 transaction에서 수행
- 정의 JOIN으로 현재 이름·판매 기준가를 조회

## 검증 및 Gate 결과

- Gate 1: 완료 — source, helper, JSON, save flow, consumer 조사
- Gate 2: 완료 — 9테이블, PK/FK/감사/KST/정의-보유 경계 contract
- Gate 3: 완료 — 비식별 합성 fixture
- Gate 4: 완료 — additive migration, manifest, repository, unit/contract tests
- Gate 5: 미완료 — Wave2 integration DB에 448 적용, 이관/소비자 dispatch 미연결
- Gate 6: 미완료 — 운영 snapshot 합계·선택·판매 transaction parity 미검증
- Gate 7: 미완료 — Shadow 미수행
