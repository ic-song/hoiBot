# 운영 JSON A~H dependency graph

- Freeze: `CATALOG-BATCH-ASSET-OPERATING-JSON-GAP-CROSSWALK-01`
- Source overlay: `ASSET-FREEZE-v2.435-OPERATING-JSON-DELTA-20260901-01`
- Scope: classification evidence only
- Gate 8, feature/prod and operational DB remain unchanged.

## Shared predecessors

| Dependency | Required by | Direction |
|---|---|---|
| Ordered policy version and occurrence-row model | A | Preserve duplicate names, source order and first-occurrence removal. Existing unique projection remains carry-forward evidence, not exact snapshot storage. |
| Package target type resolver | B | Resolve every reward as canonical STACK item or nested PACKAGE before linking. |
| Furniture definition and draw-pool separation | C | Keep definition identity separate from ordered duplicate draw occurrences and grade probability policy. |
| `철근⛓️`, `목재🌳` STACK definitions/object links | D | Must exist before the new 300-row building recipe policy can reference them. |
| `신입지원금`, `펫타이틀권🦊(/펫타이틀이름)` canonical identities | E | Must resolve before the full tower reward-policy version can be linked. |
| Existing pet-food item/object truth | F | Reuse `pet_food`; do not create a second identity for `펫먹이🍼`. |
| Lease2454 release and overlap recheck | G | No notice implementation while the pet-explore event-control consumer Lease is active. |
| Deployment-version binding | H | Published developer-note latest version must remain synchronized with deployed `HoiBotVersion`. |

## Approved execution order

```text
classification freeze (this Lease)
  ├─ A item restriction ordered policy
  ├─ F mini-pet collection reward 108
  ├─ H developer-note snapshot and controlled CRUD
  ├─ B package 107 / reward 557 crosswalk
  ├─ C furniture definition + grade policy + draw occurrence
  ├─ D home building 300 ordered progression + recipe policy
  ├─ E tower ordered full reward-policy replacement
  └─ G operation notice, only after Lease2454 release/recheck
```

Each implementation node requires a separate foreman Lease. Existing Gate 1 through Gate 7 evidence is carried forward only when supported by its original Git, DB and test evidence. No existing Gate is reset by this classification.

## Identity rules

1. A restriction identity is not sufficient to reconstruct the source policy; ordered occurrences are part of observable state.
2. A `package_*` source ID, a `PKG-*` catalog ID and a member bag key are separate identifiers.
3. A furniture name is not a complete draw definition. `name + exp + grade/display` and duplicate source occurrences have separate roles.
4. A home building definition is separate from its ordered floor progression row and versioned required-item recipe.
5. Tower boss identities/ranges remain stable while the complete ordered reward policy is versioned.
6. Mini-pet collection rewards reuse the existing pet-food item identity; titles remain their own catalog.
7. Notice and developer-note content are managed content, not player ownership.

## Ownership exclusions

The following remain crosswalk inputs only and do not create new definitions: member bag quantities, guild warehouse quantities, equipped state, furniture placement, collection progress, timers, logs, rankings and user-authored content. Their names may reveal a missing canonical definition, but their quantities and runtime state must not be imported during Gate 1 through Gate 7.

## Stop conditions

- Stop if a target cannot be resolved without matching only by display name.
- Stop if a proposed schema removes source order or duplicate occurrence semantics.
- Stop if a package reward target cannot be classified as STACK or PACKAGE.
- Stop if a current value would overwrite an earlier immutable catalog version.
- Stop if Lease2454 is still active when G is selected.
- Stop before Gate 8, feature/prod reflection or operational-data import.
