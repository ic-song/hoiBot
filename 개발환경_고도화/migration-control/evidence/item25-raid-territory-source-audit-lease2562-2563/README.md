# item25 raid/territory source audit — Lease 2562 + 2563

## Audit boundary

- Evidence-only audit at Git commit `b586e5f9c88731536f2770d5beda8abae7d3e88c` on branch `codex/item25-raid-territory-source-audit-v1-20260906`.
- Authoritative legacy source: `data/itemInfo.json`, raw SHA-256 `49ef9f7b39ffa5fab57c0d3759f8a682c7be759e4708f76744ae095fc673ffdc`, Git blob `79e95a5951c1b4797cec790cd4c27094796158dc`.
- Runtime source seals: `main.js` SHA-256 `91bd1c772aeb0979359ff2af86320850b77a738c1ddee295ae843ca5bcb10495`, `Info.js` SHA-256 `03e4914d8747712eeceb169409414729723af4e4d9eac41365f73bbdb7ae09a1`.
- Line-span hashes below use SHA-256 over the UTF-8 text of the inclusive span after CRLF/LF normalization to LF, with no trailing LF added.
- No runtime, data, contract, provider, test, migration, package, Sheets, Gate, operational, or `feature/prod` state was changed. This audit does not create an acquisition, effect, consumer, alias, rename, merge, deletion, or legacy-Rhino lifecycle-intent classification.

## A. `raidSpecialItem`

### A1. `dept1`: eight original occurrences

All eight definitions occur on `data/itemInfo.json:113`. Their identity evidence is the JSON pointer occurrence plus the exact payload fingerprint; display names are not treated as identity.

| JSON pointer | Exact payload | Locator SHA-256 | Payload SHA-256 |
| --- | --- | --- | --- |
| `/raidSpecialItem/dept1/item_0` | `{"name":"항생제💊(+50👾)","exp":50}` | `6c1e631db44a4a93eec500a74f9bd8d4e3cffd3d3c941c6353c2f99bf268333d` | `1dd1e9404b18b44aeff91cf4c13c7f9fe0d1e7bf1aa2d5ed09d9a47b4179184f` |
| `/raidSpecialItem/dept1/item_1` | `{"name":"마늘🧄(+50🧛‍♂)","exp":50}` | `1803017a1c2adc07c593a048ceaecab4a611c36ec663ab622791ba6a32543243` | `8e70c62fcf4045f0aefaea4990631729fbdd0927d12eee2ac41ee5a828a201a1` |
| `/raidSpecialItem/dept1/item_2` | `{"name":"거울🪞(+50🤬)","exp":50}` | `2f8341032ef44269f7c11b782312c0669e9ec1863a35435ebc2bae3f595b1a50` | `17f4a0a8a9c167057e386dde71fb4a0b40f706ff1750c620dfcaa30a4f6daaf6` |
| `/raidSpecialItem/dept1/item_3` | `{"name":"에프킬라💦(+50🪳)","exp":50}` | `861226c471b6c4f2ebeea0b718da2beff2f0095653af8e7383fd36a4d26b0fab` | `cf59d7f65a51b3ea565d4bb68137e8efda606d453841188e2cbffa6df37bc147` |
| `/raidSpecialItem/dept1/item_4` | `{"name":"도깨비가면👹(+50🧌)","exp":50}` | `6957b1cb101cfb69e3f13be1a9f8795abbf4a2ab5bb3cb1945484d9f51530581` | `af0fa690ad85cc69a02b1a91e18607c1d34f05238f81805ba8329a926d43e304` |
| `/raidSpecialItem/dept1/item_5` | `{"name":"곰팡이🍄(+50🍄)","exp":50}` | `534059111229846d641c3f3b47a96374167151838cb5d101efb97efa9332b96e` | `531c2d3ba7bafa8f7a624fbd62d0f80c8e3c9b057871fa89c3f6a41506616652` |
| `/raidSpecialItem/dept1/item_6` | `{"name":"트롤심장💓(+50🪅)","exp":50}` | `d53bbe01c983c85b35e0856ef599a7a1105e30ec7d4a97055a46fe9c32926162` | `554608eb810cec1743038aff55422d5b76de316204d9fadd3a21cf8a770f82f9` |
| `/raidSpecialItem/dept1/item_7` | `{"name":"하리보🪼(+50🌝)","exp":50}` | `56ee841f78b109d2539d823a189ee797c8b5de62efd824d482a2189b9d085fc9` | `16bd07b5a914e70d037b567da396af2bf04febceb2f0c4949c8f737736de7678` |

