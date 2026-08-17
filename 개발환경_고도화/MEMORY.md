# hoiBot 고도화 대화 메모리

최종 갱신일: 2026-08-11

이 문서는 새 세션이 작업을 이어받기 위한 최신 상태 스냅샷이다. 대화 전문과 완료 과정은 누적하지 않는다. 확정 결정은 `DECISIONS.md`, 기술 근거는 `references/`를 따른다.

## 현재 목표

- 원이 콘셉트 캐릭터챗은 Kernote의 `프로젝트/character-chat-mvp/`로 코드 이관 중이다. hoiBot과는 현재 PC의 Hyper-V·redroid·KakaoTalk/Iris 실행 환경과 HTTP 계약만 공유하며 hoiBot Server·DB·웹에서는 실행하지 않는다.
- MessengerBotR/Rhino 기반 hoiBot을 네 단계 사업으로 이전한다: 1차 Iris·서버·운영 로직, 2차 관리자 페이지, 3차 사용자 화면, 4차 Discord 또는 Telegram 외부 플랫폼 연동.
- 현재 최우선 목표인 1차는 기존 `main.js`와 `Info.js`의 명령·helper·관리자·자동 처리·JSON 저장 흐름 전체와 운영 데이터를 Iris, hoiBot Server와 MariaDB로 완전히 이전하는 것이다.
- 현재 견적에는 1차만 포함한다. 관리자 페이지, 사용자 화면, Discord·Telegram 연동은 이번 견적에서 제외하고 각각 후속 단계로 별도 산정한다.
- 관리자·사용자 화면의 기존 선행 구현은 보존하되 사업 공개와 검수는 2차·3차 순서를 따른다.
- 모든 채널과 화면은 같은 Application Service를 사용하며 MariaDB에 직접 접근하지 않는다.
- 1차 검증 기간에는 모든 활성·미만료 오픈채팅방의 이벤트를 관찰하되, 명령·회원 인증·게임 기능은 지정방에서만 실행한다. 검증 뒤에는 설정만 바꿔 지정방 관찰로 제한한다.
- 집 PC와 운영 PC를 동일한 Docker image, migration, 환경변수 계약으로 재현한다.
- 1차는 일부 명령의 부분 전환이 아니라 전체 운영 명령 parity, JSON 전체 이관·검증과 Rhino 중단 후 Iris 단독 운영까지 완료해야 한다. 관리자·사용자 웹 공개와 외부 플랫폼 연동은 후속 단계다.

## 현재 진행 위치

- 작업공간: `C:\Users\user\Desktop\hoiBot_modernization`
- 브랜치: `feature/modernization`
- 서버: `개발환경_고도화/runtime/`, TypeScript + Node.js 24 + Fastify 5
- 웹: React + Vite 기반 호이월드 사용자 화면과 관리자 콘솔
- DB: MariaDB 11.8.8, 개발 PC loopback `3308`, migration `001`~`027`
- 개발 포트: API `3002`, 웹 `5175`, redroid Iris `3000`
- 현재 Windows 개발 서버는 작업 스케줄러로 상시 실행한다. 목표 운영 배치는 Hyper-V Ubuntu Docker Compose다.
- 원본 `data/*.json` 33개는 읽기 전용 이전 원본이며 운영 데이터 apply/cutover는 아직 하지 않았다.

## 구현 완료

### 원이 콘셉트 캐릭터챗 이관 원본

- Character MVP Service, migration `028`, `/character/woni` 화면과 관련 통합 hunk는 Kernote 독립 프로젝트 이관 후 이 작업트리에서 제거했다.
- 2026-08-11 기존 결합 상태에서 서버 테스트 98개, 서버 typecheck·build와 프런트 build가 통과했다.
- Kernote 독립 프로젝트의 1차 타입 검사·테스트·빌드도 통과했다.
- 캐릭터 전용 파일과 hunk만 제거했으며 다른 미커밋 작업은 보존했다.
- 실제 migration, Agent API와 Iris 실전 송수신은 수행하지 않았다.

### Iris와 이벤트 처리

