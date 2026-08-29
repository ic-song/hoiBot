import type { OpenAllPlan, OpenAllState } from "./open-all-policy.js";

export interface OpenAllActor { identityId: string; playerId: string; rankLabel: string; }
export interface OpenAllStoredResult {
  status: "opened";
  playerId: string;
  data: string;
  outboxId?: string;
  auditId: string;
  pointDelta: string;
  randomTrace: number[];
  openedBoxes: string[];
  deferredGuildItems: string[];
  duplicate?: boolean;
}
export interface OpenAllCommandRecord { eventId: string; channelId: string; externalUserId: string; suppressOutbox?: boolean; }

export interface OpenAllRepositoryTransaction {
  isCastleSiegeActive(): Promise<boolean>;
  findActor(externalUserId: string): Promise<OpenAllActor | null>;
  findStoredResult(scope: string, key: string): Promise<OpenAllStoredResult | null>;
  lockState(actor: OpenAllActor): Promise<OpenAllState>;
  persist(actor: OpenAllActor, scope: string, key: string, command: OpenAllCommandRecord, plan: OpenAllPlan): Promise<OpenAllStoredResult>;
}

export interface OpenAllRepository {
  withTransaction<T>(work: (transaction: OpenAllRepositoryTransaction) => Promise<T>): Promise<T>;
}
