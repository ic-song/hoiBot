# Iris bootstrap tools

이 폴더는 운영 PC에서 Iris 전환 가능성을 검증하기 위한 임시 부트스트랩 도구를 둔다.

최종 TO-BE 운영 제어 계층은 BAT가 아니라 운영 PC hoiBot Server의 HTTP/WS 관리 API다. 이 BAT 파일들은 서버 제어 계층이 만들어지기 전, LDPlayer/ADB/Iris 설치 상태를 확인하기 위한 초기 도구다.

## 파일

```text
01_Iris_APK_설치.bat
```

## 사용 위치

운영 PC에서 실행한다.

개발 PC에는 LDPlayer가 없을 수 있으므로 이 도구를 실행 대상으로 보지 않는다.

## 기본 전제

- LDPlayer 설치 경로: `C:\LDPlayer\LDPlayer9`
- ADB 경로: `C:\LDPlayer\LDPlayer9\adb.exe`
- Iris APK 대상 경로: `/data/local/tmp/Iris.apk`

## 실행

```bat
개발환경_고도화\tools\01_Iris_APK_설치.bat
```

기본 동작:

1. ADB 경로 확인
2. 연결된 LDPlayer device가 정확히 1개인지 확인
3. 로컬 `Iris.apk`가 없으면 GitHub latest release에서 다운로드
4. `Iris.apk`를 `/data/local/tmp/Iris.apk`로 push
5. LDPlayer 내부 파일 존재 확인
6. Root 권한과 Iris start 가능성을 참고 확인

## 주의

- 기존 메신저봇R 파일을 수정하지 않는다.
- 기존 운영 JSON 데이터를 수정하지 않는다.
- KakaoTalk 계정 상태를 변경하지 않는다.
- 여러 ADB device가 연결되어 있으면 안전을 위해 중단한다.
