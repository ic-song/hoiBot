# WBS769 펫스킬 이중 컨텍스트 라우터 검증

## 범위

- 대상: `SL-PET-SKILL-INFO-DUAL-CONTEXT-ROUTER-01`
- 기준 커밋: `ed5255bcfc8aa2a2ba4367cf49a54c7df8413119`
- 명령: `/펫스킬정보`
- 목적: 방·서버별 활성 게임계정과 포털 대표계정의 이용권 권위를 하나의 읽기 전용 스냅샷에 고정한다.
- 제외: 운영 데이터 이관, 운영 DB 변경, 실운영방 응답, Gate8, `feature/prod` 반영

## 확정 계약

- Kakao ROOM과 Discord SERVER 컨텍스트는 플랫폼 identity와 분리하여 해석한다.
- 응답 대상 게임 데이터는 해당 방·서버에서 선택된 게임계정을 사용한다.
- 포털 연결 계정의 개인방 이용권은 활성 대표계정의 `hoi/newbie/premium`을 사용한다.
- 포털 미연결 레거시 계정만 선택 게임계정 자체를 이용권 권위로 사용한다.
- actor 선택, membership, selection version, 대표계정 권위, pass, catalog projection을 공용 recovery transaction 안에서 한 번만 해석한다.
- 동일 event 재실행은 저장된 receipt를 사용하며 `/계정변경` 이후에도 actor context를 다시 조회하지 않는다.
- room, membership, selection version, actor identity, notification identity 또는 result fingerprint 변조는 fail-close한다.
- 기존 V1/V2 receipt replay는 유지하고 이중 컨텍스트 receipt 및 개인방 알림 V3를 additive하게 사용한다.
- 조회 본문은 source-domain/outbox DML 0이며, 공용 durable receipt와 기존 개인방 차단 누적은 기존 app-wiring 경계를 유지한다.

## 검증 결과

- focused tests: 33/33 PASS
- typecheck: PASS
- build: PASS
- object data model contract: 등록 대상 111개 PASS
- 독립 리뷰: GO, P0/P1/P2 actionable finding 0건
- 격리 MariaDB 12.2: migration 474개 적용 PASS
- account-platform migration 467~469: 3개 확인
- 표적 MariaDB 통합 테스트: 1/1 PASS
- actor provider 단위 테스트: 4/4 PASS
- 격리 DB 종료 후 3339 listener 0, 임시 경로 삭제 확인
- 운영 3306 listener PID `5216` 전후 동일
- 운영 데이터 접근, 외부 답장, 네트워크 전송 없음
- `git diff --check`: PASS

## 재현 명령

```text
node --import tsx --test test/pet-skill-info-actor-context-provider.test.ts test/pet-skill-info-dual-context-router.test.ts test/pet-skill-info-read-only-recovery-ingress.test.ts test/pet-skill-info-private-denial-receipt-v2.test.ts test/pet-skill-info-shadow-http.test.ts test/private-chat-denial-notification-service.test.ts
npm run typecheck
npm run build
npm run object-data:validate
powershell -ExecutionPolicy Bypass -File scripts/rehearse-pet-skill-info-dual-context-router-wbs769.ps1
git diff --check
```

격리 MariaDB 최종 표식:

```text
WBS769_ISOLATED_MARIADB_PASS migrations=474 accountPlatformMigrations=3 targetedIntegration=true actorProviderUnit=4 port=3339 database=hoibot_wbs769_actor_context tempCleaned=true production3306Unchanged=true
```

## 전체 테스트 모음 주의

- 전체 `npm test`는 변경 범위 밖 WBS743 schema-contract 테스트 2건의 기존 실패를 관측하여 중단했다.
- 따라서 전체 회귀 green으로 주장하지 않으며, WBS769 변경 범위의 focused 33건과 격리 MariaDB 결과만 Gate 증거로 사용한다.
