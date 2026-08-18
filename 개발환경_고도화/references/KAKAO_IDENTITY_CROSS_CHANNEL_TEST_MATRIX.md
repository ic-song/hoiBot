# KakaoTalk cross-channel identity validation matrix

Last updated: 2026-08-06

## Purpose

Verify whether the same KakaoTalk user can be safely correlated across an open group chat and an open direct chat, including named and random open profiles. The validation must distinguish account identity from mutable room-scoped names.

## Evidence collected per event

Collect only the following privacy-minimized fields. Preserve all numeric provider IDs as strings.

- test case code and KST observation time;
- `chat_logs.id`, `chat_id`, `user_id`, `type`, and direction;
- `chat_rooms.type` and `link_id`;
- matching `open_link.id`, type, active, and expiry state;
- matching `open_chat_member.user_id`, `link_id`, `involved_chat_id`, and nickname;
- matching `open_profile.link_id`, `user_id`, and nickname when available;
- Iris `sender` only as an explicitly untrusted diagnostic comparison.

Do not retain message bodies, profile image URLs, attachments, phone/account fields, or unrelated room members.

## Identity decision rules

1. Exact equality of the string-preserved KakaoTalk event `user_id` across both rooms is the only currently approved automatic cross-room correlation.
2. Equal nickname, profile image, Iris sender, room title, or similar timestamps never prove identity.
3. Equal open-profile/link metadata with different event `user_id` values creates only a manual-review candidate until a controlled test proves its semantics.
4. Different `user_id` values must never be merged automatically. A site-issued provider linking or relinking code is the safe fallback.
5. KakaoTalk DB rows must be scoped by both the current room/link and event user ID.

## Live test cases

| Code | Scenario | Required actions | Expected safe result |
|---|---|---|---|
| `A1` | Named open profile: group to direct | Send exact `/info` in an open group, open a 1:1 chat from that same profile, then send exact `/info` there | Same event `user_id`: correlate; different ID: do not merge |
| `A2` | Random profile: group to direct | Repeat `A1` with a random open profile | Record whether `user_id` and profile/link context remain stable; no nickname-based merge |
| `A3` | Same account, newly generated random profile | Generate a different random profile and repeat group/direct events | If ID changes, keep a separate identity candidate until code verification |
| `A4` | Nickname change on the same open profile | Capture before and after `/info` in the same room | Same ID with new DB nickname: update room profile cache only |
| `A5` | Leave and rejoin with the same profile | Capture before leaving and after rejoining | Preserve identity only if event ID evidence matches; refresh membership state |
| `A6` | Two accounts using the same nickname | Each account sends `/info` in the same open group | Different IDs remain different identities regardless of equal name |
| `A7` | One account using different names by room | Use one verified account with different room profile names | One external identity may have multiple channel profile rows when ID is stable |
| `A8` | Open direct chat created by a different entry path | Compare direct chat opened from a group profile with direct chat opened from an open link/profile | Verify whether physical room type, link, and event ID semantics differ |
| `A9` | Account logout/login or redroid account switch | Re-run a harmless `/info` after the switch | Iris cached sender is ignored; no automatic identity/name overwrite |
| `A10` | Hourly/manual cache synchronization | Change a room nickname, observe cached output, run `/동기화`, and observe again | Cache changes only from scoped Kakao DB evidence; authentication still performs live verification |

## Pass criteria

- Open group and open direct physical room types are recorded from live rows.
- No test relies on Iris sender or nickname equality for ownership.
- Every automatic match has identical provider `user_id` evidence.
- Every mismatch remains separate and produces no account merge or privilege grant.
- Room-scoped nickname cache updates cannot overwrite the system account name.
- The final schema can represent multiple channel names for one external identity.

## First execution: `A1`

1. In the open group chat, use the target named profile and send exact `/info` once.
2. Open an open-chat 1:1 conversation directly from that same participant profile.
3. In the open direct chat, send exact `/info` once.
4. Record both event IDs and compare `user_id`, `chat_rooms.type`, `link_id`, `open_chat_member`, and `open_profile` evidence.
5. Do not change identity mappings until the comparison is complete.
