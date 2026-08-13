# 작업 복구 체크포인트

- 작업 키: modernization-cmd-04-0001-e80654
- 작업 이름: `/길드가입` 고도화 이관
- 체크포인트 버전: 3
- 마지막 갱신: 2026-08-13 15:47 KST
- 작업 상태: 진행 중
- 정리 후보: 아니요

## 목표와 범위

- WBS ID: CMD-04-0001
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: D
- 작업자명: 자물쇠
- 실행 ID: 자물쇠-CMD-04-0001-20260813T063703Z-e80654
- 목표: `/길드가입 [인자]`의 현재 동작과 저장 흐름을 조사하고 관계형 기능 슬라이스로 이관해 legacy 결과와 합성 MariaDB 결과를 검증한다.
- 선언된 파일 범위: 도메인 전용 Service/Policy/Repository, 단위 테스트, 독립 fixture 또는 probe 초안, evidence. 공용 migration·fixture·dispatch·Queue·COMMAND 문서는 coordinator가 통합한다.

## 소유권과 작업 위치

- 선점 원장 행: 6
- 선점 상태: 활성
- Heartbeat: 2026-08-13 15:41:51 KST
- Lease 만료: 2026-08-13 16:41:51 KST
- 인계 상태: 없음
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_04_0001_e80654
- Branch: feature/modernization-cmd-04-0001-e80654
- 기준 commit: 871cb0f
- push 상태: 원격 작업 브랜치 포함 (`9459a1a`)

## 현재 작업

- 완료: 길드 도메인 후보 84건 조회, 첫 대기 작업 선택, 전용 worktree/branch 생성, 작업_선점 6행 append, 행 번호 우선 소유권 재검증, 상세 WBS 연결, 레거시 guard·별칭·후보 정렬·정원·EXP·확정·취소·save 순서 조사, 도메인 가입 정책과 집중 단위 테스트 작성, evidence에 DB 매핑 및 스키마 공백 기록.
- 변경 파일: `개발환경_고도화/runtime/src/guild/guild-join-policy.ts`, `개발환경_고도화/runtime/test/guild-join-policy.test.ts`, `개발환경_고도화/migration-control/evidence/guild-join/slice.json`, 이 체크포인트.
- 검증 결과: runtime 전체 typecheck 통과, 길드가입 집중 테스트 6건 통과. `/길드가입 1 안내` 뒤붙임 차단, 가입 가능한 목록 순서, 징집명령 정원 +1, EXP 재검사와 레거시 출력 문구를 검증했다.
- 남은 위험: 현재 DB의 `guilds`에는 mark/server/level/join condition/member-close/capacity 필드가 없고, 2단계 가입 대기를 재시작 후 유지할 테이블과 합성 가입권 fixture도 없다. 현재 테이블만으로 service를 구현하면 레거시 정책을 누락하게 된다.
- 정확한 다음 행동: coordinator 통합 범위에서 길드 정책 컬럼·durable pending request·가입권 합성 fixture 계약을 확정한 뒤, 길드 전용 Repository/Service에서 확정 시 membership·ticket·ledger·operation·audit·outbox를 단일 트랜잭션으로 연결한다.

## 영속성

- 체크포인트 Git 추적: 커밋 `9459a1a`에 포함
- 원격 포함 상태: `origin/feature/modernization-cmd-04-0001-e80654`에 포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음
