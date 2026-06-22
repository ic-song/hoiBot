# Iris 설치 런북

작성일: 2026-06-22

## 현재 상태

이 문서는 운영 PC에서 LDPlayer 안에 Iris를 설치하기 위한 1차 실행 절차다.

현재 Codex 작업 PC에서는 아래 파일이 확인되지 않았다.

```text
C:\LDPlayer\LDPlayer9\adb.exe
C:\LDPlayer\LDPlayer9\ldconsole.exe
```

따라서 실제 설치는 LDPlayer가 설치된 운영 PC에서 진행한다.

## 전제

- 운영 PC에 LDPlayer가 설치되어 있다.
- LDPlayer 안에 KakaoTalk이 설치되어 있다.
- 봇 계정으로 KakaoTalk 로그인이 가능하다.
- 기존 메신저봇R 운영은 삭제하거나 변경하지 않는다.
- Iris 검증은 운영방이 아니라 별도 테스트방에서 먼저 진행한다.

## 다운로드

공식 GitHub Releases에서 최신 Iris 파일을 받는다.

```text
https://github.com/dolidolih/Iris/releases
```

Windows 운영 PC 기준으로 필요한 파일:

```text
Iris.apk
iris_control.ps1
```

권장 보관 위치:

```text
C:\Iris\v0.31\
```

## 1. LDPlayer ADB 확인

운영 PC PowerShell에서 실행한다.

```powershell
cd C:\LDPlayer\LDPlayer9
.\adb.exe devices
```

성공 기준:

```text
List of devices attached
...    device
```

`device`가 없으면 LDPlayer 실행 상태, Root 권한, ADB 디버깅 설정을 먼저 확인한다.

## 2. Iris.apk push

부트스트랩 BAT을 사용할 경우:

```bat
개발환경_고도화\tools\01_Iris_APK_설치.bat
```

수동으로 진행할 경우:

```powershell
cd C:\Iris\v0.31
C:\LDPlayer\LDPlayer9\adb.exe push .\Iris.apk /data/local/tmp
```

공식 문서 기준 Iris는 APK를 Android 환경의 `/data/local/tmp`에 복사한 뒤 실행한다.

## 3. Iris 설치 및 시작

```powershell
cd C:\Iris\v0.31
.\iris_control.ps1 install
.\iris_control.ps1 start
```

`iris_control.ps1`은 TO-BE 아키텍처의 필수 구성요소가 아니라, 초기 설치와 실행을 위한 공식 관리 스크립트로 사용한다.

최종 TO-BE에서는 운영 PC hoiBot Server의 WS/HTTP 관리 API가 이 역할을 점진적으로 대체한다.

## 4. 상태 확인

```powershell
cd C:\Iris\v0.31
.\iris_control.ps1 status
```

이후 브라우저에서 dashboard 접속을 확인한다.

```text
http://[ANDROID_IP]:3000/dashboard
```

LDPlayer 환경에서는 Android IP 또는 포트 접근 방식이 다를 수 있으므로, 실제 접속 주소는 설치 후 확인한다.

## 5. 1차 성공 기준

- [ ] ADB에서 LDPlayer가 `device`로 보인다.
- [ ] `Iris.apk`가 `/data/local/tmp`로 push된다.
- [ ] `iris_control.ps1 install`이 성공한다.
- [ ] `iris_control.ps1 start`가 성공한다.
- [ ] Iris dashboard 또는 status 확인이 된다.

## 6. 다음 단계

1. 테스트방 메시지를 Iris가 감지하는지 확인한다.
2. Iris의 HTTP endpoint 또는 WebSocket 이벤트를 운영 PC 서버로 받을 수 있는지 확인한다.
3. `/ping` 메시지에 `pong`으로 답장하는 최소 PoC를 만든다.
