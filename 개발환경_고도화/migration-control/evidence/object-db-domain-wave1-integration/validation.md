# 오브젝트 DB화 Wave 1 중앙 통합 검증

- 검증일: 2026-09-03 KST
- 기준선: `47d84abde86c9aeca06fa8698c4cdc0f5ce70823`
- 통합 브랜치: `codex/object-db-domain-wave1-integration-v1-20260903`
- 대상: WBS733 아이템·가방, WBS734 가구·홈, WBS735 펫·장비의 Gate 1~4 산출물
- 운영 영향: 없음. 운영 DB와 운영 배포는 사용하지 않았다.

## 통합 범위

- migration `443`, `444`, `445`, `446`, `450`을 중앙 manifest에 직렬 등록했다.
- 공용 사용자 PK는 `canonical_players.player_id` 하나만 사용한다.
- 계약 등록 대상은 22개 테이블이며 각 테이블에 `INSERT_USER`, `INSERT_TIME`, `UPDATE_USER`, `UPDATE_TIME`을 둔다.
- 정의값과 사용자 보유값을 분리하고, 가구 매력은 정의의 기본값·강화 증가값과 보유 인스턴스의 강화 단계로 계산한다.

## 실제 MariaDB 검증

격리된 일회용 `mariadb:11.4` 컨테이너와 빈 DB에서 수행했다.

- 전체 migration 적용: 성공, migration count `435`
- 같은 DB에 migration 재실행: 성공, migration count `435`
- 등록 대상 테이블: `22/22`
- 필수 감사 컬럼: `88/88`
- 등록 대상 FK: `35`; FK 원본·참조 컬럼 타입/문자셋/collation 불일치 `0`
- 다른 사용자의 장비를 펫에 장착하는 교차 소유 INSERT: FK `fk_canonical_owned_pet_equipment_equipment`로 거부
- `2026-09-03 25:00:00` 감사시간 INSERT: CHECK `chk_object_furniture_market_insert_time`으로 거부
- 취소된 가구 매물 이력을 보존한 뒤 같은 가구를 재등록: 성공, 과거 `cancelled` 1건과 현재 `active` 1건 확인
- 같은 가구의 두 번째 활성 매물 transaction: UNIQUE `uq_object_furniture_active_market_owned`로 거부되고 신규 이력도 rollback

## 코드 검증

- `npm run object-data:validate`: 성공, 등록 대상 22개
- `npm run typecheck`: 성공
- `npm run build`: 성공
- Wave 1 집중 테스트: `41/41` 성공
- 가구 최종 동시성·생명주기 집중 테스트: `26/26` 성공
- 전체 회귀 테스트: `1634`개 중 `1626` 성공, 실패 `0`, 환경 의존 `8`개 skip
- `main.js`, `Info.js` Node 구문 검사: 성공
- `git diff --check`: 성공

가구 replay INSERT는 PK 충돌만 새 CUID2 후보로 재시도하고, 업무 UNIQUE 충돌은 transaction rollback 후 완료 replay 재조회로 수렴한다. grant/place/transition의 실제 execute 단계 충돌 fixture, listing 가격 멱등성 충돌, 마켓 관계 불일치 rollback을 검증했다.

## Gate 판정 범위

이 문서는 Wave 1의 Gate 1~4와 중앙 schema 통합 검증 근거다. 레거시 데이터 import, 전체 consumer 전환, parity, Shadow와 운영 배포는 각각 WBS743~745에서 수행하므로 Gate 5~8 완료 근거로 사용하지 않는다.