Locator formula: `SHA256("data/itemInfo.json\0" + sourcePointer + "\0RAID_ITEM_DEFINITION\0" + sourcePointer)`. Payload formula: SHA-256 of recursively key-sorted compact JSON.

The group and every row above use record kind `RAID_ITEM_DEFINITION`; it is a required locator input, not an inferred category.

Confirmed current references:

- `main.js:1936-1939` loads `itemInfoData` and binds `raidSpecialItem` plus `castleItem`, but not `castlePremiumItem`; span hash `123ddb34210703b94ca90143fcd9f788ff80094f67924a05da47a84a41704586`.
- Exact searches in `main.js` and `Info.js` find no `raidSpecialItem.dept1` access and no occurrence of any of the eight complete display names. Therefore a dept1-specific acquisition/effect/consumer is **not confirmed** in the Rhino source.
- `generateBagOutput` is generic: any existing bag key not in its explicit special list is placed in the remaining-key path and displayed/sorted (`main.js:36587-36868`, hash `5390b06974a5931b1de63204aed8de9a44c09862e54fb36bc9e53d4211856582`; mirrored `Info.js:2647-2929`, hash `5e93647cc00b0661db9704fe1dcaabdc2611466c890d755d2526a4add7913495`). This is conditional generic handling, not proof that a dept1 item is acquired or owned.
- `/가방` reads the generic result (`main.js:16671-16695`, hash `76f3d644f18991a4bfb878fbc228dc9234532c2d3bc5a2bb984dd4a654678bac`). Admin `/정보` also reads the same generic output (`Info.js:323-342`, hash `5ccb4a1f02679e84fdaf47e4266eebb46c946a8c91dab91ff9f8ae39e5a80d44`).
- Generic ownership helpers operate by exact bag key (`main.js:37868-37903`, hash `4485582ee2ffb12552a32ca64118880909b2a4244dd3849245c8964068b77078`). Master `/가방추가` can add an operator-supplied exact string (`main.js:6690-6706`, hash `0eef35493a8b666b67eb6fd5fdb293697e23830afe3ba59c9f9bbd6c2a7e8d71`); that generic administrative capability is not a dept1-specific acquisition definition.
- `/당근` selects the exact key by generated bag index, checks `isTradableItem`, moves it sender→receiver, consumes carrots, and saves `member.json` (`main.js:5261-5341`, hash `6db67eaaf926ba5ed67655067d5fd888d217dbbefbb9ca305b701017678f5862`).
- `/가방거래등록` selects the exact key by generated bag index, checks `isTradableItem`, removes the quantity, creates a `type="bag"` listing, and saves `member.json` plus `freeMarket.json` (`main.js:4216-4265`, hash `89833dd01cc891add7f371b7e3b611840fa8714d673a6eb440190f0acf797c2c`). Cancel/forced-cancel restores the exact listing name (`main.js:4520-4541`, hash `a6809ed01c4bf0c071ab693810f46e315e706cdf5f42007781608f2aeb206bfc`; `main.js:38650-38654`, hash `0f2f57e3ae3413048c832b8c45c57427586d31fdbf777cbe7de3d2e7757788d7`). Purchase transfers the exact listing name and saves both stores (`main.js:4586-4666`, hash `4a8d5bff3f78df590a1ea1f60a2870bc8248f1a7c3517ae945e462b2fac91ad7`).
- `isTradableItem` denies only normalized intimacy or names present in `itemList.untradableList` (`main.js:39323-39337`, hash `ce38c66378d4a58be4e9a456d9a7e3be519d3a513a8f7600702c917c15f9d296`). All eight complete dept1 names are absent from both `untradableList` and `nonItems` at this commit. `/판매` therefore conditionally accepts such an owned key and pays the generic fixed price (`main.js:16781-16835`, hash `917633f17e18c0c224eabbd036aa000442fdca05f79d4ff22c73e73156b5af86`). This describes current generic behavior; it is not a lifecycle or product decision.
- Read-only aggregate of `data/member.json` at SHA-256 `130b31e1f852c466f7e648a6fa41ed6afe8b3d2898d2a05dc58a970a951672a4`: every complete dept1 name has `ownerCount=0`, `totalQuantity=0`. Read-only aggregate of `data/freeMarket.json` at SHA-256 `54e2d3f80b349121eef684310288d08e2115296bacdbd7900a246a1e580310d0`: every complete dept1 name has `activeBagListingCount=0`.

