# 작업 복구 체크포인트

- 작업 키: modernization-cmd-04-0003-buycqf
- 작업 이름: `/길드강제제명` 고도화
- 체크포인트 버전: 3
- 마지막 갱신: 2026-08-13 16:40 KST
- 작업 상태: 구현 중
- 정리 후보: 아니요

## 목표와 범위

- WBS ID: CMD-04-0003
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: D
- 작업자명: 방패
- 실행 ID: 방패-CMD-04-0003-20260813T073336Z-buycqf
- 목표: `/길드강제제명` guard, 권한, 대상 회원 제거와 저장 흐름을 조사하고 DB 기반 도메인 로직·테스트·evidence로 이관한다.
- 선언된 파일 범위: 길드 도메인 policy/service/repository/test/evidence. 공용 MariaDB adapter·dispatch·fixture 통합은 coordinator 인계 대상으로 남긴다.

## 소유권과 작업 위치

- 선점 원장 행: 13
- 선점 상태: 활성
- Heartbeat: 2026-08-13 16:40:35 KST
- Lease 만료: 2026-08-13 17:40:35 KST
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_04_0003_buycqf
- Branch: feature/modernization-cmd-04-0003-buycqf
- 기준 commit: CMD-04-0002 통합 완료 `36bd745`
- push 상태: 미푸시

## 현재 작업

- 완료: broad prefix와 free-form 닉네임, master 전용 권한, 길드마스터 보호, guild→member 저장 순서를 조사하고 policy/service/repository contract/test/evidence로 이관.
- 변경 파일: 강제제명 policy/service/repository/test/evidence와 이 체크포인트.
- 검증 결과: 집중 테스트 5건, 전체 회귀 149건, evidence validator, typecheck, build, diff check 통과.
- 남은 위험: MariaDB operator room scope, adapter·dispatch·restart/replay는 coordinator 통합에서 검증해야 한다.
- 정확한 다음 행동: source commit을 push하고 coordinator로 인계해 MariaDB adapter·dispatch·restart/replay를 검증한다.

## 영속성

- 체크포인트 Git 추적: 아직 커밋되지 않음
- 원격 포함 상태: 미포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음
