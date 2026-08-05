# hoiBot System Policies

Last updated: 2026-08-05

This document is the implementation-facing business policy for the modernized hoiBot system.
Only rules explicitly confirmed by the user are normative. Legacy observations and unresolved choices are separated from active rules.
If this document conflicts with `../DECISIONS.md`, `../DECISIONS.md` takes precedence.

## 1. Policy hierarchy

1. `DECISIONS.md`: authoritative user decisions.
2. This document: detailed domain rules, examples, invariants, and implementation acceptance criteria.

## 2. Operations authorization, entitlements, and account purpose

- Operations authorization uses `super_admin` and `manager` roles. A normal user has no administrator role.
- `super_admin` receives every active permission. The final active super administrator cannot be suspended, demoted, or deleted.
- `manager` starts with read-oriented permissions. A super administrator may add per-operator `allow` and `deny` overrides; `deny` has final precedence.
- A free pass is a player entitlement, not an authorization role. Permanent and time-bounded passes are supported, and grants and revocations retain the operator reason and audit history.
- Test accounts exist only in a separate test environment. Production blocks both their creation and login.
- Every administrative mutation requires session authorization, CSRF, an `Idempotency-Key`, a non-empty reason, explicit reconfirmation, and an audit record.
3. `MEMORY.md`: current work position and open questions.
4. Legacy code and JSON: migration evidence, not the final policy when a newer explicit decision exists.

## 3. Account, character, and external identity

### 2.1 Cardinality

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

### 2.2 Internal account name

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

### 2.3 Command identity gate

A KakaoTalk or Discord game command is accepted only when both conditions are true:

1. The provider account key is registered to an active internal account.
2. The current provider nickname exactly equals the internal account name.

Nickname-only identity resolution is forbidden. A matching nickname with an unknown or different provider key must never grant account access.

If the provider key is valid but the nickname differs, game command execution is blocked and only a nickname correction guide may be returned.

### 2.4 Cross-platform continuity and concurrency

- KakaoTalk and Discord operate the same internal account and character state.
- A change made through one provider must be visible through every other provider.
- Commands for the same internal account are serialized and executed one at a time regardless of provider.
- Commands for different internal accounts may execute concurrently.

## 4. Signup and provider linking

### 3.1 Initial signup

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

### 3.2 Verification code

- Valid for 30 minutes from issuance.
- Single use.
- Invalidated immediately after successful verification.
- Invalidated after five failed attempts.
- A new code must be issued after expiry or invalidation.
- Store only a secure hash of the code, never the original code.
- An unverified account remains for 24 hours and may issue a new code after site login.
- After 24 hours without successful KakaoTalk verification, delete the pending account, credential hash, and account-name reservation.

### 3.3 Link and relink

- `내정보 > 계정` provides KakaoTalk relinking and Discord linking/relinking.
- KakaoTalk and Discord use the same one-time-code verification model.
- A provider identity already linked to another internal account cannot be linked.
- During relinking, the existing provider identity remains active until the new identity passes verification.
- A successful relink atomically deactivates the previous identity and activates the new identity.
- Failed or expired relinking leaves the previous identity unchanged.

### 3.4 Website credentials and consent

- Login ID is separate from the internal account name and never changes when the account name changes.
- Login ID is globally unique and must match `^[a-z0-9]{6,20}$`.
- Password length is 8 to 64 characters and must include at least one ASCII letter and one digit.
- Passwords are stored only as Argon2id hashes and must never be written to logs.
- Required terms consent must be completed before nickname validation and verification-code issuance.
- The privacy notice is informational and does not require a separate consent checkbox or consent-history row.
- Marketing consent is not collected.
- Consent history stores only account ID, document type, document version, and acceptance time; IP and device information are not stored.

### 3.5 Sessions and password reset

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

### 5.1 Withdrawal grace period

- Withdrawal starts a 30-day grace period.
- During the grace period, website features and KakaoTalk/Discord game commands are blocked.
- A login attempt shows the scheduled permanent-deletion date and a withdrawal-cancellation action.
- The user may cancel withdrawal on the site during the grace period.
- Signup with the same provider key returns `이미 가입한 사용자`.
- The internal account name and provider keys remain reserved during the grace period.

### 5.2 Permanent deletion

After 30 days without recovery:

- Delete personal account data, game state, and external-identity links.
- Release the internal account name for reuse.
- Release external provider keys for reuse unless the account was permanently suspended.
- Anonymize and retain currency ledgers, transaction records, and audit records needed for integrity and investigation.
- The deleted game account is not recoverable.

### 5.3 Temporary suspension

- A temporarily suspended user may authenticate to the website only to see the sanction reason and end date, submit an inquiry, or log out.
- All game functions and KakaoTalk/Discord commands are blocked.
- The account automatically returns to active state when the suspension expires.

### 5.4 Permanent suspension

- Permanent suspension has no automatic expiry.
- Website access is limited to the sanction notice, inquiry, and logout.
- Game functions and provider commands are blocked.
- Only an authorized operator may lift the sanction.
- A permanently suspended user may request withdrawal.
- After permanent deletion, original provider keys are removed but non-reversible hashes remain on a permanent denylist to prevent re-registration.

## 7. Currency and operator corrections

### 6.1 Numeric policy

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

### 6.2 Append-only correction

- Operators do not edit or delete an existing currency or inventory ledger entry.
- Corrections create a compensating ledger entry linked to the original operation.
- An authorized operator may execute a correction alone, but a reason is mandatory.
- The operator, target, reason, original operation, before/after value, and timestamp are audited.

### 6.3 Unrecovered assets

- If the full incorrect credit cannot be recovered, the balance or inventory is reduced only to zero/available quantity.
- The remainder becomes an unrecovered currency or item case.
- No automatic offset occurs on later earnings or acquisitions.
- The user may continue normal gameplay, earning, spending, use, and trade while a case is open.
- Operators manage cases manually through a dedicated administration screen.
- Supported case statuses are `OPEN`, `PARTIAL`, `RECOVERED`, and `WAIVED`.

The administration screen must support partial recovery, full recovery, waiver, reason entry, source-operation lookup, and complete history.

## 8. Inventory and capacity

### 7.1 Storage type

- Stackable materials and consumables use quantity-based storage.
- Equipment and other unique assets use individually identified instances.
- The item catalog declares whether an item is `STACK` or `INSTANCE`.

### 7.2 General inventory

- The general inventory has no total slot limit.
- Individual item definitions may optionally set a maximum owned quantity.
- Items without an explicit maximum have no quantity limit.
- When a configured item maximum is exceeded, the accepted quantity fills the inventory and the remainder is delivered by mail.

### 7.3 Restricted bags

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
