# hoiBot System Policies

Last updated: 2026-08-06

This document is the implementation-facing business policy for the modernized hoiBot system.
Only rules explicitly confirmed by the user are normative. Legacy observations and unresolved choices are separated from active rules.
If this document conflicts with `../DECISIONS.md`, `../DECISIONS.md` takes precedence.

## 1. Policy hierarchy

1. `DECISIONS.md`: authoritative user decisions.
2. This document: detailed domain rules, examples, invariants, and implementation acceptance criteria.
3. `MEMORY.md`: current work position and open questions.
4. Legacy code and JSON: migration evidence, not the final policy when a newer explicit decision exists.

## 2. Operations authorization, entitlements, and account purpose

- Operations authorization uses `super_admin` and `manager` roles. A normal user has no administrator role.
- `super_admin` receives every active permission. The final active super administrator cannot be suspended, demoted, or deleted.
- `manager` starts with read-oriented permissions. A super administrator may add per-operator `allow` and `deny` overrides; `deny` has final precedence.
- Both `super_admin` and `manager` receive the default permission to request recovered content for deletion and host-hide incidents. A manager-specific `deny` may revoke it. Normal users never receive it.
- Incident metadata permission and recovered-content permission are separate. Every recovered-content request creates an audit entry containing actor, incident, time, and result, but never copies the recovered body into the audit record.
- A free pass is a player entitlement, not an authorization role. Permanent and time-bounded passes are supported, and grants and revocations retain the operator reason and audit history.
- Test accounts exist only in a separate test environment. Production blocks both their creation and login.
- Every administrative mutation requires session authorization, CSRF, an `Idempotency-Key`, a non-empty reason, explicit reconfirmation, and an audit record.

## 3. Account, character, and external identity

### 3.1 Cardinality

- One internal system account has exactly one character.
- One KakaoTalk account key belongs to exactly one internal system account.
- One Discord account key belongs to exactly one internal system account.
- One internal system account may have one KakaoTalk identity and one Discord identity.
- Across provider types, an internal account therefore has multiple external identities; within each provider the relationship is one-to-one.

```text
system account 1 ── 1 character
system account 1 ── 0..1 KakaoTalk identity
system account 1 ── 0..1 Discord identity
```

### 3.2 Internal account name

- The internal account name is also the character name.
- It must match `^[가-힣]{2} (남|여)$`.
- The format is exactly two Hangul syllables, one ASCII space, and `남` or `여`.
- Leading spaces, trailing spaces, missing spaces, multiple spaces, longer names, and other gender text are invalid.
- The internal account name is globally unique, including during the withdrawal grace period.

Valid examples:

```text
호이 남
루나 여
```

Invalid examples:

```text
호이남
호이  남
호이 남성
호이봇 남
```

### 3.3 Command identity gate

A KakaoTalk or Discord game command is accepted only when both conditions are true:

1. The provider account key is registered to an active internal account.
2. The current provider nickname exactly equals the internal account name.

Nickname-only identity resolution is forbidden. A matching nickname with an unknown or different provider key must never grant account access.

If the provider key is valid but the nickname differs, game command execution is blocked and only a nickname correction guide may be returned.

Runtime identity and display-name rules:

- The event owner is resolved by the string-preserved provider `user_id`, never by a nickname.
- Iris `sender` and `names.db` values are untrusted cache observations. They may appear only in explicit `/info` diagnostics and must not be shown as a confirmed person in normal monitoring output.
- A KakaoTalk DB nickname is trusted only when it is resolved with both the current `chat_id` and event `user_id`, such as the matching `open_chat_member` row for that open-chat room.
- A verified internal account name may be displayed only after the provider key is linked to that account.
- When no trusted name is available, output `user_id` and `확인된 이름 없음`; do not fall back to Iris `sender`.
- Conflicting cache and trusted names remain separate observations and never trigger automatic account merge, rename, or ownership changes.

### 3.4 Cross-platform continuity and concurrency

- KakaoTalk and Discord operate the same internal account and character state.
- A change made through one provider must be visible through every other provider.
- Commands for the same internal account are serialized and executed one at a time regardless of provider.
- Commands for different internal accounts may execute concurrently.

## 4. Signup and provider linking

### 4.1 Initial signup

The target signup flow is site-first:

1. The user accepts the required terms and privacy notice on the website.
2. The user chooses a login ID, password, and internal account name.
3. The site validates the account-name format, uniqueness, and reservation state before issuing a code.
4. The site creates only a `PENDING_KAKAO_LINK` account and issues a one-time provider verification code.
5. The user sets the KakaoTalk nickname to the internal account name.
6. The user submits the code to the KakaoTalk bot.
7. The server verifies the code, nickname, and KakaoTalk account key.
8. The system account is activated and the character and initial game state are created in one transaction.

