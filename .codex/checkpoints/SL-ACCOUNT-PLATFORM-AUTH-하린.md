# SL-ACCOUNT-PLATFORM-AUTH 인계 체크포인트

- 작업자: 하린
- 실행 ID: `하린-SL-ACCOUNT-PLATFORM-AUTH-20260817T165026Z-o9n48f`
- 브랜치: `feature/modernization-account-auth-web`
- 기준 커밋: `5c10a9f`
- 상태: 개발 검증 완료 / DB·Shadow 검증 대기

## 고정된 도메인 진행 순서

1. 회원·프로필·재화
2. 가방·인벤토리
3. 펫·성장
4. 펫홈·가구·소셜
5. 미니펫·컬렉션
6. 길드·영지·레이드·캐슬
7. 장비·펜던트·정령
8. 상점·패키지·제작

패키지·조합 슬라이스는 사용자 요청에 따라 추후 진행한다.

## 이번 실행에서 보완한 범위

- 홈페이지 회원가입 API가 30분 코드와 함께 복사 가능한 `/가입인증 8자리코드`를 반환한다.
- Iris 가입 인증은 정확한 `/가입인증 8자리코드`만 허용한다.
- 기존 임시 명령 `/인증`과 별도 계정 연결 명령 `/계정인증`은 가입 challenge로 처리하지 않는다.
- API 응답에 `verificationPurpose: initial_link`를 포함해 홈페이지가 가입 인증과 계정 연결 인증을 구분할 수 있게 했다.
- README와 단위 테스트를 현재 계약에 맞췄다.

## 검증 근거

- `npm.cmd run typecheck`: PASS
- `npm.cmd test`: PASS, 44 suites / 172 tests
- `npm.cmd run build`: PASS
- Docker와 MariaDB 실행 환경은 이 PC에 없어 migration 재적용·실 DB 대사·Shadow는 미실행

## 다음 작업

1. 로그인한 사이트 계정에서 외부 플랫폼 연결 challenge를 발급하는 API를 별도 구현한다.
2. `/계정인증 8자리코드`를 `existing_link` purpose로 처리하고 가입용 `initial_link`와 DB·서비스를 분리한다.
3. 관리자 설정의 플랫폼 통합 한도(최대 10개)와 활성 플랫폼 목록을 연결 발급 시 적용한다.
4. Docker/MariaDB 준비 후 migration 001~035 2회, 재시작, 가입·재발급·만료·닉네임 불일치·중복 이벤트를 검증한다.
5. Shadow와 운영 준비 Gate는 실 DB 근거가 생길 때만 완료 처리한다.
