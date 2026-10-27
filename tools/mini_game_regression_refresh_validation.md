# 과거 미니게임 테스트 3종의 운영 기준 동기화

- 기준 운영 소스: `86c24cf8cc07f99d5ad4dda92734cc645e9ee36c`, ver_2.718, 2026-10-27 KST.
- 테스트 3개와 이 검증 보고서만 변경한다. `main.js`, `Info.js`, 데이터·버전·개발자노트는 변경하지 않는다. 과거 최적화 보고서의 실패 기록은 당시 실행 이력으로 보존하며, 아래 결과로 해당 3종의 현재 실패를 해소한다.

## 수정 내용

| 테스트 | 현재 운영 기준 및 보강 | 결과 |
| --- | --- | --- |
| `test_mini_game_revision.js` | 금고 전체 초기화는 1단계·새 암호·힌트/사용 횟수/일일 당첨자 초기화. 기지급 보상 이력·잔액 보존. 일반/호패의 초기화 후 정확히 3회, 프리미엄의 실제 4·5번째 사용과 강등 후 소진 상태 검증 | 27그룹 통과 |
| `test_mini_game_daily_reset.js` | 실제 길드마블 모델·게시 복구를 로드하고 복구 후 회원을 다시 읽어 `/리셋` 분기로 전달. 임의 전역 경로만 추가하거나 실제 검증을 모방하지 않음. PROD/DEV 손상 마블 파일 무변경 실패·정상 빈 저장소 연동·미완료 마블 원장 잔액 복원 후 초기화 검증 추가 | 기존 11 + 신규 2 = 13그룹 통과 |
| `test_dice_limit.js` | 하루 4판 및 `일일 /리셋 시 횟수 초기화` 안내. 실제 자정만으로 횟수가 복구되지 않음, 5번째 무소모 차단, `/리셋` 후 재개·PROD/DEV 분리 유지 | 2환경 통과 |

## 전체 관련 회귀

회귀 범위는 이번 미니게임 공통 최적화와 연결된 미니게임·금고·주사위·길드마블·프리미엄, 앞선 세 성능 최적화 영역이다. 저장 자료는 합성 데이터와 OS 임시 경로만 사용한다.

Node 실행 파일 18종 모두 종료 코드 0:

```text
test_mini_games.js
test_mini_game_revision.js
test_mini_game_ui.js
test_mini_game_memory.js
test_mini_game_daily_reset.js
test_mini_game_missing_journal.js
test_minigame_updates.js
test_vault_reset_skills.js
test_vault_balance.js
test_vault_robbery.js
test_dice_limit.js
test_guild_marble.js
test_guild_marble_settlement.js
test_guild_marble_improvements.js
test_premium_skill_restore.js
test_mini_game_common_performance.js
test_targeted_performance.js
test_personal_metric_rank.js
```

각 파일은 `node tools/<파일명>`으로 재실행한다. 로컬 집계 증거: `C:/Users/user/AppData/Local/Temp/hoibot-minigame-node-1793067839121.json` (18/18 통과, 로컬 임시 증거).

Rhino 1.7.15 실행 파일 6종 모두 종료 코드 0:

```text
test_mini_games_rhino.js
test_guild_marble_rhino.js
test_premium_skill_restore.js
test_mini_game_common_performance.js
test_targeted_performance.js
test_personal_metric_rank.js
```

각 파일은 `node tools/<파일명> <Rhino-1.7.15.jar>`로 재실행한다. Main/Info 전체 컴파일, 실제 Java 파일·fsync/rename·동시 스레드·회원/진행/저널 정리 중단 후 새 전역 복구, 한 번 지급, 공지 불확실 상태 유지, 자정/전체 초기화/4판·금고 횟수, DEV 격리, 오류·잠금 해제, 세 최적화의 이전 운영 소스 결과 대조를 포함한다.

- 미니게임 실제 파일 증거: `C:/Users/user/AppData/Local/Temp/hoibot-minigames-rhino-DTplIg`.
- 변경 테스트 3개의 Node 구문, UTF-8, diff 검사와 운영 소스/데이터 무변경을 확인한다.
- 운영 기기 업로드·컴파일·재시작은 수행하지 않는다. 테스트 전용 변경이라 봇 버전은 ver_2.718을 유지한다.