- Iris HTTP 이벤트 수신, 정규화, provider-event 중복 방지, command execution, operation, audit, outbox, retry worker를 구현했다.
- 정확한 `/ping`과 비운영 `/info` 진단 명령을 구현했다. `/ping`은 검증된 DB/시스템 이름을 우선하고 Iris `sender`만 있으면 미확인 사용자로 응답한다.
- 일반 텍스트를 제외한 개발 이벤트 모니터를 구현했다. 이미지 파일과 URL은 보내지 않으며 이미지 자동 전달은 OFF다.
- 일반 이벤트 알림은 `호월봇 이벤트 감지 -> 이벤트 종류 -> 실제 방 -> 실제 사용자 -> 방향` 형식으로 통일했다. Iris 명칭, 외부 ID와 type/origin은 카카오톡 알림에서 숨기고 후보 이벤트만 `추가 확인 필요`로 표시한다.
- 수정, 삭제, 방장 가리기, 입퇴장, 답글, 멘션, 단일·다중 이미지, 동영상, 움직이는 이모티콘, 검색·링크 카드의 현재 실측 분류를 서버 매핑에 반영했다.
- 이벤트 분류를 상태가 있는 규칙 레지스트리로 분리했다. 스레드 답글, 불완전 reply/media/rich-card 후보, DB 확인 이모티콘 후보와 필드명만 남기는 unknown fallback을 추가했다.
- 채널 DB 근거와 `IRIS_ALLOWED_OPEN_CHAT_IDS`를 순서대로 검사한다. 제외 이벤트는 HTTP `202` 후 최근 원문 버퍼·identity·활동·사건·명령·outbox 처리 전에 중단한다. 비운영 모니터 방은 진단 전용이다.
- 삭제·방장 가리기 감지는 원문 대신 `#열람번호`, DB에서 확인한 실제 사용자명과 실제 방 이름을 먼저 알린다. 정확한 `/열람 #번호`에서만 redroid DB를 실시간 조회해 최대 1,000자의 원문을 표시한다. 카카오톡 출력에는 `Iris`, `사건`, `용의자` 표현을 사용하지 않는다.
- `NEWMEM/DELMEM`의 내부 단일 member ID와 닉네임을 우선해 방별 입장·퇴장 이력을 저장한다. 입장·퇴장 알림은 방문 횟수, 시간 기록, 활동 집계, 이전 이름과 최근 출입을 hoiBot 형식으로 표시하며 채팅 원문은 저장하지 않는다.
- `observe_all_open` 관찰 모드를 추가했다. 활성 오픈채팅의 event inbox, 정규화 이벤트, 활동 집계, 삭제·가리기, 입퇴장과 검증된 방 이름 변경 이력은 저장하지만 관찰방의 `/ping` 등 명령은 실행하지 않는다.
- Iris 공식 계약과 실측 진단 절차를 `.codex/skills/hoibot-iris-diagnostics/`에 저장하고 로컬 Codex 스킬에도 동기화했다.

### 서버와 MariaDB

- `Controller/Adapter -> Application Service -> Domain Policy -> Repository -> MariaDB` 계층과 transaction manager를 구현했다.
- `/내정보` read model/formatter, 관리자 서버 배정, identity 승인, 감사, 활동·사건 조회를 구현했다.
- currency, inventory, pet/skill/title, guild, home/social, event/ranking, market Application Service와 원장·낙관적 잠금·멱등성을 구현했다.
- `/가방속성`을 관리자 최종 권한(개인 allow/deny 포함), 레거시 번호 정렬, 절대 수량 변경·0 삭제, inventory ledger·audit·outbox가 한 transaction인 수직 슬라이스로 연결했다.
- `/가방`, `ㄴㄴㄴ`의 read-only inventory repository, legacy 순서 formatter와 Iris adapter를 구현하고 실행 전용 rehearsal DB에서 fixture 재적용과 stack 조회를 검증했다.
- 사이트-first 가입, Kakao 코드 인증, 사용자 세션, 관리자 Argon2id 세션/RBAC, 제재, 프리패스, 30일 탈퇴 유예·복구·정리 worker를 구현했다.
- 27개 migration을 실제 개발 MariaDB에 적용했다. 최신 migration은 답글을 별도 관리자 분류에서 제거하고 내부 기타 이벤트로 재분류한다.
- 33개 JSON lossless/checksum importer와 disposable DB rehearsal을 구현했다. 운영 JSON은 수정하지 않았다.

