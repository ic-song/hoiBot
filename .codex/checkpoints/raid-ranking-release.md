# 레이드 개인 순위 정렬 생략 단독 운영반영

- 작업 키: raid-ranking-release
- 작업 상태: 완료
- 체크포인트 버전: 2
- 마지막 갱신: 2026-10-21 (Asia/Seoul)
- 정리 후보: 예
- 승인: 사용자 “개인순위정렬줄인거 운영반영”. 정렬 최적화만 반영하고 저장/응답 최적화는 별도 PR #138에 보존.
- 기준: origin/feature/prod=96633c05dd0c6eb66e24f6fb786bcae7a4c3fc62, ver_2.664. 최신 local feature/prod에서 feature/raid-ranking 분리. 아직 반영하지 않은 feature/bugFix는 삭제하지 않음.
- 변경: buildServerRaidResults의 skipMemberRanks, 공격 안내에서만 생략 호출. freeze는 개인 정산 강제 유지. main 전체 차이 검증으로 저장/계산/전송 무변경 확인. 개발자노트/버전2.665 반영 완료.
- 검증: tools/raid_ranking_validation.md. Node146그룹, Rhino 규모별 전후 메시지/정산 동일, 전체 컴파일/공지 동시성9시나리오. 합성 데이터만 사용.
- Notion: 확인한 기획 데이터 소스에서 관련 공격 결과 UI·레이드 초안·개인 순위 문서의 실제 속성은 모두 LIVE. 본문/상태/날짜/버전 변경 없이 보존.
- 운영 근거: 소스4e7427389f2c4836624daf9b8982e9c49ca7e87f 푸시 후 PR https://github.com/ic-song/hoiBot/pull/139 병합. origin/feature/prod의626aad8b06ae81fc7eab0558c22a97fbd9db2ac6에서 소스 포함·버전/개발자노트2.665 일치 확인. 병합 후 범위/정산5그룹 재검증 통과.
- 알림: 원격 운영 확인 후 PlayMCP 나에게 정확히 ver_2.665 전송 성공. 관련 LIVE 노션과 스킬은 변경하지 않음.
- 다음: 현재 요청 완료. 운영 앱 업로드·컴파일·재시작은 운영자 수행. 저장/응답 최적화는 미반영 PR #138에 남아 있으며 후속 반영 시 최신 prod 동기화와 검증 필요.
- 보존: .codex-remote-attachments/, 개발환경_고도화/runtime/ 미추적 상태 유지. PR #138은 미반영 저장/응답 개선 때문에 초안으로 유지.