Lifecycle evidence is deliberately split. The absence of a dept1-specific Rhino acquisition/effect consumer does **not confirm** any active/inactive/unused intent in the legacy Rhino lifecycle. Independently, the already-applied `386_iteminfo_raid_definitions.sql` inserts all eight dept1 definitions with `active=1` and restores `active=1` on duplicate (`16-27`, hash `3fdf25c8b4b457d865f935b37073fb07b1b4a0addfdf1573d59a7522c1266367`; typed rows `60-72`, hash `a4158c06fc4541be96279654878e067c538a0dc0f2f6da04e4ee47e15ae48acb`). The existing item25 canonical provider requires projection `active_flag=true` and accepts only persisted true/1 values (`item25-canonical-definition-provider.ts:433-464`, hash `d2d26ad37e3b16129e238855dc5dcd30688d96e7507f6e2b2e012c4dbb647cb5`). Therefore the current DB artifacts explicitly encode active definitions. Neither the Rhino uncertainty nor zero snapshot ownership authorizes deletion or deactivation.

Auction-name non-equivalence:

- `main.js:18342-18367`, hash `d164c5f591b8fdca1a441ae2f6478de59de377453541770123c35ba9a3434cff`, caps five auction names: `도깨비가면👹`, `마늘🧄`, `에프킬라💦`, `거울🪞`, `항생제💊`.
- These strings are not equal to the five corresponding dept1 display strings because the dept1 strings include distinct `(+50…)` suffix payloads. The source contains no provenance edge, alias table, conversion, or exact-key comparison connecting them. `곰팡이🍄(+50🍄)`, `트롤심장💓(+50🪅)`, and `하리보🪼(+50🌝)` have no bare-name occurrence in `main.js` or `Info.js`.
- Result: equivalence, rename, merge, or shared identity with the eight dept1 occurrences is **not confirmed** and must not be inferred.

### A2. `dept2`: raid strike seal, audited separately