### 홈페이지와 관리자 콘솔

- 브랜드명은 `호이월드`, 외부 봇 프로필명은 `호월봇`, 내부 프로젝트·서버 식별자는 `hoiBot`으로 구분한다.
- 사용자 회원가입, 인증 진행, 로그인, 세션 복원, 내정보 요약, 로그아웃 흐름을 실제 API에 연결했다.
- 공개 홈은 `/api/v1/public/overview`에서 서버·MariaDB 상태, 활성 캐릭터, 활성 Iris 채널, 최근 24시간 이벤트를 집계해 표시한다. 정적 예시 수치는 표시하지 않는다.
- 로그인 내정보는 `/api/v1/player-profiles/current`로 세션의 `player_id`에 해당하는 MariaDB 프로필·재화·서버·길드·펫·홈·패스를 조회한다.
- 아직 작동하지 않는 공개 기능은 숨겼다.
- `/admin` 로그인 후 `/admin/console`로 이동하며 대시보드, 회원, identity, 제재·탈퇴, 프리패스, 운영자·권한, 감사를 권한별로 표시한다.
- 관리자 콘솔에 `로그·모니터링` 메뉴를 추가했다. `super_admin`과 `manager`는 이벤트, 삭제·가리기, 입장·퇴장 목록을 실제 확인된 방·사용자 이름과 함께 볼 수 있다.
- 관리자 목록은 API의 `total`을 전체 건수로 표시하고 화면에 불러온 최대 건수를 별도로 안내한다. 모니터링 종합 현황도 최신 100개 배열 길이가 아닌 MariaDB 전체 건수를 사용한다.
- 1차 검증 기간에는 모든 활성·미만료 오픈채팅방의 확정 답글·단일·다중 이미지·움직이는 이모티콘만 7일 보관한다. 답글과 신뢰된 Kakao 미디어 URL은 MariaDB, 파일은 `runtime/var/retained-event-content/`에 두며 일반 텍스트·후보 이벤트·일반 채팅방 콘텐츠는 저장하지 않는다. 이후 `designated_only`로 제한할 수 있다.
- 관리자 `미디어·답글` 화면은 실제 보관 목록을 조회하고 `event.content.read`가 있는 `super_admin`과 `manager`만 본문·파일을 열람한다. 파일 시스템 경로와 원격 URL은 API에 노출하지 않고 상세·미디어 열람을 감사한다.
- 만료 worker는 7일이 지난 본문·답글 원문·URL·hash·storage key를 비우고 파일을 삭제한다. 삭제·가리기 원문은 이 보관 대상에 포함하지 않고 계속 redroid 실시간 조회만 사용한다.
- 활성 캐릭터가 없으면 완료할 수 없는 identity 연결 버튼을 숨기고 사유를 표시한다. 빠른 메뉴 전환 시 이전 요청이 현재 메뉴 데이터를 덮어쓰지 않도록 마지막 선택 요청만 반영한다.
- 모니터링 목록 표시는 `종류 → 방·사용자 → 한국 시각`으로 통일했다. type/origin, Kakao·event ID 같은 기술값은 화면에서 숨기고 내부 진단용 데이터로만 유지한다.
- `로그·모니터링`은 종합 현황, 삭제·가리기, 메시지 수정, 들낙, 입장·퇴장, 미디어(이미지·영상), 처리 이상만 표시한다. 답글과 이모지·이모티콘은 별도 메뉴에 표시하지 않는다. 검색·링크는 현재 저장 데이터로 내용을 확인할 수 없어 제외했다.
- 들낙은 기간 제한 없이 같은 방·사용자의 입장이 2회 이상이거나 퇴장이 2회 이상일 때 전체 출입 이력으로 집계한다.
- 들낙 `상세 보기`는 방·사용자 식별자로 전체 입장·퇴장 이력을 다시 조회해 팝업으로 표시한다.
- 삭제 감지 화면은 사건번호를 표시하고 `incident.content.read` 권한 확인 후 원문을 redroid에서 실시간 조회한다. 원문은 MariaDB에 저장하지 않고 열람 사실만 감사한다.
- 사용자·관리자 API는 분리된 REST resource URL을 사용한다.
- 삭제·가리기 원문 조회는 `super_admin`과 `manager`가 사용할 관리자 권한으로 확정했다. 현재 원문 저장 없이 redroid 실시간 조회 방식이며 홈페이지 원문 조회 API·화면은 아직 구현 전이다.

