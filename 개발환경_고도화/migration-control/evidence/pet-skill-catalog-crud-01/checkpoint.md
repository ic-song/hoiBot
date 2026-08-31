# SL-ASSET-PET-SKILL-CATALOG-CRUD-01 checkpoint

- checkpoint: 2026-09-01 KST
- execution: `개발자-SL-ASSET-PET-SKILL-CATALOG-CRUD-01-20260901T001500`
- Lease: `2447`
- WBS: `694`
- branch: `codex/modernization-asset-pet-skill-catalog-crud-v2435-20260901`
- baseline: `80f1d8c4`
- catalog: `ASSET-FREEZE-v2.435-8f075b4e-02`
- state: `GATE7_READY_FOR_WBS_CLOSE`

## 구현 범위

- 기존 `ConfigurationCatalogProvider`와 migration004의 immutable configuration tables를 재사용한다.
- `asset.pet_skill.catalog`에 93개 펫스킬 정의, 4개 호환 그룹, 등급별 draw policy, source-bound catalog version을 한 version으로 묶는다.
- definition의 `code`와 `sourceKey`를 각각 고유 identity로 검증하고 이름 유사성으로 병합하지 않는다.
- `십원`과 `구원`, `무쌍신화`와 `무쌍귀신`을 서로 다른 stable code로 유지한다.
- `active=false` 또는 `openable=false`는 추첨 분모와 가중치에서 제외한다.
- 비오픈 직접지급 펫스킬은 source에 rate가 없어도 허용하되 draw weight를 0으로 고정한다.
- 고정 확률 합 초과, 잔여 확률 미배분, 호환 멤버 충돌, malformed/circular JSON은 fail-closed 처리한다.
- draft/publish/rollback/retire/discard는 기존 immutable provider의 transaction, audit, outbox, idempotency 계약을 그대로 사용한다.

## 검증 결과

- focused typed provider: `7/7 PASS`
- configuration MariaDB + pet skill lifecycle: `3/3 PASS`
- `npm run typecheck`: PASS
- `npm run build`: PASS
- full regression: `1,365 total / 1,358 pass / 0 fail / 7 skip`
- fresh isolated MariaDB: migration `399`, latest `413_pet_skill_catalog_crud.sql`
- seed parity: definition `93`, unique code `93`, unique sourceKey `93`, compatibility group `4`, active catalog version `1`
- migration replay: applied `0`, count `399`
- rollback: configuration set/group 제거 `0/0` 확인 후 migration413 재적용, count `399`, active set `1`, group `1`
- publish replay: 동일 idempotency key 재실행 `replayed=true`
- rollback/reconnect: target version 1을 새 version으로 복구하고 client 재생성 뒤 replay 및 definition 93 유지
- restart: 전용 MariaDB container restart 후 재탐색한 host port에서 lifecycle `3/3 PASS`
- transaction late failure: 공용 configuration Maria test의 audit failure rollback `PASS` carry-forward
- `git diff --check`: PASS

## 검토 중 발견·보완

- 실제 canonical skill code에는 `SKILL-ARTISANS-BREATH`처럼 대문자·하이픈 identity가 있어 이를 보존하도록 stable code 검증을 교정했다.
- `전설의 몽둥이`처럼 `openable=false`, `directGrantOnly=true`인 정의는 rate 필드가 없으므로 비오픈 정의에 한해 누락을 허용했다.
- publish 후 같은 idempotency key replay는 draft가 이미 active 상태이므로 adapter 사전검사가 replay를 막지 않도록 존재 여부만 확인하고 상태 검증은 공용 repository에 위임했다.
- legacy `getPetSkillRandomWeight`/`getPetSkillTotalRate`/`getPetSkillActualRate`/`pickRandomPetSkill`을 재대조해 `drawWeight`는 추첨 가중치, `actualRate`는 전체 가중치로 정규화한 실제 확률임을 확인했다. 등급 정책이 없는 D·SS도 기존처럼 원시 rate를 가중치로 사용한다.
- 첫 restart 검증은 Docker의 임의 host port 재할당을 기존 port로 조회해 연결 실패했다. 새 port를 재탐색한 재검증은 통과했으며 코드/DB 결함으로 분류하지 않는다.

## 범위 보존

- `main.js`, `Info.js`, `data/`, ownership/ledger, feature/prod, 운영 DB를 변경하지 않았다.
- 신규 web/admin route와 별도 repository를 만들지 않았다.
- 기존 Gate와 pet skill consumer 구현은 reset하지 않았다.
- Gate8은 FALSE이며 운영 반영은 별도 승인 대기다.
