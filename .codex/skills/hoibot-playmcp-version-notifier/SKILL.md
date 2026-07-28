---
name: hoibot-playmcp-version-notifier
description: Notify the hoiBot operator of a verified production version through PlayMCP KakaoTalk. Use after Codex successfully reflects work into feature/prod, pushes it, and verifies origin/feature/prod, especially for requests such as 운영반영, 운영반영해줘, or prod까지 올려줘.
---

# hoiBot PlayMCP Version Notifier

Send one exact KakaoTalk version message only after a successful hoiBot production reflection.

## Preconditions

Proceed only when all conditions are true:

- The current task actually updated and pushed `feature/prod`.
- `origin/feature/prod` was fetched and verified to contain the reflected commit.
- `HoiBotVersion` in `main.js` matches the latest `data/hoiBotChangeLog.json` entry.

Do not notify when merely pulling an already-reflected commit, when production was not updated, or when remote verification failed.

## Notification Workflow

1. Read the verified `HoiBotVersion` from `main.js`.
2. Check the available tools for the PlayMCP KakaoTalk `나에게 보내기` capability.
3. When available, call that tool with exactly `ver_<HoiBotVersion>`.
4. Do not add spaces, prefixes, suffixes, commit hashes, or explanatory text.
5. If sending fails, retry once when safe.
6. If PlayMCP is unavailable, skip without failing production reflection.

## Reporting

- Report `전송 성공` only after the tool confirms success.
- Report `도구 없음으로 건너뜀` when PlayMCP is unavailable.
- Report the failure honestly after one safe retry; never claim the message was sent.