- Definition occurrence: `/raidSpecialItem/dept2/item_0` at `data/itemInfo.json:113`, exact payload `{"name":"레이드타격대인장👑(+600👾)","exp":600}`, locator SHA-256 `064bcb1971ffce549b2d5f00810b58d3bcc0bec937d89b5bb232f40037c9f8bf`, payload SHA-256 `77cb001679d3e915622e91a872848c4c53b388479d4c88ca68760361e18c6ee9`.
- This occurrence uses record kind `RAID_ITEM_DEFINITION` in the same locator formula as A1.
- `main.js:36944-36964`, hash `52ed22994b30aec5dfb310c7ac1c2fc5806e5684d6282ab25e98ca733ff9071a`, iterates only `raidSpecialItem.dept2`; each exact bag count contributes `count * item.exp` to raid charm.
- `Info.js:2957-2964`, hash `360a4c1c298fcc766d0e71b41be453555c07aa1f89a52fe296a1aeead586fc17`, adds the same dept2 count×exp during gear calculation. `Info.js:3084-3107`, hash `561102b2e986c35ffa4b9a4d2e9579449fb37bf2d01a4627348e0e39036619cd`, repeats it for `calculateItemInfo("bag", ...)`.
- Confirmed acquisition references: `/홈패키지오픈2` awards one (`main.js:12412-12429`, hash `35214463eabb37f4da6a2f4696412c960893a0c97807a4f50e619d2caf3eff43`); `/레이드인장조합 [수량]` consumes 1,000 `잡템☠️` and 1,000,000,000 points per unit and adds the exact seal key (`main.js:14493-14521`, hash `093649a51cfb55df2ca28192c55b7af5aeff422e431f2e25f1588166b11d9348`).
- Confirmed data-driven references: `data/trialTowerBoss.json:/0/reward/15/item` is awarded through `main.js:19770-19900` (hash `538f8856d4bb87f21e7342341e00ee526d4b0119c9b0336dc9f84c1a1f36de04`). `data/petSweetHomeInfo.json` has 140 exact `required[*].item` occurrences (indices `4`, `9..44 step 5`, `49..94 step 5`, `99..194 step 5`, and every `199..299`); `/집짓기` checks them and `/집뚝딱` consumes them through `main.js:20840-20948` (hash `7a9b514b8273da56aa167dc888a7c18a32f7a2d71fff8a88c690bf247cf96edc`).
- Bag display explicitly orders the seal (`main.js:36693`; `Info.js:2753`) in addition to the generic read/trade flows above.
- Read-only aggregate at the sealed snapshot: `data/member.json` has 308 owners and total quantity 7,342; `data/memberBagCheck/memberBagCheck.json` has 292 owners and total quantity 5,251. These are two separate snapshot files and are not asserted to be synchronized. `data/freeMarket.json` has zero active bag listings and one completed-log name occurrence. `data/itemList.json:/nonItems/44` blocks `/판매`, while the exact name is absent from `untradableList`, so generic `/당근` and free-market tradability remain allowed by the current predicate.

## B. `castlePremiumItem` source six vs `/영지공격` runtime four

### B1. Six independent metadata occurrences

All six occur on `data/itemInfo.json:113`. Preserve the JSON pointer occurrence, display string, and stored `successRate` independently.

| JSON pointer | Exact payload | Locator SHA-256 | Payload SHA-256 |
| --- | --- | --- | --- |
| `/castlePremiumItem/offense/item_0` | `{"name":"영지기습공격권🔥(90%)","successRate":1}` | `d11654782bf9215265ec5634cde659f19b40c3ed2ff66fe33aa9e2abc9713cfa` | `6cfc7c7f7cf86cdaebe460f643a0141ad986f14412b7f9b82021bab6915bb931` |
| `/castlePremiumItem/offense/item_1` | `{"name":"영지기습공격권🔥(60%)","successRate":0.6}` | `ee39bf2d9fbc9c26180f31723bbda8304f053665053f421853ae1900d5b45452` | `7566199a8dc3c413d3da321f1ff3b260df97fdbd0613c8fb268ee7863a15a7db` |
| `/castlePremiumItem/offense/item_2` | `{"name":"영지기습공격권🔥(20%)","successRate":0.2}` | `31425b80cf2f78ead7d5b69e4589c63c6d3690a32f5cc37811f373aa4cb17f1d` | `6de70ebe9a02990925a456a7902fd8cf3097382e7e123fa1a5d07776dcd5ed4c` |
| `/castlePremiumItem/defense/item_0` | `{"name":"영지절대방어권🛡(80%)","successRate":1}` | `8113260064cee82167ecc082a2cc8721e98663ae53de461a6d01a92a89275350` | `ffffee0a42417d74619adeaa75eb0519ac16bf9d7cde2a0751c37ba285ac4f0b` |
| `/castlePremiumItem/defense/item_1` | `{"name":"영지절대방어권🛡(50%)","successRate":0.5}` | `9fefd5cb6aa6dbf7debfc5100c8995ab10845874f9b51ea0cbad3ec37a2a891a` | `12bf5336112b4190bcb3bc76293bf9cd85ef7bdaab50a4292d8634468cf0b839` |
| `/castlePremiumItem/defense/item_2` | `{"name":"영지절대방어권🛡(25%)","successRate":0.25}` | `a03a4f429b886ef466df22d97fe2b921dead90abcef4e395ab1fe8cedb73d29d` | `6372dcff989691209c40806d94f435f414c0e1bff459ee717f3eb96c7d1363ac` |

