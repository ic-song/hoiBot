# 오브젝트 데이터 모델 표준

## 목적과 적용 범위

이 문서는 hoiBot의 아이템, 가구, 펫, 미니펫, 장비, 일반 타이틀, 펫타이틀, 미니펫타이틀, 펫스킬, 패키지, 건물, 재화 및 조합법을 데이터베이스로 관리할 때의 단일 기준이다. 신규·변경 오브젝트 관련 테이블, PK/FK, migration, seed, repository, 사용자 보유 데이터와 레거시 이관은 이 문서를 따른다.

목표는 공통 정의값을 한 곳에서 관리하고, 사용자 보유 데이터에는 정의 PK와 사용자별 상태만 남기는 것이다. 따라서 가격·매력·강화 증가값을 바꾸면 정의 행 한 건만 수정하며 사용자 수만큼 보유 행을 순회하지 않는다.

## 최상위 원칙

1. 오브젝트 종류별 전용 정의 테이블을 둔다.
2. 정의 테이블에는 모든 사용자에게 공통인 이름, 설명, 등급, 가격, 기본 수치, 강화 규칙, 확률, 활성 상태를 둔다.
3. 사용자 보유 테이블에는 정의 PK, 수량 또는 인스턴스 PK와 사용자별 상태만 둔다.
4. 이름, 공통 가격, 기본 매력, 공통 등급, 강화 증가값 및 공통 효과를 사용자 보유 행에 복제하지 않는다.
5. 계산 가능한 최종 매력·능력치는 저장하지 않고 정의값과 사용자 상태로 계산한다.
6. 적용 완료된 migration과 검증 증거는 수정하지 않고 새 migration으로 수정한다.

## 정의 테이블 목록

| 테이블 | 한글명 | 관리 대상 |
| --- | --- | --- |
| `item_definitions` | 아이템 정의 | 소비품, 재료, 상자, 티켓, 잡템 |
| `furniture_definitions` | 가구 정의 | 가격, 기본 매력, 강화 증가값 |
| `pet_definitions` | 펫 정의 | 일반 펫의 공통 속성 |
| `mini_pet_definitions` | 미니펫 정의 | 미니펫의 공통 속성 |
| `equipment_definitions` | 장비 정의 | 무기, 방어구, 액세서리 |
| `member_title_definitions` | 타이틀 정의 | 사용자 일반 타이틀 |
| `pet_title_definitions` | 펫타이틀 정의 | 펫 전용 타이틀 |
| `mini_pet_title_definitions` | 미니펫타이틀 정의 | 미니펫 전용 타이틀 |
| `pet_skill_definitions` | 펫스킬 정의 | 스킬 표시·조건·수치·기능 식별 정보 |
| `package_definitions`, `package_rewards` | 패키지·보상 정의 | 묶음 보상과 수량 |
| `building_definitions` | 건물 정의 | 비용, 효과, 단계 수치 |
| `currency_definitions` | 재화 정의 | 포인트, 다이아, 하트 등 |
| `craft_recipe_definitions` | 조합법 정의 | 조합의 이름, 조건, 활성 상태 |
| `craft_recipe_item_inputs`, `craft_recipe_currency_inputs` | 조합 입력 | 소비 아이템·재화 |
| `craft_recipe_item_outputs`, `craft_recipe_currency_outputs` | 조합 출력 | 지급 아이템·재화 |

새 종류는 범용 테이블에 억지로 합치지 말고 같은 규칙의 전용 정의 테이블을 추가한다.

## PK·FK와 식별자

- 단독 `id` 컬럼은 금지한다. PK는 `item_id`, `furniture_id`, `owned_mini_pet_id`, `player_id`처럼 대상이 드러나는 구체명이어야 한다.
- 오브젝트 식별용 `CODE` 컬럼은 금지한다. `ITEM-DIAMOND-BOX` 같은 값은 PK 대체물이 아니다. 표시명도 식별자로 사용하지 않는다.
- 신규 PK는 CUID2 기반 8자리 문자열이며 `CHAR(8) CHARACTER SET ascii COLLATE ascii_bin`을 사용한다.
- 8자리 CUID2는 충돌 가능성이 있으므로 PK 또는 UNIQUE로 충돌을 검출하고, 충돌하면 새 식별자를 생성해 재시도한다. 모든 서비스는 동일한 생성·재시도 정책을 공유한다.
- FK 컬럼명은 참조 PK와 정확히 같아야 한다. 예: `owned_items.player_id → players.player_id`, `owned_items.item_id → item_definitions.item_id`.
- FK와 참조 PK는 이름, 타입, 길이, 문자셋, collation 및 부호 속성이 같아야 한다. 다중 역할 관계의 예외는 설계 검토와 FK 제약으로 명시한다.

## 감사 컬럼과 시간

모든 정의, 보유, 관계, 이력 및 운영 테이블에는 아래 네 컬럼을 둔다.

| 컬럼 | 형식 | 의미 |
| --- | --- | --- |
| `INSERT_USER` | `VARCHAR(100)` | 최초 등록 주체 |
| `INSERT_TIME` | `CHAR(19)` | 최초 등록 시각 |
| `UPDATE_USER` | `VARCHAR(100)` | 마지막 수정 주체 |
| `UPDATE_TIME` | `CHAR(19)` | 마지막 수정 시각 |

