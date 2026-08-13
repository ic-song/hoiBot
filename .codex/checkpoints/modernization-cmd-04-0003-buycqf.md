# 작업 복구 체크포인트

- 작업 키: modernization-cmd-04-0003-buycqf
- 작업 이름: `/길드강제제명` 고도화
- 체크포인트 버전: 1
- 마지막 갱신: 2026-08-13 16:34 KST
- 작업 상태: 조사 시작
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
- Heartbeat: 2026-08-13 16:33:36 KST
- Lease 만료: 2026-08-13 17:33:36 KST
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_04_0003_buycqf
- Branch: feature/modernization-cmd-04-0003-buycqf
- 기준 commit: CMD-04-0002 통합 완료 `36bd745`
- push 상태: 미푸시

## 현재 작업

- 완료: 대기 WBS와 활성 선점 부재 확인, 새 실행 append, 13행 단독 활성 소유권 재검증, WBS 선점 5% 기록, 전용 worktree를 최신 길드 통합 기준으로 준비.
- 변경 파일: 이 체크포인트만 생성됨.
- 검증 결과: 원장 실행 ID·worktree·branch가 현재 작업 위치와 일치한다.
- 남은 위험: legacy command의 실제 인자, 관리자/길드 권한, 자기 자신·길드마스터 제명 방지, member/guild 양방향 저장 순서를 재확인해야 한다.
- 정확한 다음 행동: COMMAND_INDEX를 시작점으로 main.js의 `/길드강제제명` guard, helper, 출력, load/save와 관련 명령을 실제 코드에서 추적한다.

## 영속성

- 체크포인트 Git 추적: 아직 커밋되지 않음
- 원격 포함 상태: 미포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음
