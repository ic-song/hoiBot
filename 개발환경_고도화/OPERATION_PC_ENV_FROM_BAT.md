# 운영 PC 환경 기준값

작성일: 2026-06-22

이 문서는 현재 저장소의 `tools/*.bat` 파일에서 추출한 운영 PC 환경 기준값을 기록한다.

주의: 아래 값은 운영 PC에 직접 접속해서 확인한 값이 아니라, 기존 운영 반영 배치 파일에 설정된 값이다. 실제 운영 PC에서 실행할 때는 `adb devices`, `ldconsole list2`, 파일 경로 조회로 다시 검증해야 한다.

## 기준 배치 파일

```text
tools/03_main_운영반영.bat
tools/04_info_운영반영.bat
tools/06_LD플레이어_동기화.bat
```

## Windows 실행 파일 경로

```text
LD_CONSOLE_EXE=C:\LDPlayer\LDPlayer9\ldconsole.exe
ADB_EXE=C:\LDPlayer\LDPlayer9\adb.exe
```

의미:

- `ldconsole.exe`: LDPlayer 인스턴스 목록 조회 및 인스턴스별 ADB 명령 실행
- `adb.exe`: LDPlayer Android 환경과 직접 통신

## LDPlayer 대상 선택 방식

```text
TARGET_ADB_DEVICE=auto
USE_DIRECT_ADB=0
TARGET_LD_INDEX=auto
```

현재 배치 동작:

- `adb devices`에서 연결된 `device`가 정확히 1개면 직접 ADB 방식을 우선 사용한다.
- 직접 ADB를 쓰지 못하면 `ldconsole.exe list2`로 LDPlayer 인스턴스를 확인한다.
- `TARGET_LD_INDEX=auto`일 때는 고정 대상 파일이 존재하는 인스턴스를 찾아 자동 선택한다.
- 후보가 없거나 2개 이상이면 안전을 위해 실패한다.

## 메신저봇R AS-IS 배포 경로

### main.js

```text
TARGET_BOT_DIR=/storage/emulated/0/hoiland/hoiland/Bots/main
TARGET_FILE=/storage/emulated/0/hoiland/hoiland/Bots/main/main.js
SOURCE_FILE=main.js
BOT_NAME=main
```

### Info.js

```text
TARGET_BOT_DIR=/storage/emulated/0/hoiland/hoiland/Bots/info
TARGET_FILE=/storage/emulated/0/hoiland/hoiland/Bots/info/Info.js
SOURCE_FILE=Info.js
BOT_NAME=info
```

의미:

- 위 경로는 AS-IS 메신저봇R 기준 봇 스크립트 배포 위치다.
- TO-BE Iris 구조에서는 이 경로가 최종 실행 경로가 아닐 수 있다.
- 다만 LDPlayer/ADB 연결 확인과 기존 운영 구조 파악에는 중요한 기준값이다.

## 운영 데이터 경로

```text
CHANGELOG_SOURCE=data\hoiBotChangeLog.json
TARGET_CHANGELOG=/storage/emulated/0/호이랜드/hoiBotChangeLog.json
TARGET_CHANGELOG_DIR=/storage/emulated/0/호이랜드
```

의미:

- AS-IS에서는 운영 데이터 일부가 LDPlayer 내부 Android 저장소에 있다.
- `/개발자노트`용 변경 로그는 `data/hoiBotChangeLog.json`을 LDPlayer 내부 `/storage/emulated/0/호이랜드/hoiBotChangeLog.json`로 업로드한다.
- TO-BE에서는 데이터 위치를 운영 PC hoiBot Server 쪽 DB/파일로 이전하는 것이 목표다.

## Git 기준 브랜치

```text
BASE_BRANCH=feature/prod
```

의미:

- 운영 반영 배치는 최신 `origin/feature/prod` 기준으로 파일을 가져와 LDPlayer에 반영한다.
- 개발 PC에서 Git push 후 운영 PC에서 pull 또는 배치 실행으로 반영하는 흐름과 연결된다.

## 로그 경로

```text
DEPLOY_LOG=%TEMP%\hoibot_main_deploy_%RANDOM%.log
DEPLOY_LOG=%TEMP%\hoibot_info_deploy_%RANDOM%.log
```

의미:

- 운영 반영 중 ADB/LDPlayer 명령 결과는 Windows 임시 폴더의 로그 파일에 기록된다.
- Iris 전환용 점검/설치 도구를 만들 때도 같은 방식으로 단계별 로그를 남기는 것이 좋다.

## Iris TO-BE에서 재사용할 수 있는 기준

재사용 가능:

- `C:\LDPlayer\LDPlayer9\adb.exe`
- `C:\LDPlayer\LDPlayer9\ldconsole.exe`
- `adb devices` 기반 단일 device 확인
- `ldconsole list2` 기반 LDPlayer 인스턴스 확인
- ADB push / shell 명령 실행 패턴
- `%TEMP%` 로그 파일 기록 방식

재사용 주의:

- 메신저봇R 스크립트 경로는 Iris 실행 경로가 아니다.
- `com.xfl.msgbot` compile broadcast는 Iris 구조에서 사용하지 않는다.
- LDPlayer 내부 JSON 데이터 경로는 TO-BE에서 PC 서버 데이터 저장소로 이전 대상이다.

## 다음 검증 명령 후보

운영 PC에서 직접 확인할 명령:

```powershell
cd C:\LDPlayer\LDPlayer9
.\adb.exe devices
.\ldconsole.exe list2
```

단일 device가 확인되면:

```powershell
.\adb.exe shell echo ok
.\adb.exe shell ls -l /storage/emulated/0/hoiland/hoiland/Bots/main/main.js
.\adb.exe shell ls -l /storage/emulated/0/호이랜드/hoiBotChangeLog.json
```

Iris 설치 단계에서는 별도 런북인 `IRIS_INSTALL_RUNBOOK.md`를 따른다.
