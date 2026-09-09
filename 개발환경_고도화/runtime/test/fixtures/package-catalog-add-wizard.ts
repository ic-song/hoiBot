export interface PackageCatalogWizardFixture {
  id: string;
  scenario: string;
  expectedMutation: "NONE" | "SESSION" | "CATALOG";
}

export const PACKAGE_CATALOG_WIZARD_FIXTURES: readonly PackageCatalogWizardFixture[] = [
  { id: "GUIDE-EXACT", scenario: "exact guide and suffix miss", expectedMutation: "NONE" },
  { id: "START-OVERWRITE", scenario: "start overwrites the active draft", expectedMutation: "SESSION" },
  { id: "STATUS-ACTIVE", scenario: "status preserves reward order", expectedMutation: "NONE" },
  { id: "CANCEL-ACTIVE", scenario: "cancel closes one active draft", expectedMutation: "SESSION" },
  { id: "NAME-DUPLICATE", scenario: "final repository revalidates duplicate name", expectedMutation: "NONE" },
  { id: "DESCRIPTION", scenario: "description advances to reward choice", expectedMutation: "SESSION" },
  { id: "POINT", scenario: "positive point reward", expectedMutation: "SESSION" },
  { id: "ITEM", scenario: "item name and positive quantity", expectedMutation: "SESSION" },
  { id: "REWARD-EMPTY", scenario: "done rejects empty rewards", expectedMutation: "NONE" },
  { id: "CONFIRM-EDIT", scenario: "confirm returns to reward choice", expectedMutation: "SESSION" },
  { id: "FINALIZE", scenario: "session and catalog finalize atomically", expectedMutation: "CATALOG" },
  { id: "EXPIRED", scenario: "expired session is not active", expectedMutation: "NONE" },
  { id: "PERSISTED-RESTART", scenario: "active session resumes after restart", expectedMutation: "NONE" },
  { id: "CATALOG-CONFLICT", scenario: "stale base catalog version rolls back", expectedMutation: "NONE" },
  { id: "IDEMPOTENT-REPLAY", scenario: "same event replays one transition", expectedMutation: "NONE" },
  { id: "OUTBOX-RESTART", scenario: "committed final result retains one outbox", expectedMutation: "NONE" },
] as const;
