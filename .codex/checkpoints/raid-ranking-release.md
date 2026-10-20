# 레이드 개인 순위 정렬 생략 단독 운영반영

- 작업 키: raid-ranking-release
- 작업 상태: 검증 완료, 운영반영 진행 중
- 체크포인트 버전: 1
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 정리 후보: 아니요
- 승인: 사용자 “개인순위정렬줄인거 운영반영”. 정렬 최적화만 반영하고 저장/응답 최적화는 별도 PR #138에 보존.
- 기준: origin/feature/prod=96633c05dd0c6eb66e24f6fb786bcae7a4c3fc62, ver_2.664. 최신 local feature/prod에서 feature/raid-ranking 분리. 아직 반영하지 않은 feature/bugFix는 삭제하지 않음.
- 변경: buildServerRaidResults의 skipMemberRanks, 공격 안내에서만 생략 호출. freeze는 개인 정산 강제 유지. main 전체 차이 검증으로 저장/계산/전송 무변경 확인. 개발자노트/버전2.665 준비.
- 검증: tools/raid_ranking_validation.md. Node146그룹, Rhino 규모별 전후 메시지/정산 동일, 전체 컴파일/공지 동시성9시나리오. 합성 데이터만 사용.
- Notion: 확인한 기획 데이터 소스에서 관련 공격 결과 UI·레이드 초안·개인 순위 문서의 실제 속성은 모두 LIVE. 본문/상태/날짜/버전 변경 없이 보존.
- 다음: 검증 소스 커밋/푸시→PR 생성/첨부→운영 반영 및 원격 버전/개발자노트 확인→PlayMCP 나에게 정확히 ver_2.665 알림→완료 기록. 운영 앱/기기 접근 금지.
- 보존: .codex-remote-attachments/, 개발환경_고도화/runtime/ 미추적 상태 유지. PR #138은 미반영 저장/응답 개선 때문에 초안으로 유지.
