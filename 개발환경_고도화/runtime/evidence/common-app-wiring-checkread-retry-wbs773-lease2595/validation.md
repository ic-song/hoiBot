# WBS773 app-wiring ER_CHECKREAD 재시도 검증

- Slice/WBS/Lease: `SL-COMMON-APP-WIRING-ER-CHECKREAD-RETRY-01` / `773` / `2595`
- Branch/Baseline: `codex/common-app-wiring-checkread-retry-v1-20260907` / `493f5a055d8a0219ddf2c1494a579c56371ad446`
- 범위: 공통 Maria 오류 분류와 app-wiring READ_ONLY root/failure 트랜잭션의 bounded retry만 변경한다.

## 원인과 정책

- MariaDB 12.2 `REPEATABLE READ` consistent snapshot에서 서로 다른 이벤트가 동일 channel/identity 관찰 행을 동시에 upsert할 때 `ER_CHECKREAD` / errno `1020`이 발생했다.
- `code=ER_CHECKREAD`와 `errno=1020`이 모두 정확히 일치할 때만 `TRANSACTION_CHECK_READ_CONFLICT`로 분류한다. code-only, errno 불일치는 `OTHER`다.
- 새 충돌은 `allowCheckReadConflict: true` 전용 opt-in과 도메인 `allowRetry`를 모두 만족해야 하며, 이를 설정한 app-wiring READ_ONLY root와 failure persistence의 새 root transaction에서만 최대 3회 재시도한다.
- 비-app-wiring 호출은 `allowRetry: () => true`여도 opt-in 기본값 false 때문에 exact 1020 원형 오류를 첫 transaction에서 그대로 전파한다.
- CUID8, UNIQUE, FK, scoped/savepoint 경계와 다른 도메인의 allow-list 의미는 변경하지 않는다.
- WBS767 알림 서비스의 일반 transaction 재시도 allow-list는 변경하지 않는다.

## 합성 검증

- Unit: `maria-database-error-policy.test.ts`, `app-wiring-read-only-recovery-provider.test.ts` 총 26개 통과.
- exact 1020 root 재시도 후 두 번째 transaction 성공, failure persistence의 첫 1020 후 두 번째 transaction 성공을 검증했다.
- 도메인이 허용하지 않으면 exact 1020도 최초 transaction 오류 그대로 전파된다.
- 격리 MariaDB 포트 3338에서 전체 migration 후 동일 채널·동일 identity·서로 다른 이벤트 2건을 HTTP `Promise.all`로 전송했다.
- 실제 결과: `202/202`, claim attempt count `1/2`, event inbox 2, completed claim 2, completed operation 2, ignored execution 2, 공통 outbox 0, 외부 전송 0.
- 격리 출력: `WBS773_CHECKREAD_RETRY_PASS both202=true sameChannel=true sameIdentity=true distinctEvents=true minAttempt=1 maxAttempt=2 commonOutbox0=true externalSend0=true port=3338`.
- 격리 wrapper: `WBS773_ISOLATED_MARIADB_PASS both202=true exactCheckreadRetry=true commonOutbox0=true externalSend0=true port=3338 production3306Unchanged=true`.

## 범위 제한

- 운영 DB, 운영 데이터, 실운영방, 포트 3306을 사용하거나 변경하지 않았다.
- feature/prod, Gate8, 운영 전환은 수행하지 않았다.
- 리허설 임시 DB와 포트 3338은 종료 후 제거했다.