The currently implemented KakaoTalk-first `/가입` flow is not the target policy and must be redesigned before production cutover.

### 4.2 Verification code

- Valid for 30 minutes from issuance.
- Single use.
- Invalidated immediately after successful verification.
- Invalidated after five failed attempts.
- A new code must be issued after expiry or invalidation.
- Store only a secure hash of the code, never the original code.
- An unverified account remains for 24 hours and may issue a new code after site login.
- After 24 hours without successful KakaoTalk verification, delete the pending account, credential hash, and account-name reservation.

### 4.3 Link and relink

- `내정보 > 계정` provides KakaoTalk relinking and Discord linking/relinking.
- KakaoTalk and Discord use the same one-time-code verification model.
- A provider identity already linked to another internal account cannot be linked.
- During relinking, the existing provider identity remains active until the new identity passes verification.
- A successful relink atomically deactivates the previous identity and activates the new identity.
- Failed or expired relinking leaves the previous identity unchanged.

### 4.4 Website credentials and consent

- Login ID is separate from the internal account name and never changes when the account name changes.
- Login ID is globally unique and must match `^[a-z0-9]{6,20}$`.
- Password length is 8 to 64 characters and must include at least one ASCII letter and one digit.
- Passwords are stored only as Argon2id hashes and must never be written to logs.
- Required terms consent must be completed before nickname validation and verification-code issuance.
- The privacy notice is informational and does not require a separate consent checkbox or consent-history row.
- Marketing consent is not collected.
- Consent history stores only account ID, document type, document version, and acceptance time; IP and device information are not stored.

### 4.5 Sessions and password reset

- CAPTCHA is intentionally excluded from the initial signup and login implementation.
- Adding CAPTCHA later requires a separate explicit decision and threat review.
- The system does not collect email, phone number, legal name, birth date, address, IP history, or device information for account recovery.
- Password reset uses a one-time code verified through an already linked KakaoTalk or Discord identity.
- A password change or reset revokes every existing website session.
- A user session expires after 24 hours of inactivity and no later than 7 days after creation.
- Concurrent website sessions are unlimited.
- Normal logout revokes only the current session; the user is not given an individual-session management screen.
- Session token plaintext exists only in a secure cookie; the database stores only a token hash.

## 5. Internal account name change

- An account name cannot be changed freely.
- A dedicated account-name change ticket is required.
- Only the first two Hangul syllables may change; the gender suffix is immutable.
- The new name must pass the same format and global uniqueness rules.
- Ticket consumption and name change occur in one transaction.
- The change stores an immutable audit record.
- KakaoTalk and Discord account-key links remain connected.
- Until each provider nickname matches the new internal account name, commands from that provider are blocked and a nickname correction guide is returned.

```text
호이 남 → 루나 남  allowed
호이 남 → 루나 여  rejected
```

## 6. Account lifecycle and sanctions

### 6.1 Withdrawal grace period

- Withdrawal starts a 30-day grace period.
- During the grace period, website features and KakaoTalk/Discord game commands are blocked.
- A login attempt shows the scheduled permanent-deletion date and a withdrawal-cancellation action.
- The user may cancel withdrawal on the site during the grace period.
- Signup with the same provider key returns `이미 가입한 사용자`.
- The internal account name and provider keys remain reserved during the grace period.

### 6.2 Permanent deletion

After 30 days without recovery:

- Delete personal account data, game state, and external-identity links.
- Release the internal account name for reuse.
- Release external provider keys for reuse unless the account was permanently suspended.
- Anonymize and retain currency ledgers, transaction records, and audit records needed for integrity and investigation.
- The deleted game account is not recoverable.

### 6.3 Temporary suspension

- A temporarily suspended user may authenticate to the website only to see the sanction reason and end date, submit an inquiry, or log out.
- All game functions and KakaoTalk/Discord commands are blocked.
- The account automatically returns to active state when the suspension expires.

### 6.4 Permanent suspension

- Permanent suspension has no automatic expiry.
- Website access is limited to the sanction notice, inquiry, and logout.
- Game functions and provider commands are blocked.
- Only an authorized operator may lift the sanction.
- A permanently suspended user may request withdrawal.
- After permanent deletion, original provider keys are removed but non-reversible hashes remain on a permanent denylist to prevent re-registration.

## 7. Currency and operator corrections

### 7.1 Numeric policy

