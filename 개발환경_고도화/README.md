# LDPlayer 기반 hoiBot 개발환경 고도화

이 폴더는 메신저봇R 기반 AS-IS 구조를 Iris 기반 TO-BE 구조로 전환하기 위한 조사, 설계, 검증 자료를 둔다.

기존 redroid/Iris PoC 자료는 `개발환경_아카이브/redroid_Iris_PoC_20260621/`에 보존한다.

## 목표

```text
AS-IS
LDPlayer
-> KakaoTalk
-> 메신저봇R
-> hoiBot script(main.js / Info.js)
-> LDPlayer 내부 JSON 데이터
```

```text
TO-BE
LDPlayer
-> KakaoTalk
-> Iris
-> 운영 PC hoiBot Server(HTTP/WS)
-> PC 쪽 DB/데이터
-> Discord 등 다른 플랫폼 연결
```

## 핵심 방향

- LDPlayer는 카카오톡 입출력 환경으로 축소한다.
- Iris는 메신저봇R을 대체할 카카오톡 메시지 감지/답장 계층으로 검토한다.
- 운영 PC의 hoiBot Server가 실제 로직, 데이터, 플랫폼 확장의 중심이 된다.
- 개발 PC에서 Codex로 코드를 작성하고 Git으로 운영 PC에 반영한다.
- AS-IS의 LDPlayer 내부 JSON 데이터는 TO-BE에서 운영 PC 서버 쪽 DB/파일로 이전한다.

## 문서

- `TOBE_ARCHITECTURE.md`: AS-IS/TO-BE 아키텍처와 역할 분리
- `FEASIBILITY_CHECK.md`: Iris 기반 구현 가능성 검토
- `CHECKLIST.md`: 운영 PC 기준 단계별 검증 체크리스트
- `NEXT_STEPS.md`: 다음 작업을 이어가기 위한 결정사항과 작업 큐
- `IRIS_INSTALL_RUNBOOK.md`: 운영 PC에서 Iris를 설치하기 위한 1차 실행 절차
- `OPERATION_PC_ENV_FROM_BAT.md`: 기존 배치 파일 기준 운영 PC 경로와 배포 환경 기록
- `tools/`: 운영 PC에서 실행할 Iris 초기 부트스트랩 도구
- `Iris_영상자료_취합.md`: 기존 Iris 영상자료 링크와 요약
- `Iris_정보취합.md`: 기존 Iris 조사 자료

## 현재 상황

운영 PC에는 이미 LDPlayer, KakaoTalk, 메신저봇R이 설치되어 있다.

따라서 다음 단계는 기존 메신저봇R 운영을 바로 변경하는 것이 아니라, 같은 LDPlayer 환경에서 Iris가 동작 가능한지 별도 테스트방 기준으로 검증하는 것이다.

## 다음 확인 순서

1. 기존 메신저봇R 설정과 봇 파일 백업
2. 운영 PC에서 LDPlayer + KakaoTalk 상태 확인
3. LDPlayer Root/ADB 접근 확인
4. Iris.apk 설치와 실행 확인
5. Iris가 KakaoTalk 테스트방 메시지를 감지하는지 확인
6. Iris의 HTTP/WS 이벤트 수신 경로 확인
7. 운영 PC hoiBot Server의 최소 ping/pong PoC 작성
8. Iris `/reply`를 통한 KakaoTalk 답장 PoC 작성
9. PC 쪽 데이터 저장소 설계
10. Discord adapter 추가 가능성 검증

## 보존 자료

- `개발환경_아카이브/redroid_Iris_PoC_20260621/`: 기존 redroid/Iris PoC 이동본

보존 자료는 삭제하지 않고, Iris 구조나 bridge 실험을 참고할 때만 사용한다.
