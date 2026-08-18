# 정리 오케스트레이션 분류 체크포인트

- 슬라이스 ID: `SL-INVENTORY-CLEANUP-ORCHESTRATION`
- 도메인: 기타·재확인 / inventory orchestration
- 작업 레인: 도메인(분류 전담)
- 작업자명: 윤슬
- 실행 ID: `윤슬-SL-INVENTORY-CLEANUP-ORCHESTRATION-20260818T062329Z-oa0vw2`
- 체크포인트 버전: 1
- 작업 상태: `ACTIVE`

## 소유권과 작업 위치

- 선점 원장 행: 37
- Worktree: `C:/Users/user/Desktop/hoiBot-worktrees/윤슬-SL-INVENTORY-CLEANUP-ORCHESTRATION-20260818T062329Z-oa0vw2`
- Branch: `feature/modernization-inventory-cleanup-orchestration-yoonseul-oa0vw2`
- 기준 commit: `a39cd995ad2cdc2c97bcb82ed8a320150578d4ae`

## Gate

- 현행 조사: 완료 예정
- DB 매핑: 완료 예정
- 합성데이터: 미실행
- 구현: 미실행
- 통합: 미실행
- parity: 미실행
- Shadow: 미실행
- 운영 준비: 미실행

## 분류 결론

- 직접 대표 명령은 `CMD-03-0131 /정리`와 bare `ㅇㅇㅇ`이며 현재 `사용`이다.
- slash 별칭 `/ㅇㅇㅇ`은 `CMD-11-0022 /퀘스트완료`이므로 별도 입력이다.
- `SL-CRAFT-COMBINE-ALL`을 지원 의존성으로 승계하고 `runCombineAll`을 재개발하지 않는다.
- parent transaction은 오픈·조합·판매·길드·퀘스트 단계를 한 event로 묶고 commit된 ordered outbox만 delivery한다.
- 오픈, 판매, 길드, quest는 독립 하위 슬라이스로 나눈다.

## 안전 제한

- 명령 사용 상태를 변경하지 않는다.
- runtime source, migration, 시험/운영 DB, 운영 JSON을 변경하지 않는다.
- 합성 실행, 구현, 통합, parity, Shadow, 운영 준비 Gate를 완료 처리하지 않는다.
- `feature/prod`를 변경하지 않는다.

