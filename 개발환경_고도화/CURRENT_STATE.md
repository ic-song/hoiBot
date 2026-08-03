# hoiBot 고도화 공통 메모리

최종 갱신일: 2026-08-03

이 문서는 대화 세션이 바뀌어도 hoiBot 고도화의 확정 사항과 검증 상태를 동일하게 유지하기 위한 단일 기준 문서다.
새 세션에서 고도화 작업을 시작할 때는 추측이나 이전 대화 기억보다 이 문서를 먼저 확인한다.

## 확정한 실행환경

LDPlayer는 고도화 실행환경으로 사용하지 않는다.
PC에서 redroid를 사용하는 다음 구성을 기준으로 확정한다.

```text
Windows PC
-> Hyper-V
-> Ubuntu/Linux VM
-> Docker
-> redroid
-> KakaoTalk + Iris
-> hoiBot Server over HTTP/WebSocket
-> PC-side DB/data
```

- redroid Android 화면 접근과 점검에는 ADB와 `scrcpy`를 사용한다.
- Iris는 KakaoTalk 메시지 감지와 답장 연결 계층으로 사용한다.
- 게임 명령 처리와 데이터 저장은 단계적으로 PC의 hoiBot Server로 이전한다.
- 기존 운영환경을 즉시 대체하지 않고 별도 테스트 환경에서 먼저 검증한다.

## 기준 영상

YouTube 3개 중 PC/redroid 구성의 기준 영상은 세 번째 `Iris를 이용한 봇 만들기`다.

- 링크: https://www.youtube.com/watch?v=H43VTOsKDXY
- `7:46`: Windows Hyper-V 기반 Linux 설치
- 이후: Docker와 redroid 구성
- `21:20`: Iris 설치
- `48:02`: `irispy-client`
- `56:29`: `iris_bot` 실행

상세 자동자막 요약은 `Iris_영상자료_취합.md`를 참고한다.

## 현재 확인된 사실

- 사용자가 현재 고도화 환경은 LDPlayer가 아니라 redroid라고 확인했다.
- 사용자가 redroid 환경이 현재 실행 중이라고 확인했다.
- PC/redroid 구성은 위 세 번째 영상을 기준으로 확정했다.

## 아직 검증 완료로 처리하지 않는 항목

- redroid 내부 KakaoTalk과 Iris의 현재 상세 상태
- Iris HTTP 이벤트의 redroid 환경 실수신
- Iris WebSocket `/ws` 수신
- Iris `/reply`를 이용한 KakaoTalk 답장
- `/ping` 입력부터 `pong` 답장까지의 전체 왕복
- redroid 재시작 후 데이터와 설정 유지
- hoiBot Server 및 PC DB 연결

위 항목은 실제 명령 결과나 테스트 증거를 확인한 뒤에만 완료로 변경한다.

## 세션 간 기록 규칙

1. 이 폴더의 `AGENTS.md` 지침에 따라 고도화 작업을 시작하면 이 문서를 먼저 읽는다.
2. 확정 결정, 확인된 사실, 미검증 항목을 서로 섞지 않는다.
3. 실제 검증을 마치면 날짜, 실행 명령, 기대 결과, 실제 결과를 이 문서 또는 별도 결과 문서에 기록한다.
4. 토큰, 원본 대화 내용, 계정정보, 개인식별정보는 기록하지 않는다.
5. 대화 기억만으로 완료 처리하지 않으며 저장소의 최신 문서와 현재 환경을 다시 확인한다.
