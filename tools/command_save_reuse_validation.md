# 같은 명령 안의 중복 저장 감소 검증

- 기준: `9a55db03cf85dabb955f79469e3aabe8971a95a7` / ver_2.692
- 결과 버전: ver_2.693, 2026-10-25 KST
- 운영 반영의 범위: 검증한 소스를 `feature/prod`에 반영하고 원격을 확인한다. Android 운영 기기 업로드·컴파일·재시작은 운영자가 수행한다.

## 변경과 보존 조건

`writeVerifiedJsonFile`에서 같은 정상 명령 트랜잭션이 성공적으로 검증 저장한 관리 JSON의 마지막 원문을 명령 종료까지 보관한다. 다음 조건을 모두 만족할 때만 중복 쓰기를 생략한다.

1. 같은 명령의 같은 전체 경로이며 이미 성공한 저장이 있다.
2. 기존 로직에서 이번 백업 회전이 생략되는 저장이다.
3. 마지막 직렬화 결과와 이번 직렬화 결과가 완전히 같다.
4. 파일이 존재하며 경로별 잠금 안에서 읽은 현재 원문도 완전히 같다.

비교용 읽기 자체가 실패하면 기존 전체 저장을 수행한다. 실제 `loadJsonFile`, 임시 파일 파싱, 쓰기, fsync, 교체 및 롤백의 오류 처리는 바꾸지 않는다. 입력의 키 순서나 공백을 정규화하지 않는다.

첫 저장, 변경된 내용, 삭제·변경·손상된 대상의 재쓰기, 별도 명령, 트랜잭션 없는 호출, 명시적인 백업 회전과 롤백은 기존 쓰기를 유지한다. `member.json`, 회원 분리 슬롯, 보상·정산·교육·강탈·인형·모험 기록의 복구용 저널은 최적화 대상에서 제외한다. 펫·스킬·펫홈 활동·게시판의 관리 파일에만 적용하며 다른 데이터의 저장 호출을 지연하거나 합치지 않는다.

명령 분기, 인수 검사, 계산식, 소모·지급, 응답 문구, `allsee`, `loadJsonFile`, `saveJsonFile`, 회원 분리 및 백업 규칙은 변경하지 않았다. 버전과 검증 쓰기 함수만 기준 원문으로 되돌려 전체 `main.js`가 기준과 같은지 검사한다. `Info.js`는 수정하지 않았다.

## 예외 및 동등성 검증

`node tools/test_command_save_reuse.js`

- 기준/개선 소스 각각 21개 그룹: 첫 저장의 즉시 게시, 동일 객체/복제 객체, A→B→A, 키 순서, 새 명령·중첩 깊이, 별도 호출, 현재 파일의 변경·삭제·손상, 명시 백업 회전, 후속 파일 실패, 첫/두 번째 쓰기 실패, 실패 트랜잭션의 재저장 거부, 원본 복구·재시도, DEV/PROD 격리.
- 실제 `/이랏싸이마쎄` 분기와 실제 응답 끝의 저장문을 실행한다. 패키지 1개 소모, 뽑기권 2,500개와 미니펫 10종 지급, 기존 자산 보존, 가방 부족·아이템 없음·응답 실패를 비교한다. 정상 응답과 전체 가상 디스크·백업 원문이 기준과 같다.
- 잘못된 JSON의 오류와 누락 파일의 기존 `null` 반환을 보존하며 빈 데이터로 덮어쓰지 않는다.

`node tools/test_command_save_reuse_rhino.js <Rhino-1.7.15.jar> tools/command_save_reuse_benchmark.json`

- 기준/개선 소스 각각 24개 그룹과 전체 Main/Info 컴파일을 통과한다.
- 실제 Java UTF-8 파일·flush/fsync·파일 교체·백업을 사용해 동일 21개 그룹을 실행한다.
- 비교용 읽기 실패는 기존 전체 저장으로 처리하며, 새 Rhino 스코프는 저장된 내용을 읽되 이전 명령의 재사용 상태를 넘겨받지 않는다.
- Java 스레드 2개에서 명령 잠금, ThreadLocal, DEV/PROD 파일 분리와 모든 잠금 해제를 확인한다.

기존 회귀 시험: `test_member_storage_split`, `test_storage_io_reuse`, `test_pet_musou_storage_split`, `test_server_raid_io`, `test_server_raid_delivery`, `test_pet_skill_preflight`, `test_command_data_loading`, `test_spirit_retirement`, `test_spirit_retirement_cleanup`, `test_guild_marble`, `test_guild_marble_settlement`, `test_guild_marble_improvements`, `test_gm_education`, `test_oct25_ready`, `test_raid_pet_skills`, `test_member_display_search_auth`, `test_ranking_calculation`.

기존 Rhino 회귀 시험: `test_spirit_retirement_rhino`, `test_guild_marble_rhino`, `test_gm_education_rhino`, `test_member_storage_split_rhino`.

기존 시험의 전체 소스 고정 검사 2곳은 후속 저장 최적화를 전용 동등성 시험에 맡기도록 범위를 조정했다. GM교육 `/내정보` 시험은 이전 파일 로드 개선 이후 필요한 3개 합성 파일 경로를 보완했다. 실제 게임 코드의 교육·순위 동작은 수정하지 않았다.

## 전후 비교 방법과 제한

전체 응답 전체를 실행하는 벤치마크가 아니라, 실제 패키지 명령 분기와 응답 끝 저장 구간의 비교다. 회원 분리 파일 없이 합성 펫 데이터를 101/1,001/5,001명 규모로 구성한다. 같은 JVM의 독립 Rhino 스코프 2개에서 전후 순서를 매 쌍 교대하고, 각 크기마다 준비 5회 후 30회 중앙값을 기록한다. 데이터 준비와 결과 검증은 측정 구간 밖이다. 결과 원문은 `command_save_reuse_benchmark.json`에 보관한다.

모든 크기에서 펫 원본 쓰기 2→1회, 백업 등을 포함한 전체 쓰기·fsync 5→4회, 읽기 9→9회다. 5,001명 입력의 쓰기량은 5,038,812→3,359,016바이트(약 33.3% 감소)다. 보상·응답·원본 백업이 같음을 매 쌍 확인한다.

| 합성 펫 수 | 기준 중앙값 | 개선 중앙값 |
| --- | ---: | ---: |
| 101 | 48.55ms | 46.77ms |
| 1,001 | 63.42ms | 55.71ms |
| 5,001 | 170.75ms | 141.42ms |

별도 프로세스를 차례로 실행한 예비 측정에서는 백그라운드 부하로 시간 개선이 일정하지 않았다. 시간 결과는 로컬 PC의 비교 참고값이며 Android MessengerBot의 체감 속도나 고정 향상률을 보장하지 않는다. 실제 운영 기기의 파일 권한·저장장치 지연·메신저 전송은 검증하지 않았다. 운영 데이터 스냅샷은 시험에 사용하거나 수정하지 않았다.

노션 기획 데이터소스에서 저장 중복/성능에 대응하는 제목을 조회한 결과 연결할 항목이 없어 페이지나 속성을 변경하지 않았다. 스킬 파일도 수정하지 않았다.
