---
name: hoibot-iris-diagnostics
description: Diagnose and implement hoiBot Iris/redroid event ingestion, KakaoTalk chat_logs queries, message deletion or host-hide correlation, 64-bit ID handling, Iris /query and /decrypt decryption, event monitoring, MariaDB incident/outbox failures, and live delivery verification. Use whenever a hoiBot Iris event is missing, misclassified, shows encrypted or feedType JSON instead of original content, carries a wrong sender/room label, fails to reach the monitoring room, or requires KakaoTalk DB inspection.
---

# hoiBot Iris Diagnostics

Use an evidence ladder. Do not patch the final formatter before locating the failing layer.

## Start

1. Work only in the modernization worktree and preserve existing changes.
2. Read `개발환경_고도화/DECISIONS.md`, then `개발환경_고도화/MEMORY.md`.
3. Read [references/iris-contract.md](references/iris-contract.md) completely.
4. Inspect current code and live configuration; never reuse remembered IPs, ports, tokens, room IDs, or credentials.
5. Keep all KakaoTalk IDs as strings. Never pass a 16+ digit identifier through a JavaScript `number`.

## Diagnose in This Order

1. **KakaoTalk DB** — verify the source row exists in `db1.chat_logs`.
2. **Iris observer** — verify the row reached the configured HTTP endpoint or `/ws`.
3. **Normalizer** — compare event `id`, target `logId`, `origin`, `type`, `chat_id`, `user_id`, and nested metadata.
4. **hoiBot transaction** — inspect `event_inbox`, `normalized_provider_events`, and `moderation_incidents` for rollback or constraint failures.
5. **Outbox** — verify exactly one command execution/outbox and a `sent` delivery attempt.
6. **KakaoTalk echo** — confirm the monitoring-room message appeared and did not re-enter the monitor loop.

Report evidence for every layer. “Not seen in the room” does not prove Iris failed.

## Use the Official APIs First

- Use `GET /config` to confirm the current endpoint and rates without exposing secrets.
- Use `POST /query` for parameterized, read-only DB inspection. Include the decryption context required by the selected fields.
- Use `POST /decrypt` when ciphertext and its `enc` value are already available, including `v.previous_message` and `v.previous_enc`.
- Use `POST /reply` only when the user requested a live delivery test. Avoid fabricated operational alerts.
- Use `/aot` only when explicitly required; never print or store its tokens.

## Correlate Before Decrypting

Treat these as different identifiers:

- event row: `json.id` / normalized `providerEventId`;
- original target row: parsed system-event `message.logId`;
- optional indirection: target row `prev_id`.

For deletion, query the target `logId`, not the new `SYNCDLMSG` row ID. A deleted text row may remain with the `16384` bit added to its type.

For `SYNCREWR + feedType=26 + coverType=openchat_blind`, handle both verified shapes:

1. Intermediate feed: target is `type=0`, `origin=WRITE`, `message.feedType=13`; follow one `prev_id` hop.
2. In-place rewrite: target is `type=0`, `origin=MSG`, `message.feedType=13`; decrypt `v.previous_message` with `v.previous_enc`, target `user_id`, and the original `chatLogInfos[0].type`.

Do not follow arbitrary `prev_id` chains. Apply only the verified guards above.

## Reusable Probe

Run the read-only probe from the skill directory:

```powershell
node scripts/inspect-event.mjs --iris-url http://DEVICE:PORT --chat-id CHAT_ID --event-id EVENT_ID
```

Add `--show-content` only when the user explicitly wants plaintext displayed. The script never writes to KakaoTalk DB.

## Change and Validate

1. Add a regression fixture for the exact raw payload shape before changing runtime behavior.
2. Keep recovery failure non-fatal to event ingestion; show `not_found` and `failed` separately.
3. Do not persist recovered message bodies in hoiBot MariaDB unless the user makes a new explicit retention decision.
4. Run `npm.cmd test`, `npm.cmd run typecheck`, and `npm.cmd run build` in `개발환경_고도화/runtime`.
5. When migrations changed, apply them twice in the authorized isolated test DB and verify the second run is a no-op. Modernization work must preserve operational data and follow the runner resource Lease rules.
6. When a restart is within the current task authorization, restart only the verified target Node process and check `/health/ready`. Do not infer operational restart permission from a diagnostic request.
7. Only when the user requested a live delivery test, perform one controlled live action and verify DB row, inbound event, normalization, transaction, outbox, and visible echo. Otherwise use synthetic fixtures/replay and report live delivery as unverified; do not fabricate an alert to complete the checklist.
8. Update `DECISIONS.md`, `MEMORY.md`, and the relevant Iris reference only with verified facts.

Do not commit or push unless the user explicitly requests it.
