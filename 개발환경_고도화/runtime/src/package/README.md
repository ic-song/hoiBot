# Package Hub integration boundary

This directory carries the verified package catalog and reward-domain logic into
the modernization runtime. The SQL migrations use a dedicated `package_*`
namespace so they cannot collide with the existing user, inventory, currency,
pet, title, furniture, or guild-resource tables.

The catalog seed is intentionally preserved as data. Runtime reward delivery
must use typed domain handlers rather than writing package rewards to a generic
balance or instance table.

Integration order:

1. Load the 29 independent package definitions, aliases, rewards, rules, and
   legacy mini-pet catalog through migrations 035-043.
2. Resolve package items to the current domain definitions.
3. Mutate the current domain tables through typed handlers in one transaction.
4. Expose `/패키지가방` and `/패키지사용` through the canary dispatcher.
5. Prove rollback, replay, parity, and isolated-room behavior before rollout.