## 최근 검증된 사실

- redroid Iris callback은 hoiBot API `3002`로 연결되고 실제 이벤트에 HTTP `202`를 반환한다.
- 단일 텍스트 수정의 실측에서 `SYNCMODMSG.logId`가 원본 행을 가리켰고, 원본 행의 현재 `message`는 수정 후 본문, `v.modifyLog`의 암호문은 Iris `/decrypt`로 복호화한 수정 전 본문이었다. 다중 수정 이력은 아직 미검증이다.
- `/ping` 왕복과 응답 이벤트 `isMine=true`를 확인했다. 반복 검증은 서로 다른 이벤트 10건에서 종료한다.
- KakaoTalk 앱 데이터를 교체하면 Iris HTTP는 살아 있어도 기존 DB handle 때문에 이벤트가 멈출 수 있으며 Iris 재시작 후 복구된다.
- Iris `sender`와 별도 `names.db` 캐시는 실제 화면 이름과 달라질 수 있어 미신뢰 관측값으로만 사용한다.
- Iris `/query`에서 `main` 1개, `db1` 10개, `db2` 33개, `db3` 5개, 총 49개 물리 테이블을 확인했다.
- 현재 DB에는 `db2.friends`가 없다. 일반 `MultiChat` 참여자의 화면 이름은 현재 연결된 DB만으로 보장할 수 없다.
- `OM + link_id + 활성·미만료 open_link`는 오픈채팅 단체방으로 확인됐다.
- Iris v0.32는 현재 `100 ms` 간격으로 증가한 `chat_logs._id`를 폴링한다. `chat_logs` 외 로컬 테이블은 공식 빌드가 자동 전달하지 않는다.
- 삭제 이벤트의 새 이벤트 ID와 원본 대상 ID는 다르다. 대상 ID는 payload에서 문자열로 읽어 같은 `chat_id`와 조회해야 한다.
- 삭제된 텍스트 행은 `type=16385`로 남을 수 있으며 Iris 복호화에 필요한 전체 행 문맥을 조회하면 원문 복원이 가능하다.
- 방장 가리기는 `SYNCREWR + feedType=26 + coverType=openchat_blind`로 확인했다.
- 발신 메시지 가리기는 중간 `feedType=13` 행의 `prev_id`를 한 번 따라가고, 수신 메시지 가리기는 재작성된 행의 `v.previous_message`, `v.previous_enc`, `chatLogInfos[0].type`으로 복호화한다.
- 2026-08-07 최근 membership DB 표본 89건에서 입장 44건은 `NEWMEM/feedType=4/members[0]`, 퇴장 45건은 `DELMEM/feedType=2/member`였고 모두 단일 사용자이며 내부 ID와 최상위 ID가 일치했다.
- 최신 자동 검증은 runtime 테스트 158개와 runtime typecheck/build, `main.js`·`Info.js` 구문 검사를 통과했다. `/가방` Shadow는 실행 전용 MariaDB에 migration 33개와 71문장 합성 fixture를 2회 적용해 대표 35개 테이블을 검증했고, MariaDB 재시작 전후 모두 stack 5개·출력 7줄로 동일했다. `/가방속성` 격리 리허설은 수량 20→7·delta -13과 동일 event 재실행 시 ledger/operation/execution/audit/outbox 각 1건을 확인했다. 운영 JSON과 운영 DB는 건드리지 않았다.

## 미검증 항목