- Points, diamonds, item quantities, and other currencies are integers.
- Negative account balances are forbidden.
- Legacy fractional balances are rounded to the nearest integer during import.
- Ratio-based calculations use ordinary rounding at the final credit/debit boundary.
- Intermediate calculations keep sufficient precision and are rounded only once.

Examples:

```text
100.4 → 100
100.5 → 101
50.25 → 50
50.50 → 51
```

### 7.2 Append-only correction

- Operators do not edit or delete an existing currency or inventory ledger entry.
- Corrections create a compensating ledger entry linked to the original operation.
- An authorized operator may execute a correction alone, but a reason is mandatory.
- The operator, target, reason, original operation, before/after value, and timestamp are audited.

### 7.3 Unrecovered assets

- If the full incorrect credit cannot be recovered, the balance or inventory is reduced only to zero/available quantity.
- The remainder becomes an unrecovered currency or item case.
- No automatic offset occurs on later earnings or acquisitions.
- The user may continue normal gameplay, earning, spending, use, and trade while a case is open.
- Operators manage cases manually through a dedicated administration screen.
- Supported case statuses are `OPEN`, `PARTIAL`, `RECOVERED`, and `WAIVED`.

The administration screen must support partial recovery, full recovery, waiver, reason entry, source-operation lookup, and complete history.

## 8. Inventory and capacity

### 8.1 Storage type

- Stackable materials and consumables use quantity-based storage.
- Equipment and other unique assets use individually identified instances.
- The item catalog declares whether an item is `STACK` or `INSTANCE`.

### 8.2 General inventory

- The general inventory has no total slot limit.
- Individual item definitions may optionally set a maximum owned quantity.
- Items without an explicit maximum have no quantity limit.
- When a configured item maximum is exceeded, the accepted quantity fills the inventory and the remainder is delivered by mail.

### 8.3 Restricted bags

- Mini-pet and furniture bags have independent capacity limits.
- Each mini-pet or furniture instance consumes one slot, including duplicates.
- If the restricted bag is full, newly acquired instances are delivered by mail.
- Capacity is calculated by bag-specific policies and may depend on level, pass, sponsorship, permanent expansion, or other legacy conditions.
- Each capacity rule declares whether it stacks with other rules and its priority.

If a temporary capacity benefit expires while current ownership exceeds the new limit:

- Existing assets remain in place.
- Existing assets can be viewed, used, sold, or removed.
- New assets cannot enter the restricted bag and are delivered by mail.
- Mail attachments cannot be claimed until enough capacity is available.
- Normal capacity state returns automatically when ownership is within the limit.

## 9. Mail

- Mail attachments have no claim expiry.
- Overflow items and restricted-bag instances are preserved in mail.
- A user may partially claim a stack attachment when only part of it fits.
- The remainder stays attached to the same mail.
- An instance attachment cannot be claimed if its destination bag has no capacity.
- Claim operations are transactional and idempotent.
- After every attachment is claimed, the mail disappears from the user inbox.
- Mail metadata, attachment details, claim time, target account, and source operation remain in immutable audit/ledger history.

## 10. Marketplace

### 9.1 Confirmed target rules

- A listed asset leaves the seller inventory and enters marketplace custody.
- A marketplace asset cannot be used, enhanced, transferred, or listed again.
- On purchase, buyer payment, asset transfer, fee ledger, completed trade, and seller-settlement mail are one transaction.
- Seller proceeds are not credited directly and are not stored in a separate settlement inbox.
- Net seller proceeds are sent as a no-expiry mail attachment and claimed under the common mail policy.
- A cancelled or expired listing returns to the seller inventory; if a restricted capacity prevents return, it is delivered by mail.

### 9.2 Verified legacy behavior

The following is migration evidence from current `main.js`, not an automatic override of newer decisions:

- Registration eligibility requires tier `킹` or higher.
- Active listing limit is base 1, plus 2 for `타고난 장사꾼`, plus 7 for `자유시장회원권🏪`.
- Upfront carrot registration fee per unit: general bag 1, mini-pet 20, furniture 5, skill 50, pendant 100.
- Seller cancellation has no separate cancellation charge.
- Upfront carrot fees are normally not returned on cancellation.
- If the seller holds `자유시장회원권🏪` at cancellation time, the upfront carrot fee is fully refunded.
- Listings currently have no expiry and remain until sold, cancelled, or force-cancelled.
- Current sale fee is 10%, or 5% when the seller holds `자유시장회원권🏪`.
- Current legacy proceeds are credited directly and use `Math.floor`; both behaviors are superseded by settlement mail and the system-wide rounding rule.

### 9.3 Marketplace decisions still open

