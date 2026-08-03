# Iris 영상자료 취합

이 문서는 Iris 개발환경 고도화와 관련된 YouTube 영상 3개를 자동자막 기반으로 요약한 자료다.
메인 문서인 `Iris_정보취합.md`에서 참고한다.

주의:

- 영상 페이지 직접 열람은 YouTube fetch throttling으로 제한되었다.
- 로컬 PC에 `yt-dlp`와 `youtube-transcript-api`를 `--user` 범위로 설치한 뒤 자동 한국어 자막을 추출해 확인했다.
- 아래 내용은 자동자막 기반 요약이므로 실제 영상 발화와 다를 수 있다.
- 자막 원문 전체는 저작권/정리 문제를 피하기 위해 저장소에 남기지 않는다.

---

## 1. 영상 목록

### Hayul과 Termux를 이용한 노루팅 아이리스 돌리기

링크:

```text
https://www.youtube.com/watch?v=1XPQUMFxGXc
```

확인된 제목:

```text
Hayul과 Termux를 이용한 노루팅 아이리스 돌리기
```

자동자막 기반 요약:

- 노루팅 Android 기기에서 KakaoTalk과 Termux만으로 Iris 계열 봇을 돌리는 흐름을 설명한다.
- 기존 UserLAnd/TermOnePlus 방식이 불안정할 수 있어 Termux 기반으로 다시 구성하는 맥락이 언급된다.
- Hayul은 App Cloner와 유사하게 동일 서명/공유 UID 계열 개념을 이용해 앱 내부 파일 또는 DB 접근 환경을 만들어 주는 것으로 설명된다.
- Hayul 패치는 PC에서 ADB로 연결된 Android 기기를 대상으로 진행하는 흐름이다.
- GitHub에서 Hayul 관련 파일을 내려받고 Python 가상환경을 만든 뒤 필요한 모듈을 설치해 스크립트를 실행하는 흐름이 보인다.
- hoiBot 관점에서는 운영용 안정 환경보다는 노루팅 실험환경 또는 개인 개발 테스트 환경 후보로 분류하는 것이 안전하다.

추가 조사 포인트:

- 영상 설명의 GitHub 링크 확인
- Hayul 패치 대상 앱과 서명/공유 UID 구조 확인
- 카카오톡 최신 버전 호환성 확인
- 장시간 구동 안정성 확인

---

### 휴대폰에서 Irispy 봇 돌리기

링크:

```text
https://www.youtube.com/watch?v=pXWSU38PYl0
```

확인된 제목:

```text
휴대폰에서 Irispy 봇 돌리기
```

게시자 검색 노출:

```text
dolidolih
```

자동자막 기반 요약:

- 루팅된 휴대폰에서 Termux를 설치하고 `irispy-client`로 Iris 봇을 실행하는 실습이다.
- 준비물은 Iris가 설치된 루팅 Android 환경과 Termux다.
- Termux는 Play Store 버전보다 GitHub/F-Droid 계열 최신 APK 사용이 권장되는 흐름으로 설명된다.
- Termux에서 패키지 업데이트/업그레이드를 먼저 수행하고 Python을 설치한다.
- Python 가상환경을 만들고 활성화한 뒤 `pip`를 업데이트하고 `irispy-client`를 설치한다.
- Pillow 설치 중 에러가 날 수 있으며, Termux에서는 `libjpeg-turbo` 계열 패키지를 설치해 해결하는 흐름이 언급된다.
- `iris init`으로 기본 파일을 생성하고, 생성된 Python 파일을 수정해 간단한 응답 테스트를 진행한다.
- hoiBot 관점에서는 Android 기기 단독 개발환경 후보지만, Python/Termux/루팅 의존성이 크다.

추가 조사 포인트:

- Termux 권장 설치 경로와 최신 APK 출처 확인
- Termux에서 필요한 패키지 목록 확정
- `irispy-client` 설치 실패 케이스와 해결책 정리
- 휴대폰 단독 운영 시 프로세스 유지 방법 확인

---

### Iris를 이용한 봇 만들기

링크:

```text
https://www.youtube.com/watch?v=H43VTOsKDXY&t=3673s
```

확인된 제목:

```text
Iris를 이용한 봇 만들기
```

검색 확인 목차:

- `0:00 Iris 개요`
- `7:46 Linux 설치(Hyper-v 이용)`
- `21:20 Iris 설치`
- `48:02 irispy-client`
- `56:29 iris_bot 실행`

사용자 링크의 `t=3673s`는 약 `1:01:13` 지점이다.

자동자막 기반 요약:

