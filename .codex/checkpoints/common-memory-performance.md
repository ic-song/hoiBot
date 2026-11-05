# 공통 명령 처리 직렬화 성능

- 작업 키: common-memory-performance
- 작업 상태: 작업 완료
- 정리 후보: 예
- 요청: 인형만 아니라 전체 로직 공통 지연이 의심된다는 후속 지시. 기존 데이터·기능·자동/수동 복구 유지.
- 위치: C:/Users/user/.codex/worktrees/hoiBot-common-performance
- 브랜치: feature/common-performance
- 기준: origin/feature/prod 671e62cc / ver_2.771
- 확인: response는 공용 dataTransactionLock 안에서 회원/운영 로그를 읽으며 attachMemberSplitStores가 로그 전체 지문을 계산한다. 회원 저장 때 buildMemberSplitSavePlan이 다시 계산한다. 일반 명령의 tryLock 실패는 기존 정책대로 무응답 반환. 이 정책은 변경하지 않는다.
- 이 공통 지문/스트림 계층은 3b7447fc(2.766 메모리 최소화)에서 도입. 인형 성공/실패만의 문제가 아닌 전체 명령에 영향을 줄 수 있는 확인된 공통 비용. 실제 Android 주원인 확정은 아직 불가.
- 수정 후보: 작은 순수 JSON 말단 객체만 최대32키·이스케이프 전4096문자 한도로 native JSON.stringify를 묶어 사용. 배열·큰/중첩 객체·접근자·toJSON·사용자 프로토타입은 기존 스트림 처리. 전체 파일을 한 문자열로 만들지 않으며 저장 결과/해시/검증·백업·롤백·복구는 유지.
- 로컬 Rhino 합성(5회 중앙값) 비교: 로그120999B 222.79→84.77ms, 회원639625B 198.75→172.38ms, 펫693871B 103.12→96.97ms. 실제 운영 응답 시간/개선율 아님. 지문 완전 일치 확인.
- 임시 검증: C:/Users/user/AppData/Local/Temp/hoiBot/common-performance. 본 작업 전용 합성 파일만 사용하고 완료 전 정리.
- 다음: JSON 완전 동일성·getter/toJSON·오류/메모리 경계·실제 Java 파일 저장 및 백업/복구 테스트, Rhino 전체 컴파일, 공통 경로 영향을 명확히 보고. 추가 운영반영 시 버전/노트·소스/원격 검증·알림 순서 준수.

## 검증 및 반영 준비

- JSON 내용·예외·getter/toJSON 호출·fallback·범위 경계 완전 일치 2092회, Rhino 동일 계약46회 통과. 실제 Java FileStream/검증 저장/2세대 백업/임시 쓰기 실패/해시 불일치/순환/변환 후 잘못된 데이터 거절/백업 원문 수동 복원/실제 recoverInterruptedMemberWrite 자동복구와 재호출 멱등성14회 통과. 실제 회원 로그 부착/변경 없음/추가/기존 기록 수정/리비전/손상 거절9회 통과. 출력 조각은 합성 극한 입력에서도32768문자 이하, 전체 파일 단위 직렬화 없음.
- 공용 save/load/검증 저장/롤백/게시 복구 및 도메인 함수는 기존 소스와 동일. Node main/Info 문법, 전체 JS4개 Rhino128MiB 컴파일, diff 검사 통과. 운영 Android 시간·명령 전체 개선율은 미측정.
- ver_2.772 개발자노트·main.js 일치. 다음은 임시 검증 파일 정리, 소스 push 후 PR 운영 소스 반영/원격 검증/버전 알림. 실제 지연이 남으면 기존2.771 인형 단계 진단과 /맞짱시간체크로 공통/IO/전송을 추가 구분해야 한다.

- 작업 전용 임시 검증 파일/합성 입력/JAR 정리 완료. 운영 데이터 및 다른 작업 파일 미변경. 기획 DB 메모리/최적화/속도 제목 검색 일치 없음으로 새 Notion 문서/속성 변경 없음.

## 운영 소스 반영 완료

- 소스 e92aa6ceb407a00beab01a49dcf1567abafe0fda 푸시·원격 일치 후 PR #229(https://github.com/ic-song/hoiBot/pull/229) 병합. origin/feature/prod = e335da627b5b4236a601cfd652e3d130f80a7533. 소스 포함, 제한 직렬화 코드/main.js·개발자노트 ver_2.772 및 날짜 확인. 원래 폴더 feature/prod도 동일 커밋으로 ff-only 갱신. 미추적 사용자 파일7개 유지.
- PlayMCP 알림 스킬로 정확히 ver_2.772 한 번 전송 성공. 운영 런타임 접속/업로드/컴파일은 수행하지 않음.
- 공통 계산 비용은 코드/로컬 합성으로 확인·완화했으나 운영 전체 지연의 단일 원인 또는 실제 응답 개선을 확정하지 않는다. 필요시 기존 /맞짱시간체크와2.771 인형 단계 출력으로 공통/IO/전송을 구분해 추가 진단. 이미 검증·배포한 직렬화 보완은 반복하지 않는다.
