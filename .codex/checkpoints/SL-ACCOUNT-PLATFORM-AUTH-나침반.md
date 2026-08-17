# SL-ACCOUNT-PLATFORM-AUTH 체크포인트

- 실행 ID: `나침반-SL-ACCOUNT-PLATFORM-AUTH-20260817T152037Z-6af2jx`
- 브랜치: `feature/modernization-account-auth`
- 상태: 개발 검증 완료, MariaDB rehearsal 대기

## 완료

- 가입용 `/가입인증 코드`와 계정 연결용 `/계정인증 코드`를 별도 purpose로 구현
- 닉네임 일치 조건 제거, 안정적인 KakaoTalk `user_id`로 연결 소유권 판정
- 사이트 계정 1개와 다중 외부 identity 연결 테이블 및 기존 데이터 backfill migration 추가
- 사용자 연결 목록·계정 연결 코드 발급 API 추가
- 관리자 전역 연결 한도 조회·변경 API 추가(기본 10, 설정 1~10)
- 계정 삭제 시 외부 연결 challenge FK와 익명화 흐름 보완
- TypeScript typecheck, 159개 test, build 통과

## 미완료·다음 작업

- 이 PC에는 MariaDB/Docker와 접속 설정이 없어 빈 시험 DB migration 2회 및 재시작 probe를 실행하지 못함
- 격리 MariaDB에서 `001~034` migration을 2회 실행하고 기존 계정 backfill, 10개 제한, 한도 하향 시 기존 연결 유지 여부를 확인
- 미연결 외부 사용자의 허용 명령을 인증·도움말로 제한하는 전체 dispatch gate는 별도 통합 검증 필요
- 관리자 강제 해제·차단·연결 이력 API와 사용자 직접 연결 해제 API는 후속 구현 필요
- Shadow·운영 준비는 수행하지 않음