The group and every row above use record kind `TERRITORY_ITEM_DEFINITION`. Locator formula: `SHA256("data/itemInfo.json\0" + sourcePointer + "\0TERRITORY_ITEM_DEFINITION\0" + sourcePointer)`.

- `Info.js:267-277`, hash `1de895c1db00e19cf75d875d13245205c58df12c1004cebffab54a8df8713dca`, loads/rebinds `castlePremiumItem`, but exact search finds no later dereference. `main.js:1936-1939` does not bind `castlePremiumItem`.
- Current snapshot ownership is evidence about exact keys, not lifecycle: offense 90% = 67 owners/4,349; offense 60% = 161/43,094; offense 20% = 0/0; defense 80% = 45/10,280; defense 50% = 162/32,640; defense 25% = 0/0. No active bag listing exists for any of the six at this snapshot.
- The already-applied `387_iteminfo_territory_ticket_definitions.sql` preserves these six independent source rows with `active=1` (`34-55`, hash `39adeaddd61f4b78cee3efbd904b858bbd90b8675e97bc635d5a3c57de2cd10b`; typed rows `68-81`, hash `7268bc9f11647dd6939c2f6c2e3efd43237f3a5dea5bdf9033166aea4765dafa`). This is definition-state evidence only and does not bind any row to the runtime four.

### B2. Actual `/영지공격` runtime candidate set and sequencing

The authoritative runtime span is `main.js:31496-31541`, normalized-LF SHA-256 `b21160a3ea9b5a4fb6decdcf067eb0e7ac4017741ada9bf22a6411e4d113f4bf`.

1. Defense candidates are declared first, in priority order: `영지절대방어권🛡(50%)` at `0.5` twice, then `영지절대방어권🛡(20%)` at `0.2` twice (`31496-31501`). Duplicate rows have the same exact name/rate/label; `getGuildTerritorySpecialItem` returns the first owned candidate (`31301-31307`). Thus 50% is selected before 20% when both exact keys are present.
2. Offense candidates are `영지기습공격권🔥(40%)` at `0.4` twice, then `영지기습공격권🔥(10%)` at `0.1` twice (`31502-31507`); 40% is selected before 10%.
3. The defender's exact-key defense candidate is resolved before any offense lookup (`31508`). The guild-cube ambush-defense percent is read next (`31509`), and debug output is optional (`31510-31512`).
4. If a defender exists, defense success is tested with `Math.random() <= defenseItem.successRate` (`31513-31515`). Only a successful defense roll decrements the defense item (`31516`), builds failure output, and returns before offense lookup (`31518-31525`). A failed defense roll does not decrement and falls through.
5. Offense lookup occurs only after the defense block (`31529`). Offense success also uses `Math.random() <= offenseItem.successRate` (`31530`). Only a successful offense roll decrements the attack item (`31532`).
6. The attack decrement is complete before guild-cube defense is tested (`31533`). The cube comparison is strict `<`, not `<=`: `Math.random() < guildCubeAmbushDefensePercent / 100`. If it succeeds, the already-consumed attack item is not restored and the resolver returns attack failure (`31534-31540`).
7. If the cube does not stop a successful surprise attack, ownership transfers to the attacker (`31542-31548`) and the resolver returns success (`31549-31555`).
8. If no special-item branch returns, missing defender/pet data causes automatic occupation (`31558-31569`, part of span hash `c8658a706e3aa1e3be3651441ec2b415444a84cd708e5708f14f4f049d67fd80` for `31558-31594`). Otherwise the normal castle battle uses strict `attacker.finalExp > defender.finalExp`; equality is a defender win (`31572-31593`).
9. Outside the resolver, a normal `1..7` attack clears the timer, increments guild and user attack counts, and applies the turn reward before calling the resolver (`main.js:14294-14315`, hash `461490a5cac755b84edd2e9c8792a23d838104d64a579f7f046e66a66e0a91ce`). After result/rift/turn handling, both `guildData` and `data` are saved (`main.js:14371-14374`, hash `9aa5899333ad8bc11e88c05a1b8632a76671ffdd58489d7e6cda26fe8a26232e`). This preserves the exact outer sequencing; it does not imply an item-definition mapping.

