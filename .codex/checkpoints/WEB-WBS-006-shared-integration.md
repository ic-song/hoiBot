# WEB-WBS-006 공유 계정 기준선 통합 체크포인트

## 실행 경계

- 실행 ID: `웹포털통합-SL-WEB-PORTAL-SHARED-ACCOUNT-INTEGRATION-01-20260909222853`
- Slice: `SL-WEB-PORTAL-SHARED-ACCOUNT-INTEGRATION-01`
- Lease: `Lease2634`
- 책임 소유자: `/root/web_portal`
- 작업 브랜치: `feature/web-portal`
- 작업 디렉터리: `C:\Users\user\Desktop\hoiBot-worktrees\web-portal-v1-20260909`
- 운영 기준선: `feature/prod@4331cb75`
- 계정 공용 기준선: `6fa79f613876ffb494e056175f098e528f2c24a3`
- 웹 통합 merge: `c78d9871`
- 기준 카탈로그: `SC-20260902-1`
- 증분 카탈로그: `SCD-WEB-20260909-1`, `SCD-WEB-20260909-2`, `SCD-WEB-20260909-3`
- evidence schema: `web-shared-integration-v1`

## 구현 결과

- 이용자 화면 `/`, `/login`, `/app`을 Fastify 런타임에 한 번만 연결했다.
- 회원가입 `/signup`과 탈퇴 `/account/delete`, 복구 `/recover-account`를 같은 origin의 기존 API 계약에 연결했다.
- 탈퇴 성공 시 폐기된 `hoibot_user_session` 쿠키를 즉시 지운다.
- 복구 요청은 로그인 ID 5회와 네트워크 20회 기준으로 제한한다.
- 복구는 `ACCOUNT_AUTHORITY` 전역 잠금 후 대상 행을 잠그며, 잠금 seed가 없으면 503으로 차단한다.
- 유예 요청 변경과 계정 활성화 중 하나라도 경합으로 실패하면 트랜잭션 전체를 실패 처리한다.
- 기존 봇·오브젝트 DB Gate와 동결 카탈로그 증거는 수정하거나 재라벨링하지 않았다.

## 반응형·접근성 증거

- `ui-ux-pro-max` 기준으로 모바일 우선 단일 열을 기본값으로 두고 620px 보조 그리드, 820px 데스크톱 2열로 전환한다.
- 로그인, 회원가입, 계정 복구를 Chrome에서 375, 768, 1024, 1440px로 각각 렌더링했다.
- 12개 조합 모두 `scrollWidth <= clientWidth`, 가로 넘침 없음, 화면 밖 요소 없음으로 확인했다.
- 375/768px은 단일 열, 1024/1440px은 2열 전환을 확인했다.
- 결과: `snapshot-evidence/web-responsive-20260909/responsive-audit.json`
- 캡처: `snapshot-evidence/web-responsive-20260909/*-audit.png`
- 자동 점검기: `snapshot-evidence/web-responsive-20260909/responsive-audit.mjs`

## Gate 7 독립 검토

- 검토자: `/root/account_recovery_review`
- 판정: `GO`
- P0: 0
- P1: 0
- 확인 경계: 탈퇴 쿠키 삭제, 계정·네트워크 limiter, 전역 잠금과 대상 행 잠금 순서, 유예 만료 이중 확인, affectedRows 경합, `[1,1,0]` 부분 성공 rollback, 잠긴 계정 423, limiter 429, 잠금 seed 누락 503.
- 검토자는 구현자·책임 소유자·evidence 작성자가 아니며 파일을 수정하지 않았다.

## 검증

- `npm run typecheck`: PASS
- 웹·회원가입·계정 집중 테스트: 47/47 PASS
- `npm run build`: PASS
- `git diff --check`: PASS
- 전체 회귀: total 2,178 / pass 2,158 / fail 12 / skip 8 / duration 1,003.288초. 실패는 웹·계정 기능이 아니라 동결 이후 변경된 운영 JSON·`main.js`·`app.ts`와 과거 exact-source fixture/hash 차이 11건, `object-db-consumer-transition-contract.test.ts` 프로세스 OOM 1건이다.
- 동일 오브젝트 DB 계약 파일의 단독 재검사는 약 18.5GB working set까지 계속 증가해 시스템 부담을 막기 위해 종료했다. 웹 변경의 기능 실패 증거는 없으며 오브젝트 DB 계약 테스트 실행 자원 문제로 분리한다.
- 미리보기 서버는 `127.0.0.1:3310`에서 다시 기동했고 `/`가 `/login`으로 이동해 화면이 표시되는 것을 브라우저에서 재확인했다.
- 기존 exact-schema/source evidence는 새 값으로 재라벨링하지 않았다. 차이는 `SCD-WEB` delta와 이 체크포인트에 증분 기록했으며 독립 High 검토자는 P0/P1 없음, Gate 7 GO 유지를 확인했다.

## 안전 경계

- 운영 DB와 운영 JSON을 수정하지 않았다.
- `feature/prod`와 Gate 8을 변경하지 않았다.
- Lease2634 종료 전까지 공용 runtime 쓰기 claim을 유지하며, 종료 readback 뒤 오브젝트 DB 작업자에게 해제를 알린다.