- Whether the new system keeps legacy no-expiry listings or uses item/event-specific listing durations.
- Whether the verified legacy registration and cancellation-fee policy is retained without change.
- Exact catalog/configuration ownership of listing duration, registration fee, listing limit, and membership benefits.

## 11. Required implementation invariants

- Provider nickname alone never authenticates an account.
- An external provider key cannot be active on two internal accounts.
- An internal account cannot have two active identities for the same provider.
- An internal account name cannot be duplicated while active or in withdrawal grace.
- Every state-changing operation is transactional and idempotent.
- Currency balances and item quantities never become negative.
- Ledger, audit, mail, marketplace custody, and ownership changes must agree after commit.
- Website, Iris, Discord, administrator UI, and external APIs call the same Application Services and Domain Policies.
- Controllers and adapters must not implement provider-specific copies of game rules.

## 12. Implementation gaps created by these policies

- Replace the current KakaoTalk-first signup target with site-first signup and provider-code verification.
- Add user website authentication and `내정보 > 계정` provider link/relink flows.
- Enforce the exact internal-name format, uniqueness, provider nickname gate, and per-account command serialization.
- Add withdrawal grace, recovery-only login, deletion/anonymization worker, suspension states, and permanent-sanction denylist.
- Replace fractional currency assumptions with integer types and explicit import rounding/reconciliation.
- Add unrecovered-asset administration screens and APIs.
- Implement stack/instance catalog policy, restricted capacity rules, and durable no-expiry mail with partial claims.
- Change marketplace seller settlement from direct balance credit to mail delivery.
- Resolve the remaining marketplace duration and fee-policy questions before final schema/API acceptance.

## 13. KakaoTalk channel eligibility

### 13.1 Production rule

Channel handling uses two ordered filters and a configurable observation stage:

1. KakaoTalk DB evidence must identify the channel as either an open group chat or an open direct chat.
2. The corresponding hoiBot channel must be explicitly enabled by an operator.

During first-stage validation, every active and unexpired verified open-chat group is observed, while commands, provider verification and game operations still run only after both filters pass. Observation may store privacy-minimized event, activity, membership, incident and verified name metadata. After validation, `designated_only` restores observation to operator-enabled channels only. Iris may still deliver another room's event to the HTTP adapter; acknowledgement does not make it an allowed business event.

The authorization evidence consists of the `db1.chat_rooms` row resolved by external `chat_id`, its non-null `link_id`, a matching active and unexpired `db2.open_link` row, and a verified mapping of the physical room type to one of the two allowed logical channel classes.

| Logical channel class | Policy | Physical mapping status |
|---|---|---|
| `OPEN_GROUP` | Allowed when operator-enabled | `OM` verified from live DB data |
| `OPEN_DIRECT` | Allowed when operator-enabled | Physical `chat_rooms.type` not yet observed; enable only after live verification |

Room display names and Iris `room` cache strings are not authorization inputs. Ordinary `DirectChat` must not be treated as open direct chat. `DirectChat`, `MultiChat`, `PlusChat`, missing room/open-link rows, inactive or expired open links, and unknown room types are deny-by-default.

Adding the observed physical mapping for `OPEN_DIRECT` implements this already-approved policy and does not expand eligibility beyond open chat. The observation record must include the room type, `link_id`, matching `open_link` state, and a harmless event from that room.

### 13.2 Denied-event behavior

The HTTP adapter may acknowledge a denied event to prevent Iris retries, but it must stop before command dispatch and domain processing. A denied event must not:

- produce a KakaoTalk reply or outbox message;
- create or link a player or external identity;
- execute signup, provider verification, game mutation, or administration;
- update name observations, activity totals, membership history, or moderation incidents;
- retain message bodies, attachments, profile values, or room/user display labels.

Only privacy-minimized transport/security counters may record that an event was denied by channel policy.

An `observation` event is not denied, but it is also not operational. It must never execute `/ping`, signup, account linkage, profile/game commands or mutations, and it must never reply in the source room. Non-text event summaries may be sent only to the configured monitoring room.

### 13.3 Moderation content retrieval

