# 작업 복구 체크포인트

- 작업 키: modernization-cmd-04-0002-zgmujh
- 작업 이름: `/길드가입조건` 고도화
- 체크포인트 버전: 3
- 마지막 갱신: 2026-08-13 16:32 KST
- 작업 상태: 구현·전체 회귀 완료, source push 대기
- 정리 후보: 아니요

## 목표와 범위

- WBS ID: CMD-04-0002
- 도메인: 길드·영지·레이드·캐슬
- 작업 레인: D
- 작업자명: 성벽
- 실행 ID: 성벽-CMD-04-0002-20260813T071919Z-zgmujh
- 목표: `/길드가입조건` guard, 권한, 길드 정책 변경과 저장 흐름을 조사하고 DB 기반 Policy·Service·Repository·테스트·evidence로 이관한다.
- 선언된 파일 범위: 길드 도메인 policy/service/repository/test/evidence. 공용 migration·dispatch·fixture 통합은 coordinator 인계 대상으로 남긴다.

## 소유권과 작업 위치

- 선점 원장 행: 11
- 선점 상태: 활성
- Heartbeat: 2026-08-13 16:32:00 KST
- Lease 만료: 2026-08-13 17:32:00 KST
- Worktree: C:/Users/user/Desktop/hoiBot_modernization_04_0002_zgmujh
- Branch: feature/modernization-cmd-04-0002-zgmujh
- 기준 commit: feature/prod `4c23d80`, modernization 병합 `c3d3473`, CMD-04-0001 통합 기준 병합 `fbefb06`
- push 상태: 미푸시

## 현재 작업

- 완료: 대기 WBS 확인, 활성 선점 부재 확인, 새 실행 append, 11행 단독 활성 소유권 재검증, WBS 선점 5% 기록, 전용 worktree와 선행 길드가입 통합 기준 준비.
- 변경 파일: 길드가입조건 policy/service/repository contract/test/evidence와 이 체크포인트.
- 검증 결과: 실제 main.js에서 broad prefix, 두 번째 token parse, getMyGuildId, isGuildLeader(마스터+부길마), guildData 단일 저장을 확인했다. evidence validator, 집중 테스트 7건, 전체 runtime 144 tests, typecheck/build가 통과했다.
- 남은 위험: MariaDB adapter·dispatch·합성 DB 재시작 검증과 legacy role/subMasters import 정합화는 coordinator 통합에서 필요하다. WBS의 castle table 매핑은 현재 명령 경로에서 사용되지 않았다.
- 정확한 다음 행동: evidence validator와 전체 runtime 회귀를 실행하고 source commit을 push한 뒤 coordinator 통합 실행으로 인계한다.

## 영속성

- 체크포인트 Git 추적: 아직 커밋되지 않음
- 원격 포함 상태: 미포함
- 보안: 비밀 값과 운영 개인정보를 기록하지 않음
