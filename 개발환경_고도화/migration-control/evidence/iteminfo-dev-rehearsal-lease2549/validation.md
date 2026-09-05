# itemInfo 비운영 개발 리허설 검증

- 범위: WBS742 / Lease2549 / `SC-20260902-1`
- 성격: 비운영 개발 DB 첫 검증. 운영 이관·운영 매핑 승인·Gate 상승 근거가 아니다.
- provenance: `LEASE2549_DEV_REHEARSAL_GENERATED_LOCATOR`
- 운영 승계: 별도 운영 데이터 이관 WBS에서 재승인 없이는 불가

## 원본 및 계수

- 원본 SHA-256(pre/copy/post): `49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc`
- bytes: `31289`, root categories: `5`
- top-level entries `120`: 컨테이너 단위 조사값
- nameList leaves `124`: 표시명 alias/reference 증거이며 identity가 아님
- canonical definition occurrences `131`: exact JSON pointer+array index locator 기준 권위값
- 완전 정산: `131 = PROJECT 25 + QUARANTINE 106 + IGNORE 0`

## 적용 및 재실행

- RAW: file `1`, bytes `31289`, source hash 일치, replay insert `0`
- Common Staging: records `131`, replay insert `0`
- Catalog Projection: decisions `131`, rows `25`, `P25/Q106/I0`, replay decision/row `0/0`
- projection SHA-256: `05642f59309211ee56f8c5bf1864503597f202476e82b9d603656c25e97a8eef`
- Object Domain: decision receipts `131`, import records/canonical rows `25/25`, replay receipt/row `0/0`
- import SHA-256: `f650ef89d50fbb329bd9578ad2797fa13db39178d21790f2e715c4e621f77a1f`

## Fail-closed 판정

- equipment occurrences `106 = elemental 61 + ring 45`는 `SOURCE_SHAPE_MISMATCH`로 격리했다.
- 원인은 단순 adapter 누락이 아니라 canonical equipment target의 표현력 차이다. legacy grade에는 복수 이름과 battle/raid/castle별 base·upgrade 값이 있으나 현 target은 단일 이름/slot/grade/base charm/charm-per-enhancement 계약이다.
- 표시명 merge, 첫 이름 선택, 세 능력치 축약, 임의 기본값 생성을 하지 않았다.
- Catalog/Domain 적용 완료는 106개 완료를 뜻하지 않으며 WBS742 Gate를 올리지 않는다.

## 실행 경로 및 환경

- 격리 endpoint: MariaDB `11.8.8`, compose project label `hoibot-modernization`, service label `mariadb`, non-internal compose bridge + loopback host binding `127.0.0.1:3308`, local named volume.
- container label의 원 compose 파일은 현재 경로에 없어 재현 provenance gap으로 남긴다. immutable runtime metadata와 task 전용 schema/user allowlist로 이 비운영 리허설만 수행했다.
- 투영된 canonical item 25개를 직접 읽는 MODERN app command consumer는 확인되지 않았다. 기존 raid/territory/castle repositories는 다른 canonical/전용 table을 읽는다.
- `/정령정보`는 registry/service가 있으나 `app.ts`의 `partialDispatchCandidate`에 `isSpiritInfoCommand`가 빠져 downstream MODERN 분기의 필요조건을 충족할 수 없다.
- actual command checkpoint: `NOT_ACHIEVED — APP_DISPATCH_AND_CANONICAL_CONSUMER_GAP`; real reply/network `0`.

## 잔여 위험

- applied history인 migration `442_data_migration_raw_landing.sql`에는 단독 `id`/`run_id`와 구형 `created_at`/`completed_at`/`imported_at` 감사 컬럼이 남아 현 오브젝트 표준과 차이가 있다.
- 이미 적용된 migration 442를 수정하지 않는다. 이후 별도 승인된 신규 migration에서 의미형 PK/FK 명명과 `INSERT_USER`, `INSERT_TIME`, `UPDATE_USER`, `UPDATE_TIME` 보완 계획을 수립해야 한다.
- 위 schema 표준 gap, equipment 106건, canonical consumer/dispatch gap이 해소되기 전에는 운영 이관 또는 Gate 상승 근거로 사용할 수 없다.

## Rollback

- Object Domain rollback: import run `1` 제거.
- target rows/import records/decision receipts: `0/0/0`.
- upstream RAW/Common Staging/Catalog 및 비운영 provenance는 rollback 직후 그대로 보존됨을 확인했다.
- task 전용 schema/user와 private payload copy는 검증 종료 시 exact allowlist로 제거하며 이 문서에는 payload·비밀번호를 보존하지 않는다.