- 영상 전체는 Iris 개요, Windows Hyper-V 기반 Linux VM 구성, redroid 설치, Iris 설치, `irispy-client`, `iris_bot` 샘플 실행 순서로 진행된다.
- Iris 개요 구간에서는 MessengerBot 같은 알림 기반 봇이 Notification Listener로 알림을 받고 reply action을 사용하는 방식과, Iris가 DB 변화를 감시하고 직접 reply용 객체/Intent를 만들어 보내는 방식을 비교한다.
- Iris는 카카오톡 DB 변경사항을 감지해 HTTP 또는 WebSocket으로 봇 클라이언트에 이벤트를 보내고, 봇 클라이언트는 `/reply` 계열 HTTP 요청으로 답장을 요청하는 구조로 설명된다.
- 추천 환경은 PC/Linux 위에 redroid를 올리고 그 안에 Android/KakaoTalk/Iris를 구성하는 방식으로 언급된다. 안정성, 자원, 전원 측면에서 루팅폰보다 더 추천되는 흐름이다.
- Windows에서는 Hyper-V로 Ubuntu VM을 만들고, 그 안에 Docker와 redroid를 설치해 Android 환경을 구성하는 예제가 진행된다.
- `iris_control`을 내려받아 실행 권한을 부여한 뒤 `install_redroid`, `install`, `start`, `status`, `stop` 같은 명령으로 redroid/Iris를 다루는 흐름이 보인다.
- redroid 컨테이너는 3000번 포트와 5555번 포트를 외부에 노출하는 구성으로 설명된다.
- Android 화면 접근은 `scrcpy`와 ADB를 통해 진행한다.
- `irispy-client` 구간에서는 Python 가상환경을 만들고 `pip install irispy-client` 후 `iris init`으로 기본 파일을 생성한다.
- `iris init`은 `irispy.py`, `iris.db`, `.env` 계열 파일을 생성하는 흐름으로 설명된다.
- 실행 시 Iris URL은 `IP:PORT` 형태로 넘긴다.
- `iris_bot` 구간에서는 샘플 봇 repo를 받아 가상환경과 `requirements.txt` 설치를 진행하고, 실행 후 WebSocket 연결 및 기본 명령 응답을 확인한다.
- 카카오링크 기능은 JavaScript 앱 키와 origin 설정이 필요하다고 언급된다.

추가 조사 포인트:

- `iris_control` 최신 명령 목록 확인
- redroid Docker 포트 구성 확인
- Ubuntu VM 최소 사양과 권장 사양 확인
- `scrcpy`와 ADB 연결 절차 정리
- `iris_bot` 저장소와 기본 명령 구조 확인

---

## 2. 영상 기반 개발환경 후보

자동자막에서 확인한 Iris 개발환경 후보는 크게 세 가지다.

### Linux/redroid 기반 PC 서버형

```text
Windows Hyper-V 또는 Linux 서버
-> Ubuntu/Linux
-> Docker
-> redroid
-> KakaoTalk + Iris
-> 외부 Python/HTTP/WebSocket 봇 클라이언트
```

장점:

- 영상에서 안정성 측면의 추천 환경으로 언급된다.
- PC/서버에서 로그와 프로세스를 관리하기 쉽다.
- hoiBot을 장기적으로 Iris adapter 구조로 옮길 때 가장 정돈된 후보로 보인다.

주의점:

- Docker/redroid/ADB/scrcpy/Iris 설정이 필요하다.
- Android와 봇 클라이언트 네트워크 포트 구성이 중요하다.
- 루팅 또는 DB 접근 권한 문제가 여전히 핵심이다.

### 루팅 휴대폰 + Termux 단독형

```text
Rooted Android phone
-> KakaoTalk + Iris
-> Termux
-> Python venv
-> irispy-client 또는 iris_bot
```

장점:

- 휴대폰 하나로 봇 클라이언트까지 실행할 수 있다.
- 별도 PC 서버가 없어도 실험이 가능하다.

주의점:

- 루팅 기기가 필요하다.
- Termux 패키지와 Python 빌드 이슈가 생길 수 있다.
- 장시간 운영 안정성은 별도 검증이 필요하다.

### 노루팅 휴대폰 + Hayul/Termux 실험형

```text
Non-root Android phone
-> Hayul patch
-> KakaoTalk + Termux 공유 접근 구성
-> Python/Iris 계열 서비스 실행
```

장점:

- 루팅 없이 Iris 계열 실험을 할 가능성이 있다.
- Android 실기기에서 빠르게 테스트할 수 있는 후보가 된다.

주의점:

- Hayul 패치와 앱 서명/공유 UID 개념에 의존한다.
- 영상 기준으로도 실험적 성격이 강해 보인다.
- 운영 안정성, 카카오톡 버전 호환성, 보안/정책 리스크를 반드시 별도로 검증해야 한다.

hoiBot 개발환경 고도화의 확정 기준은 `Linux/redroid 기반 PC 서버형`이다.
기존 MessengerBot 운영환경은 유지하고, Iris는 별도 실험환경으로 분리한 뒤 adapter PoC를 만드는 접근이 적절하다.

---

## 3. 이미지 추출 후보

현재 단계에서는 영상 원문에서 이미지를 추출하지 않았다.
추후 설치 절차 문서화가 필요하면 아래 장면을 우선 추출 후보로 본다.

- Hyper-V VM 생성 설정 화면
- `iris_control install_redroid` 실행 화면
- Docker/redroid 포트 노출 확인 화면
- `scrcpy`로 redroid Android 화면에 접속한 장면
- Iris dashboard 설정 화면
- `iris init` 이후 생성 파일 확인 화면
- `iris_bot` WebSocket 연결 및 테스트 응답 화면

이미지를 추출할 경우에도 전체 영상 다운로드를 저장소에 남기지 않고, 필요한 순간의 스크린샷만 별도 이미지 폴더에 보관한다.
