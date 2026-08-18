import type { CastleCardOpenPlan } from "./castle-card-open-policy.js";

export interface CastleCardActor { identityId: string; playerId: string; rankLabel: string; senderName: string; }
export interface CastleCardItemState {
  itemId: string;
  quantity: bigint;
  version: bigint | null;
  stackExists: boolean;
}
export interface CastleCardLockedState { items: ReadonlyMap<string, CastleCardItemState>; }
export interface CastleCardCommandRecord { externalUserId: string; channelId: string; message: string; eventId: string; }
export interface CastleCardStoredResult {
  status: "opened";
  playerId: string;
  commandCode: string;
  immediateOutboxId: string;
  immediateData: string;
  delayedOutboxIds: string[];
  auditId: string;
  openCount: number;
  rngSeed: string;
  rngTrace: CastleCardOpenPlan["rngTrace"];
  aggregates: CastleCardOpenPlan["aggregates"];
  duplicate?: boolean;
}

export interface CastleCardOpenTransaction {
  findActor(externalUserId: string): Promise<CastleCardActor | null>;
  findStoredResult(scope: string, key: string): Promise<CastleCardStoredResult | null>;
  lockState(actor: CastleCardActor): Promise<CastleCardLockedState>;
  isCastleSiegeActive(): Promise<boolean>;
  persist(actor: CastleCardActor, scope: string, key: string, command: CastleCardCommandRecord,
    state: CastleCardLockedState, plan: CastleCardOpenPlan): Promise<CastleCardStoredResult>;
}

export interface CastleCardOpenRepository {
  withTransaction<T>(work: (transaction: CastleCardOpenTransaction) => Promise<T>): Promise<T>;
}
