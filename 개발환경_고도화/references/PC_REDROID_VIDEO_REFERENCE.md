# PC redroid Video Reference

This file preserves the selected environment basis only.
It is informational and does not override `../DECISIONS.md` or `../MEMORY.md`.

## Selected Video

- Title: `Iris를 이용한 봇 만들기`
- URL: https://www.youtube.com/watch?v=H43VTOsKDXY

Relevant setup timeline:

- `0:00`: Iris overview
- `7:46`: Linux installation with Windows Hyper-V
- after Linux setup: Docker and redroid installation
- `21:20`: Iris installation

Selected environment:

```text
Windows PC
-> Hyper-V
-> Ubuntu/Linux VM
-> Docker
-> redroid
-> KakaoTalk + Iris
```

Relevant operational tools:

- `iris_control` for redroid and Iris installation/start/status operations.
- ADB for Android access and diagnostics.
- `scrcpy` for the redroid Android display.
- Port forwarding/exposure for Iris and ADB connectivity.

Bot-server implementation language and optional client frameworks are not selected by this reference.
Current validation status is tracked only in `../MEMORY.md`.