- hoiBot stores the incident type, provider event ID, target log ID, channel ID, detection time, and processing result, but not the recovered message body.
- A detected deletion or host-hide is announced with the MariaDB incident ID as `#number`. The initial alert contains the verified room and participant labels but never the recovered body.
- The exact KakaoTalk command `/열람 #number` performs the live lookup. It is accepted only in the incident's source channel or the configured non-production monitoring channel; cross-room guessing must not reveal incident existence or content.
- Participant labels come from room-scoped `open_chat_member.nickname`. Room labels prefer `open_link.name` and may fall back to the type-3 title in `chat_rooms.meta`. Iris `sender` and `room` caches are not shown as verified values.
- An authorized `super_admin` or `manager` request performs a live, parameterized read against the redroid KakaoTalk DB and uses Iris `/decrypt` when required.
- If redroid is offline, the target row has expired, or decryption fails, the API returns an explicit unavailable reason. It must not imply that content was retained.
- The response is display-only, bounded in length, excluded from application logs and caches, and not copied into MariaDB or audit details.
- Persisting recovered bodies later requires a separate retention decision covering purpose, encryption, access, expiry, deletion, backup, and incident response.

### Feature-required event content retention

- `DEC-052` permits a narrow exception for administrator monitoring features: confirmed replies, images, multiple images and animated stickers. Under `DEC-053`, first-stage validation includes every active, unexpired, DB-verified open-chat room; later operation can switch to a separate designated-room list.
- Ordinary text, candidate/unknown events, ordinary chat rooms and unverified room types never enter this content store.
- Reply bodies and trusted Kakao media URLs are kept in MariaDB; downloaded media is kept under a private server storage directory and is never exposed as a filesystem path.
- Content expires after seven days. Cleanup clears message bodies, source text, URLs, hashes and storage keys and deletes the corresponding file while retaining only non-content audit metadata.
- Metadata lists require `monitoring.read`; actual bodies and media require `event.content.read`, granted by default to `super_admin` and `manager` with manager-level `deny` still taking precedence.
- Detail and media reads are audited without copying the viewed body into the audit row.
- Production acceptance requires HTTPS plus encrypted host storage. Long-lived backups must exclude the temporary content volume or enforce the same seven-day maximum retention.
- Deleted and host-hidden originals remain live-query-only under `DEC-045` and `DEC-046`; this exception does not persist recovered moderation content.

### 13.4 Development diagnostic exception

In non-production environments, explicitly configured diagnostic channel IDs may run only:

- exact `/ping` connection checks;
- exact `/info` database diagnostics;
- non-mutating event-type observation sent to the designated monitoring channel.

Diagnostic exceptions never permit signup, account linkage, currency, inventory, game, market, or administrator mutations. The exception list is configuration, not a room-name match.

A deletion or host-hide observed in the configured diagnostic channel may create the inbox, normalized-event and moderation-incident correlation rows required to issue `#number`, plus operation/outbox/delivery metadata required to send the alert. It must not create identity, membership, activity, player, or game-domain state, and it must not retain the recovered body.

A join or departure observed in the configured diagnostic channel may create the channel, candidate external identity, verified membership-feed name observation, current membership state, append-only membership event, and alert outbox required for room-scoped visit logging. It must not create or link a player, change a user account, or mutate game-domain state.

## 14. Room-scoped membership history

- A verified single-person `NEWMEM/feedType=4/members[0]` row records `joined`; a verified single-person `DELMEM/feedType=2/member` row records `departed`.
- The embedded `userId` is the identity key and must remain a string. The embedded `nickName` is a verified room-scoped observation for that event; Iris name caches are not used.
- Each room/user summary may show total joins, first join, previous departure, current event time, aggregate message and deletion counts, previous verified nicknames, and the latest five membership events.
- Message bodies, profile images, URLs, phone numbers, and unrelated KakaoTalk profile data are not retained for membership summaries.
- Until controlled payloads distinguish voluntary departure from operator kick, every `DELMEM` record is displayed only as `퇴장`. Warning and permission counts are omitted until their own authoritative domain policies exist.

## 15. Administrator monitoring console

- `super_admin` and `manager` receive `monitoring.read`; individual manager `deny` overrides still apply.
- REST resources are `/api/v1/admin/monitoring-events`, `/api/v1/admin/moderation-incidents`, and `/api/v1/admin/channel-membership-events`.
- `/api/v1/admin/monitoring-events` accepts `group=media|event`. Media includes only single/multiple images and videos. Replies, stickers, emoji-like and rich-card events remain internal `event` data and are not exposed as administrator monitoring menus. Moderation and membership use their dedicated resources and screens.
- A churn candidate has at least two joins or at least two departures for the same channel and external identity across the complete retained membership history. No rolling time window is applied.
- Operators and managed channels form a many-to-many assignment. Room-scoped permissions must be enforced in server queries and content authorization, never only by hiding rows in the frontend.
- Lists show the latest verified KakaoTalk DB room/user names where available and clearly fall back to string external IDs when unavailable.
- The console stores and displays event classification, correlation IDs, occurrence time and aggregate counts, not ordinary message bodies, recovered deletion bodies, attachment payloads or media URLs.
