# Iris Connectivity Validation

This document records technical validation evidence without KakaoTalk room names, sender names, message bodies other than the explicit test command, account identifiers, chat identifiers, or authentication values.

## Environment

- Validation dates: `2026-08-03` and post-account-switch revalidation on `2026-08-04` (Asia/Seoul)
- redroid ADB target: network-connected redroid instance
- KakaoTalk: running inside redroid
- Iris HTTP port: `3000`
- hoiBot Lite Server port: `3100`
- Event transport: Iris HTTP endpoint to hoiBot Lite Server

## Connectivity Results

| Check | Result |
| --- | --- |
| redroid ADB state | Passed |
| KakaoTalk process state | Passed |
| Iris HTTP `/config` | Passed |
| Iris dashboard | Passed |
| hoiBot Lite Server readiness | Passed |
| Iris to server live event delivery | Passed |
| Exact `/ping` command detection | Passed |
| Iris `/reply` text response | Passed |
| Deployed automatic `sender-name pong` round trip | Passed |
| Post-account-switch Iris DB reattachment | Passed after Iris process restart |

## `/ping` Detection Run

- The server's bounded recent-event window contained `16` distinct `/ping` events.
- Distinctness was checked using the Iris event record identifier, with the server request identifier as a fallback.
- The requested threshold of `10` distinct detections was reached.
- The first run already contained `16` events when sampled; future runs must stop counting immediately at `10` distinct `/ping` events.
- The tenth event in the measured window was received at `2026-08-03 14:16:24 KST`.
- A `pong` response sent through Iris `/reply` returned `success`.
- A later deployed-handler test observed the exact `/ping` input followed by `sender-name pong` with `isMine=true`; the measured event-to-event interval was approximately `201 ms`.

## Post-Account-Switch Revalidation

- Clearing KakaoTalk application data replaced the active KakaoTalk databases while the existing Iris process was still watching the prior database handles.
- Iris HTTP remained reachable, but new KakaoTalk events stopped reaching the server until the Iris process was restarted.
- After restart, Iris opened the current KakaoTalk databases, exact `/ping` delivery resumed, and the outgoing pong event was observed approximately `0.66 seconds` after the incoming event.
- The separate Iris display-name cache can retain prior-account labels temporarily. This affects top-level `sender` display metadata, not the source `chat_logs.user_id`.
- Identity and event-field handling for this condition is documented in `KAKAOTALK_DB_SCHEMA_INVENTORY.md` and `IRIS_SERVER_EVENT_MAPPING.json`.

## Privacy Handling

- No room name, sender name, chat ID, user ID, bot ID, authentication token, or unrelated message body is stored in this document.
- Raw payloads remain limited to the running Lite server's bounded in-memory development buffer.

## Remaining Validation

- Complete dedicated live tests for mention, edit, delete, membership, media, and profile-change cases listed in `IRIS_EVENT_CAPABILITY_MATRIX.md`.
- Test text, reply, media, emoticon, and supported system/member events in a dedicated test room.
- Verify WebSocket event delivery separately from the current HTTP endpoint flow.
- Record unsupported, missing, or ambiguous event classes before starting the hoiBot Server implementation.
