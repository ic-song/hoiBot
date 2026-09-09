# Lease2406 / WBS660 evidence

- Slice: `SL-GUILD-RANK-TITLE-DEFINITION-VERSION-01`
- Migration: `407`
- Baseline: `24a935fce71d810c80c5ba3bbe5a290670b8428a`
- VAL reservation: `10520:10527`
- Gate8: `false`

## Frozen source classification

`main.js#getGuildMasterRankTitle` is the source authority. It defines 19 singleton
ranges for ranks 1 through 19 and one open-ended range for rank 20 and above.
The audited count of 20 is therefore confirmed. The final rule is `[20, infinity)`,
not a rank-20-only row.

- source rows: 20
- canonical definitions: 20
- singleton ranges: 19
- open-ended ranges: 1
- duplicate stable identities: 0
- name-only merges: 0
- source hash: `b717506da8dfcdd725f8255b9c0c58982192ea4c15abe50decbbb98d3a1db5ef`

## Boundary

Migration407 only seeds versioned guild-rank title definitions and links them to
the WBS645 title definition catalog under source scope `GUILD_RANK`. It does not
activate a guild snapshot policy or change player, pet, mini-pet, or guild
ownership, rank projections, rewards, runtime commands, `main.js`, or UI.

## Gate evidence

- Gate1: source/range classification frozen at 20 identities
- Gate2: additive schema compatibility through existing catalog tables
- Gate3: migration407 and guarded rollback
- Gate4: focused fixture/read-model assertions
- Gate5: fresh MariaDB parity, rollback, reapply, reconnect, replay probes
- Gate6: full default regression
- Gate7: Shadow read-only parity probe
- Gate8: false; feature/prod and production DB are excluded