Runtime-four provenance boundary:

- Exact string searches confirm the runtime set is offense 40%/10% and defense 50%/20%. `data/itemInfo.json#castlePremiumItem` is offense 90%/60%/20% and defense 80%/50%/25%.
- The only exact name/rate overlap is `영지절대방어권🛡(50%)` at `0.5`. That textual/value match alone is not an occurrence/provenance binding. No code passes a `castlePremiumItem` occurrence into `resolveGuildTerritoryAttack`, so identity between source `defense/item_1` and the runtime 50% candidate is **not confirmed**.
- `main.js:27996-28020`, hash `09586cc4316f7c31736b26aaf3d4c52768bade209489a0549d54f0e6ee86fb6a`, contains explicit one-time name conversions from four `캐슬...` keys to the four runtime `영지...` keys. It does not reference the six `castlePremiumItem` JSON pointers and does not establish a six-to-four mapping.
- Confirmed runtime-four acquisition references are independent: Master `/공방` grants 40% attack and 50% defense (`main.js:10040-10072`, hash `471079783d64e458fb221d59487b1905ca526806610335eeb58e356d16316fcd`); random-box flows grant 10% attack and 20% defense (`main.js:15975-16010`, hash `75f94c791e7cc75b4a5c44f4d44a21b2e211a5e7c4066010f02ef4cee2a3d5ae`, and `37774-37798`, hash `f39f375ba1044114b38c968ef46190be0ee8e3ddc348787f7884ffdab62f1e6c`). Bag display explicitly orders all four (`main.js:36757-36760`, hash `617715fa574631fdc6b4dace00e2770c2d611add00ce9834a4b813141f52c438`; `Info.js:2817-2820`, hash `ea6018e517a1fe2b5ed525d327ca621a036de47c06428d8831ab02ff8e9043bf`).
- At the sealed `data/member.json` snapshot, 40% attack, 10% attack, and 20% defense have 0 owners/0 quantity; 50% defense has 162 owners/32,640 quantity. This overlap in one exact string does not supply missing source-pointer provenance.

### B3. Existing DB service parity evidence

- The already-applied `353_guild_territory_attack_execute.sql:163-180`, hash `95e9f2bbe056302177523183c1d448849aced2861cfbe763d832df11dd4fb175`, defines and seeds only `영지절대방어권🛡(20%)` at 2,000 bps and `영지기습공격권🔥(10%)` at 1,000 bps. It has no 50% defense or 40% attack policy slot and therefore cannot express the legacy four-key priority by itself.
- The existing service resolves one policy defense code and one policy attack code. At `guild-territory-attack-service.ts:478-487`, inside span `469-505` (hash `57a7cda21ac381e400e4e3ce00c121d1b1bb36a2ba2b97b3a0639f0bd51591a2`), it calls `consumeItem` before each `persistDraw`; `consumeItem` decrements the stack and writes `-1` to the inventory ledger (`538-548`, hash `cf142ecf16319781624c97296f3e771ddcf35347c16987a2fa4d4e8b31e33ffb`). Thus it consumes the selected ticket even when the later draw misses.
- Its deterministic item hit test is `bps < thresholdBps` (`561-573`, hash `4dbd833305a20ff4442851059ee32c207e48ead897d305e745c1d8c8bd5aa869`). By contrast, the sealed legacy runtime has four exact keys in 50/20 defense and 40/10 attack priority, uses `<=`, and decrements only after a successful item roll. The DB implementation therefore has a confirmed four-key coverage/priority gap, comparator gap, and success-only decrement parity gap. Its attack item is still consumed before guild-cube defense, matching that relative part of legacy sequencing.
- These are findings against existing implementations, not authorization to edit applied migrations. Any correction must be additive through a new migration/policy version plus a minimal service/test remediation, while retaining migrations 353, 386, and 387 unchanged.