- 2026-08-07: 사진(`type=2`, `MSG`)과 메시지 수정(`type=0`, `SYNCMODMSG`)은 redroid KakaoTalk `db1.chat_logs`에서 확인되었다. Iris 로그도 hoiBot 이벤트 URL의 HTTP `202` 응답을 기록한다. 그러나 현재 실행 중인 hoiBot Server가 조회하는 MariaDB의 최신 `event_inbox`/`normalized_provider_events` 시각은 이 이벤트들보다 앞선 상태다. 관리자 화면 문제가 아니라 수신 요청과 MariaDB 적재 경로의 불일치 또는 실행 인스턴스/DB 연결 대상 차이를 다음 작업에서 확인해야 한다. 원문·실제 식별자·토큰은 문서에 기록하지 않는다.

- 오픈채팅 1:1의 실제 `chat_rooms.type`과 `open_link` 관계
- 동일 랜덤 오픈프로필 사용자의 오픈채팅 단체방·1:1 간 `user_id` 안정성
- 다른 참여자 멘션, 반응, 파일, 자진 퇴장과 강퇴의 확정 구분
- 닉네임·프로필 변경 시 로컬 테이블 변경과 snapshot-diff observer의 오탐 기준
- Iris WebSocket `/ws`, redroid 재시작 후 설정·데이터 유지
- 삭제·가리기 미디어 원문 복구 범위와 KakaoTalk 로컬 보존 기간
- 실제 Rhino `/내정보` 출력과 신규 formatter의 문자 단위 golden parity
- Ubuntu Docker 환경에서 동일 image/migration/backup/restore 재현

## 열린 질문

- 신규 거래소 등록 만료 기간, 등록 수수료, 취소 환불, 회원권 혜택을 레거시와 동일하게 유지할지
- Discord 첫 제공 기능과 읽기·쓰기 범위
- 저장소에 없는 홈 활동·가구 배치 runtime 파일의 실제 구조
- 운영 전환 전 read-only smoke 시간과 maintenance window
- 공식 Iris를 유지할지, 검증된 최소 범위의 별도 table observer를 운영할지
- 관리자 사건 화면에서 redroid DB 보존 기간이 지난 삭제·가리기 원문까지 반드시 조회해야 하는 운영 요구가 생길지. 요구가 없다면 해당 원문 미저장을 유지한다.

## 다음 작업

1. 운영자와 관리 채팅방의 다대다 배정 테이블을 추가하고 모든 방별 모니터링 조회·원문·미디어 API에 서버 강제 범위 필터를 적용한다.
2. 오픈채팅 1:1 샘플로 방 유형과 동일 사용자 identity 안정성을 검증한다.
3. 남은 이벤트 유형을 통제된 테스트로 검증하고 `IRIS_EVENT_CAPABILITY_MATRIX.md`와 JSON 매핑을 함께 갱신한다.
4. 실제 Rhino `/내정보` 표본과 신규 formatter의 golden parity를 완료한다.
5. 2단계 채널 필터를 명령·활동·사건 처리 경로 전체에 적용했는지 통합 테스트한다.
6. 관리자 사건 화면에 역할별 원문 실시간 조회와 원문을 포함하지 않는 조회 감사를 구현한다.
7. 승인된 identity로 가입, 서버 배정, 관리자 mutation을 end-to-end 검증한다.
8. 도메인 Service를 legacy 명령 fixture와 대조한 뒤 Iris·Discord·관리 API adapter에 수직 기능 단위로 연결한다.
9. Ubuntu Docker에서 bootstrap, migration, backup/restore rehearsal을 반복한다.
10. 전체 기능과 운영 snapshot reconciliation이 통과된 뒤 일괄 전환 점검표를 실행한다.

## 갱신 규칙

1. 최신 목표, 진행 위치, 확인 사실, 미검증 항목, 열린 질문, 다음 작업만 유지한다.
2. 완료된 과정과 대화 요약은 누적하지 않는다.
3. 사용자 결정은 `DECISIONS.md`, 기술 근거는 해당 `references/` 문서에 기록한다.
4. 토큰, 계정정보, 실제 식별자, 메시지 원문과 개인정보는 기록하지 않는다.
