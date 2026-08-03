# hoiBot 고도화 대화 메모리

최종 갱신일: 2026-08-03

이 문서는 새 대화 세션이 현재 작업을 이어받기 위한 최신 상태 스냅샷이다.
대화 전문이나 세션별 누적 로그를 저장하지 않고, 실행에 필요한 현재 맥락만 유지한다.
확정 결정은 `DECISIONS.md`를 따르며 이 문서에서 다시 결정하지 않는다.

## 현재 목표

- Iris를 hoiBot의 KakaoTalk 입출력 계층으로 사용해 고도화한다.
- PC/redroid 환경에서 KakaoTalk + Iris 연결 상태를 단계적으로 검증한다.
- TypeScript/Node.js 24 LTS/Fastify 5 기반 hoiBot Server로 기존 게임 로직을 점진적으로 이전한다.
- 전환 우선순위는 `ASAP`이며 구현과 검증이 완료된 기능부터 가능한 한 빠르게 순차 전환한다.
- 기존 운영을 즉시 변경하지 않고 별도 테스트 흐름에서 입력·응답·저장 경로를 먼저 확인한다.
- 서버 본구현 전에 redroid/KakaoTalk/Iris에서 테스트 명령의 서버 왕복과 이벤트 전송 범위를 실제로 확인한다.

## 현재 진행 위치

- PC/redroid 구성과 기준 영상이 확정됐다.
- hoiBot Server 구현 스택이 확정됐다.
- `개발환경_고도화/runtime/`에 Fastify 기반 Lite 서버와 Iris HTTP 이벤트 수신 API가 존재한다.
- 고도화 문서는 결정, 대화 메모리, 정보성 참조자료로 분리됐다.
- 최신 `feature/prod`의 `4f00533`에서 `feature/modernization` 브랜치를 생성했다.
- 고도화 전용 작업공간은 `C:\Users\user\Desktop\hoiBot_modernization`이다.
- 1단계 redroid/KakaoTalk/Iris → hoiBot Lite Server 연결 및 `/ping` 감지 검증을 완료했다.
- 실제 redroid DB와 Iris 원본 코드를 기준으로 이벤트 감지 가능 범위를 `references/IRIS_EVENT_CAPABILITY_MATRIX.md`에 정리했다.
- Iris가 다른 방에서 감지한 모든 단일 이미지를 `/ping` 테스트방으로 전달하는 Lite Server 기능을 구현하고 로컬 검증을 통과했다.

## 확인된 현상

- 사용자가 redroid 환경이 현재 실행 중이라고 확인했다.
- 저장소의 Lite 서버에는 health, ready, ping, version 및 Iris 이벤트 수신 기반이 구현돼 있다.
- redroid의 KakaoTalk과 Iris가 실행 중이며 Iris HTTP `3000` 포트가 정상 응답한다.
- Iris가 hoiBot Lite Server `3100` 포트로 실제 KakaoTalk 이벤트를 전달한다.
- 최근 이벤트 창에서 서로 다른 `/ping` 이벤트 16건을 감지해 요청 기준 10건을 충족했다.
- 정확한 `/ping` 이벤트의 `chat_id`를 이용한 Iris `/reply` `pong` 전송이 성공했다.
- 앞으로 `/ping` 반복 검증은 서로 다른 이벤트 10건까지만 집계하고 즉시 종료한다.
- 정확한 `/ping` 입력에 hoiBot Server가 Iris `/reply`를 사용해 `발신자이름 pong`으로 자동 응답하도록 구현했다.
- 실제 KakaoTalk `/ping` 입력과 `발신자이름 pong` 출력이 서버 이벤트에서 연속 관측됐고 응답 이벤트의 `isMine=true`를 확인했다.
- 자동 테스트 10건, 타입 검사와 빌드는 통과했다.
- Node.js 프로젝트를 저장소 최상위 `runtime/`에서 `개발환경_고도화/runtime/`으로 이동했다.
- 이동 후 새 경로에서 Lite 서버를 재기동했으며 `0.0.0.0:3100` readiness 확인을 통과했다.
- Iris는 `chat_logs`의 새 행을 HTTP/WebSocket으로 전달하며 공식 고수준 분류는 `message`, `new_member`, `del_member`, `unknown`이다.
- 현재 redroid 이력에서 `NEWMEM`, `DELMEM`, `SYNCMODMSG`, `SYNCDLMSG`, `SYNCREWR` 원시 origin을 확인했다.
- 답글은 `type=26`과 source attachment 필드로 감지 가능하고, 수정·삭제는 각각 `SYNCMODMSG`, `SYNCDLMSG`를 서버가 직접 정규화해야 한다.
- 현재 서버에서 상대가 보낸 일반 답글을 `type=26`, `isMine=false`, `src_isThread=false`와 source 연결 필드로 실관측했다.
- 봇을 실제 `@멘션`한 메시지를 `type=1`, `origin=MSG`, `attachment.mentions[]`의 위치·길이·사용자 ID 메타데이터와 `bot_command` 구조로 실관측했다.
- 단일 이미지를 `type=2`, `origin=MSG`, `isMine=false`로 실관측했고 `attachment.url`, 썸네일 URL, 크기와 이미지 규격 메타데이터를 확인했다.
- 이미지 본문은 이벤트에 포함되지 않고 Kakao CDN URL로 제공되며, 해당 URL의 GET 요청에서 `image/png` 본문 수신을 확인했다.
- 단일 이미지 전달은 원본 방과 테스트방의 분리, Kakao CDN HTTPS, 용량·시간 제한을 적용하고 다중 이미지는 제외한다.
- 최근 수신 이미지 2건을 테스트방으로 재전송했고, KakaoTalk DB에서 같은 대상 방에 생성된 발신 이미지 2건을 확인했다.
- 모든 단일 이미지 전달 버전으로 서버를 재기동한 뒤 원본 방과 테스트방에서 이미지 이벤트가 1건씩 감지돼 자동 전달 왕복을 확인했다.
- 사용자 요청으로 이미지 자동 전송을 OFF했다. 이미지 감지는 유지하며 대상 방 설정 없이 서버를 재기동했다.
- 서버 PC의 Node.js 런타임에서 Iris `/query`를 통한 redroid KakaoTalk DB 읽기 연결을 확인했다.
- KakaoTalk DB의 3개 연결 스키마와 테이블 구조·행 개수를 개인정보 없이 탐색해 `references/KAKAOTALK_DB_SCHEMA_INVENTORY.md`에 기록했다.
- 이벤트 검증 근거는 `references/IRIS_EVENT_CAPABILITY_MATRIX.md`, 서버 구현용 필드·이벤트 매핑은 `references/IRIS_SERVER_EVENT_MAPPING.json`으로 분리했다.