## Confirmed / not confirmed

Confirmed:

- Fifteen independent source occurrences: eight dept1, one dept2, and six castle-premium metadata rows, each with exact pointer, payload, locator hash, and payload hash.
- Dept2 has explicit current charm consumers, acquisitions, building-cost consumption, tower reward, generic bag/trade handling, and snapshot ownership.
- Dept1 has conditional generic bag/read/sell/trade/admin-add handling only if an exact bag key exists; no exact current owner/listing or dept1-specific acquisition/effect/consumer is present in the audited Rhino source/snapshots.
- `/영지공격` uses the four inline runtime names/rates and sequencing documented above, independently of the six metadata occurrences.

Not confirmed and therefore not asserted:

- Any dept1 display-name merge with the five shorter auction names.
- Any dept1 acquisition, +50 effect consumer, or active/inactive/unused intent in the legacy Rhino lifecycle; rename, alias, or deletion intent. Separately, migration 386 and the item25 provider explicitly require active DB definitions.
- Any six-to-four `castlePremiumItem` mapping, rate overwrite, or equivalence based on similar names/numbers.
- Any identity reuse based on display name alone, including the exact 50% defense text without a provenance binding.

## Minimal follow-up slices and decision boundary

1. **Migration 386 + item25 provider additive validation:** validate the existing eight dept1 projections, exact pointer/payload fingerprints, `active=1`/`active_flag=true`, and conditional generic inventory compatibility. Remediate only by new validation or an additive corrective migration/provider change; do not duplicate the provider, edit migration 386, or add an acquisition/effect consumer.
2. **Existing dept2 implementation additive validation:** validate the item25 projection and the existing craft/package/home/tower implementations plus all three charm-read paths as one parity boundary. Add only missing validation/remediation around those implementations; do not create a duplicate provider or duplicate craft/home/tower consumer.
3. **Migration 387 + item25 provider additive validation:** validate six independent territory metadata projections and options without binding them to the runtime four. Correct future drift additively; do not edit migration 387, duplicate the provider, or infer a six-to-four identity.
4. **Existing guild-territory-attack service additive remediation:** first lock regression evidence for the current 20-defense/10-attack policy and pre-RNG consumption. If legacy parity is required, add a new migration/policy version and minimal service/tests for the four exact runtime keys, 50/20 and 40/10 priority, `<=` item comparison, success-only decrement, defense-before-offense, and attack-decrement-before-cube sequencing. Do not edit applied migration 353 and do not use the six metadata rows as guessed identities.

No user decision is required to preserve these independent facts, validate existing artifacts, or prepare additive remediation for the confirmed DB-service parity gaps. A genuine product/provenance decision remains only if future work wants to identify, replace, alias, or map any of the six metadata occurrences to the four runtime items, or wants to add a dept1 acquisition/effect consumer. Current source evidence cannot make either decision.

## Search record

- Index-first: `COMMAND_INDEX.md` terms `레이드`, `raid`, `영지공격`, `territory`, `봉인`, `seal`, `가방`, `경매`, `거래`.
- Source identifiers: `raidSpecialItem`, `raidSpecialItem.dept1`, `raidSpecialItem.dept2`, `castlePremiumItem`.
- Exact display strings: all eight dept1 strings, dept2 seal, six metadata strings, and four runtime strings.
- Similar-name audit: the eight base names without `(+50…)`, plus `캐슬기습공격권` and `캐슬절대방어권` conversions.
- Generic flows: `generateBagOutput`, `/가방`, `/정보`, `/가방추가`, `/판매`, `/당근`, `/가방거래등록`, `/자유시장구매`, `/자유시장취소`, `/거래소강제취소`, `isTradableItem`, `hasItem`, `removeItem`, `addItem`, `data.auction`, `biditemName`.
- Data-driven references: recursive exact-value scan of `data/member.json`, `data/memberBagCheck/memberBagCheck.json`, `data/freeMarket.json`, `data/itemList.json`, `data/petSweetHomeInfo.json`, and `data/trialTowerBoss.json`.