시간은 KST(`Asia/Seoul`)의 24시간제 문자열 `YYYY-MM-DD HH:MM:SS`만 사용한다. 최초 insert에서는 두 사용자·시간 컬럼을 같은 값으로 넣고, update에서는 `UPDATE_*`만 바꾼다. DB 기본값만으로 작업 주체를 숨기지 않는다.

## 보유 모델과 계산값

개별 상태가 없는 동일 오브젝트는 수량형 보유를 사용한다. 예: `owned_items(player_id, item_id, quantity)`에 `(player_id, item_id)` UNIQUE를 둔다.

강화, 경험치, 장착, 귀속, 별명, 내구도 등 개별 상태가 있거나 같은 정의 오브젝트 중 특정 개체를 선택해야 하면 인스턴스형 보유를 사용한다. 예: `owned_mini_pets(owned_mini_pet_id, player_id, mini_pet_id, enhancement_level, ...)`. 같은 미니펫을 한 사용자가 N개 보유해도 각 행의 `owned_mini_pet_id`는 다르고 `mini_pet_id`는 같다.

가구의 최종 매력은 다음처럼 계산한다.

```text
최종 매력 = furniture_definitions.base_charm
          + (owned_furniture.enhancement_level × furniture_definitions.charm_per_enhancement)
```

증가값이 단계별로 다르면 `furniture_enhancement_levels` 같은 단계 정의 테이블에 둔다. 사용자 보유 행에는 현재 강화 단계만 저장한다. 불필요한 비즈니스 `version` 컬럼이나 정의값 스냅샷은 두지 않는다.

## 이름·펫스킬·조합법

레거시 표시명은 공백, 이모지, 괄호, 명령 안내까지 원문 그대로 보존한다. 예를 들어 `다이아상자💎(/다이아상자오픈)` 전체가 아이템명이다. 다만 표시명 파싱으로 명령을 실행하지 않고 별도 명령 연결 또는 안전한 라우팅으로 처리한다.

펫스킬 정의에는 스킬명·설명, 사용 가능 명령 또는 기능 식별 정보, 보유 조건, 옵션 종류·값, 확률·배율·횟수·쿨다운, 활성 상태를 저장할 수 있다. 명령 파싱, 권한 검증, 실제 효과, 트랜잭션, 차감·지급, 메시지·복구는 코드에 둔다. DB에는 실행 가능한 JavaScript, SQL, 임의 스크립트를 저장하지 않는다.

조합법은 정의, 아이템/재화 입력, 아이템/재화 출력으로 분리한다. 범용 조합 처리는 요청 수량 검증, 총 입력 계산, 잠금 또는 동시성 안전 보유량 검증, 한 트랜잭션의 차감·지급, 원장·outbox 기록 순서를 따른다. 안내 문구도 같은 정의 데이터에서 생성한다.

## migration·seed·이관·배포

- schema 변경은 새 migration으로만 수행하며 운영 DB에서 임의 DDL을 실행하지 않는다.
- 레거시 이관은 `RAW Landing → Common Staging → Catalog Projection → Domain Import → 검증 및 전환` 순서다.
- RAW 원본은 변경하지 않는다. 이름·이모지·공백·괄호를 보존하고, 매핑 불가 데이터는 임의 병합하지 않고 격리한다.
- 정의 seed와 사용자/보유 데이터 import를 분리한다. 정의를 먼저 확정한 뒤 사용자 행이 정의 PK를 참조하게 한다.
- Docker 이미지를 빌드해도 개발 PC DB 데이터가 운영 PC로 자동 복사되지 않는다. 최초 배포는 migration, 정의 seed, 사용자 import, 행수·합계·FK 검증, application start, health 확인 순서다.
- 재배포는 MariaDB 영구 볼륨과 사용자 데이터를 보존한다. seed를 매 시작마다 무조건 덮어쓰거나 DB 볼륨 삭제를 배포 절차에 포함하지 않는다.

## 기계 검증 계약

`개발환경_고도화/migration-control/contracts/object-data-model-standard.v1.json`은 신규 표준 적용 schema의 선언형 manifest다. 신규 오브젝트 migration을 추가할 때 대상 table, PK, FK, 보유 모델, 정의/보유 컬럼 경계를 이 manifest에 함께 등록하고 아래 명령을 통과해야 한다.

```powershell
cd 개발환경_고도화/runtime
npm.cmd run object-data:validate
```

이 validator는 manifest에 등록된 신규 표준 대상만 검사한다. 이미 적용된 001~442 migration은 수정하거나 소급 실패시키지 않는다.

## 금지 요약

```diff
- 단독 id 컬럼
- 오브젝트 CODE 컬럼
- FK 이름·타입 불일치
- 감사 컬럼 누락
- 정의값의 사용자 보유 행 복제
- 계산 가능한 최종 능력치 저장
- 이름을 식별자나 명령 처리 기준으로 사용
- DB에 실행 가능한 JavaScript 또는 SQL 저장
- 적용 완료 migration 수정
- Docker 빌드만으로 DB 데이터가 이전된다고 가정
- 재배포 중 MariaDB 영구 볼륨 삭제
```

다른 문서의 `OBJECT_DATA_MODEL_STANDARD.md 준수`는 이 문서 전체 준수를 뜻한다.