## 미검증 항목

- 다른 참여자 `@멘션`의 동일 구조 여부와 자진 퇴장/강퇴 구분 방식
- 닉네임 변경·반응 이벤트를 위한 별도 테이블 감시 필요성
- Iris WebSocket `/ws` 수신
- redroid 재시작 후 데이터와 설정 유지
- hoiBot Server와 PC 데이터 저장소 연결

## 열린 질문

- hoiBot Server를 Windows 호스트와 Ubuntu/Linux VM 중 어디에서 상시 실행할지
- PC 데이터 저장소의 DB 종류와 백업·복구 방식
- 기존 JSON 데이터를 이전할 순서와 읽기 전용 첫 명령

## 다음 작업

1. 별도 테스트방에서 다른 참여자 멘션, 수정, 삭제, 입장, 자진 퇴장, 재입장 후 강퇴를 각각 1건씩 실검증한다.
2. 단일 이미지의 테스트방 실제 전달을 확인한 뒤 다중 이미지, 파일, 이모티콘과 반응 이벤트를 실검증한다.
3. HTTP 검증과 별도로 WebSocket 수신을 확인한다.
4. 검증 결과를 입력 계약으로 삼아 hoiBot Server 이벤트 정규화 계층을 구현한다.

## 최근 대화 요약

- 고도화 방향을 YouTube 기준의 PC + redroid 환경으로 확정했다.
- 선택되지 않은 다른 실행환경 기술스택은 문서에서 제거했다.
- hoiBot Server 구현 스택을 TypeScript + Node.js 24 LTS + Fastify 5로 확정했다.
- 대화 메모리와 확정 결정 문서를 분리하기로 했다.
- 고도화 작업을 별도 `feature/modernization` 브랜치에서 진행하기로 했다.
- hoiBot을 Iris 기반으로 고도화하기로 확정했다.
- 전환 우선순위를 `ASAP`으로 확정했다.
- 서버 본구현 전에 redroid/KakaoTalk/Iris의 연결·왕복을 먼저 검증하고, 메시지 외 이벤트와 부가 데이터의 전송 범위를 확인하기로 했다.
- 실제 연동 검증 결과를 기준으로 hoiBot Server 구현을 진행하기로 했다.
- `/ping`을 서로 다른 이벤트 10건 이상 감지할 때까지 확인해 달라는 요청에 따라 16건 감지를 확인했다.
- 이후 `/ping` 검증은 10건을 상한으로 제한하기로 확정했다.
- 정확한 `/ping` 입력은 서버 연결 확인 명령으로 사용하고 `발신자이름 pong`으로 답하기로 확정했다.
- 고도화용 Node.js 프로젝트를 `개발환경_고도화/runtime/` 내부에서만 관리하기로 확정했다.

## 갱신 규칙

1. 의미 있는 고도화 세션 종료 시 이 문서를 최신 상태로 갱신한다.
2. 완료된 항목은 미검증 목록에서 제거하고 확인된 현상 또는 진행 위치에 반영한다.
3. 오래된 진행 맥락과 다음 작업은 현재 상태로 교체하며 세션별로 누적하지 않는다.
4. 사용자 결정이 필요한 내용은 열린 질문에 두고 `DECISIONS.md`에 먼저 기록하지 않는다.
5. 토큰, 카카오톡 원문, 계정정보, 개인정보는 기록하지 않는다.
