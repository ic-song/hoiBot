# 프리미엄 만료 조회·길드마블 정산 원문 최적화

- 기준: `e1d2edf4d8cf8d43232d4619e823eb81e8639473` / ver_2.715 → ver_2.716, 2026-10-27 KST.
- 범위: 단일 회원 프리미엄 만료 조회와 길드마블 정산 전 문자열 재사용. 명령·권한·UI·날짜·보상·저장 형식과 게시 순서는 유지한다.
- 단일 회원 지정 시 회원 키를 열거하지 않는다. 상속/비열거 속성·미등록 회원·문자열 외 인자의 기존 제외 결과를 보존한다. 전체 정리는 기존 순회와 순서를 유지한다. 만료일 당일은 만료가 아니며 영구권·비활성·잘못된 날짜 판정도 유지한다.
- 마블은 검증 후 생성한 확정 문자열을 같은 경로의 저장과 복구 원문에 재사용한다. `writeMemberSplitSlot`은 문자열만 받아 저장하고, `endDataSaveTransaction`/`beginDataSaveTransaction`은 저장 문맥만 다루므로 사이에 경기 객체 변경은 없다. 회원·경기 저널·백업·fsync·잠금·DEV/PROD 경로는 변경하지 않는다.

## 검증

- `node tools/test_targeted_performance.js <Rhino-1.7.15.jar>`: Node 7그룹 + 키 열거 계측, Rhino 7그룹 통과. 이전 소스와 만료/당일/미래/영구/비활성/누락/비정상 날짜/엄격한 불리언/잘못된 대상/상속·비열거 속성/오류 전파/5,000명 결과를 대조한다. 마블은 DEV/PROD 원문·순서·변경 표시, 무변경 무작업, 검증·직렬화·쓰기·트랜잭션 실패의 예외와 경계를 대조한다.
- `node tools/test_guild_marble.js`: 29그룹 통과.
- `node tools/test_guild_marble_settlement.js`: 5그룹 통과. 실제 7인수 콜백·오류 복구·미지급만 처리·중복 지급 방지·DEV/PROD 포함.
- `node tools/test_guild_marble_improvements.js`: 14그룹 통과.
- `node tools/test_guild_marble_rhino.js <Rhino-1.7.15.jar>`: 15개 시나리오 출력 통과. 전체 Main/Info 컴파일, 실제 Java 파일/fsync/rename·동시 스레드·게시 중단·새 전역 복구·정산 재추첨/중복 지급 방지·DEV 격리·리셋 환급 포함.
- `node tools/test_premium_skill_restore.js <Rhino-1.7.15.jar>`: Node 9그룹과 호출부 저장/실패 복구, Rhino 9그룹·전체 Main/Info 컴파일 통과.
- `node --check main.js` 통과. 운영 스냅샷은 테스트에 사용하지 않았다.

## 성능 근거와 한계

- 단일 회원 조회의 전체 회원 키 열거: 1회 → 0회. 검사 대상은 회원 수와 관계없이 지정 회원 1명이다.
- 변경된 정산 순위의 사전 게시 구간: 동일 객체 직렬화 2회 → 1회. 이후 실제 정산으로 변경된 객체의 저장은 그대로 수행한다.
- 위 수치는 작업 횟수 계측이다. 응답 시간·힙·운영 기기의 개선율은 측정하지 않았다. 운영 기기 업로드·컴파일·재시작은 운영자 수행 범위다.
