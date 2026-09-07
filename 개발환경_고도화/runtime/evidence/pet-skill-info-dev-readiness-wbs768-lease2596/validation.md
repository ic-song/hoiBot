# WBS768 펫스킬 DEV 준비도 검증

## 범위

- 대상: `SL-PET-SKILL-INFO-DEV-READINESS-01`
- 기준: integration v30 `fc746894`
- 명령: 소문자 index-0 `dev/`로 들어온 `/펫스킬정보` 후보
- 제외: 운영 데이터 이관, 운영 DB, 실운영방, DIRECT 응답, Gate8, `feature/prod`

## 확정 계약

- 레거시의 전체 DEV JSON 파일 복사 검사는 펫스킬 canonical DB 준비도로 축소한다. 이는 WBS768의 오브젝트 도메인 경계이며 전체 운영 데이터 이관을 대체하지 않는다.
- `UNREADY`: active 정의/연결/별칭/정책이 모두 0건이다.
- `PARTIAL`: 1건 이상 존재하지만 `93/93/30/4` 또는 고정 semantic fingerprint, catalog projection 중 하나가 불완전하다.
- `READY`: 정의 전체 의미값, import payload fingerprint, source/display order, alias binding/value, 정책값, charm metadata를 묶은 SHA-256 `dfdc76016342f7db4f8514b8a6f529e0865d808f433cde3069b266eba6a02011`과 catalog projection이 같은 read-only root snapshot에서 모두 통과한다.
- `DML 0`: readiness provider 및 canonical/source-domain 테이블 기준이다. app-wiring의 durable receipt DML은 기존 재실행 계약으로 유지한다.
- 준비 전 영수증은 additive `PET_SKILL_INFO_DEV_READINESS_RECEIPT_V1`이며 binding·authorization·상태·건수·정확 reply를 엄격히 재검증한다. 기존 formal/denial V1/V2 영수증은 그대로 유지한다.
- 영수증 사유는 `EMPTY`, `COUNT_MISMATCH`, `SEMANTIC_DRIFT`, `COMPLETE`로 고정한다. 따라서 건수는 `93/93/30/4`지만 내용 해시가 다른 정상 `PARTIAL`도 정확히 기록하며, 과거 formal V1으로 version downgrade해 준비 안내를 가장하면 fail-close 한다.

## 정확 응답

```text
[DEV 테스트환경]
❌ DEV 펫스킬 카탈로그가 준비되지 않았습니다.
정의: 0/93
정의 연결: 0/93
별칭: 0/30
확률 정책: 0/4
```

```text
[DEV 테스트환경]
⚠️ DEV 펫스킬 카탈로그가 일부만 준비되었습니다.
정의: 92/93
정의 연결: 92/93
별칭: 29/30
확률 정책: 3/4
```

## 검증 결과

- unit: EMPTY/PARTIAL/READY, display-order swap, 정의+payload coordinated substitution, import payload, policy, alias, charm, database identity drift, deterministic reply 통과
- ingress: DEV readiness V1 exact receipt, semantic-drift `93/93/30/4 PARTIAL`, status/reason/count/value/reply tamper 및 formal-V1 downgrade fail-close, READY 기존 header, prod DEV_PREFIX 거부, historical private/formal receipt 호환 통과
- HTTP: UNREADY/PARTIAL 202 SHADOW, full-93 READY와 canonical alias 정확 reply, DEFAULT readiness 미호출, prod preclaim event/app-wiring/operation/execution/outbox DML 0, DB identity drift fail-close, replay snapshot 재평가 0, outbox/source-domain DML 0 통과
- isolated MariaDB: `hoibot_wbs768_dev`에 migration 474개와 저장소 고정 합성 seed `93/93/30/4`를 적용하고 SELECT 7개만으로 `READY` 통과
- 운영 데이터/운영 DB/외부 답장 사용 없음

## 재현 명령

```text
node --import tsx --test test/canonical-pet-skill-readiness-provider.test.ts test/pet-skill-info-read-only-recovery-ingress.test.ts test/pet-skill-info-shadow-http.test.ts
npm run typecheck
npm run build
node --import tsx --test test/object-data-model-contract.test.ts
WBS768_PET_SKILL_READINESS_MARIADB_TEST=true ... node --import tsx --test test/canonical-pet-skill-readiness-provider-mariadb.integration.test.ts
git diff --check
```
