# YouTube Environment Research

This file preserves the informational basis from three user-provided YouTube videos.
The third video is the selected hoiBot modernization baseline.

The summaries were derived from automatically extracted Korean subtitles. They may not reproduce every statement exactly.

## 1. Hayul and Termux without Root

- Title: `Hayul과 Termux를 이용한 노루팅 아이리스 돌리기`
- URL: https://www.youtube.com/watch?v=1XPQUMFxGXc
- Environment: non-root Android device, Hayul patching, KakaoTalk, Termux, and an Iris-family service.
- Character: experimental personal-device setup.
- Main risks: application signing/shared-UID assumptions, KakaoTalk version compatibility, and long-running stability.
- Decision: not selected for hoiBot.

## 2. Irispy on a Rooted Phone

- Title: `휴대폰에서 Irispy 봇 돌리기`
- URL: https://www.youtube.com/watch?v=pXWSU38PYl0
- Environment: rooted Android phone, KakaoTalk, Iris, Termux, Python virtual environment, and `irispy-client`.
- Character: standalone Android development option.
- Main risks: rooted-device operations, Termux package issues, Python native dependencies, and process persistence.
- Decision: not selected for hoiBot.

## 3. Building a Bot with Iris

- Title: `Iris를 이용한 봇 만들기`
- URL: https://www.youtube.com/watch?v=H43VTOsKDXY
- Decision: selected PC/redroid baseline.

Key timeline:

- `0:00`: Iris overview
- `7:46`: Linux installation with Windows Hyper-V
- after Linux setup: Docker and redroid installation
- `21:20`: Iris installation
- `48:02`: `irispy-client`
- `56:29`: `iris_bot`

Selected architecture:

```text
Windows PC
-> Hyper-V
-> Ubuntu/Linux VM
-> Docker
-> redroid
-> KakaoTalk + Iris
-> external Python/HTTP/WebSocket bot client
```

Observed implementation topics:

- `iris_control` commands such as `install_redroid`, `install`, `start`, `status`, and `stop`.
- redroid port exposure including Android/Iris and ADB access.
- ADB and `scrcpy` for Android access.
- Python virtual environment and `pip install irispy-client`.
- `iris init` generating starter files.
- `iris_bot` WebSocket connection and basic reply behavior.

Items that still require direct verification are tracked only in `../CURRENT_STATE.md`.
