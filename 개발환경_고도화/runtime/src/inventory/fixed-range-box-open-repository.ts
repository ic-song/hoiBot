import type { FixedRangeBoxDefinition, FixedRangeBoxPlan } from "./fixed-range-box-open-policy.js";

export interface FixedRangeBoxActor { identityId: string; playerId: string; rankLabel: string; }
export interface FixedRangeBoxLockedState {
  boxItemId: string;
  boxQuantity: bigint;
  boxVersion: bigint | null;
  rewardItemId: string;
  rewardQuantity: bigint;
  rewardVersion: bigint | null;
  rewardStackExists: boolean;
}
export interface FixedRangeBoxStoredResult {
  status: "opened";
  playerId: string;
  commandCode: string;
  data: string;
  outboxId: string;
  auditId: string;
  requestedOpenCount: number | null;
  effectiveOpenCount: number;
  rngSeed: string;
  rngTrace: number[];
  totalQuantity: string;
  boxBefore: string;
  boxAfter: string;
  rewardBefore: string;
  rewardAfter: string;
  rewardZeroStackCreated: boolean;
  duplicate?: boolean;
}
export interface FixedRangeBoxCommandRecord { eventId: string; channelId: string; externalUserId: string; message: string; }

export interface FixedRangeBoxOpenTransaction {
  isCastleSiegeActive(): Promise<boolean>;
  findActor(externalUserId: string): Promise<FixedRangeBoxActor | null>;
  findStoredResult(scope: string, key: string): Promise<FixedRangeBoxStoredResult | null>;
  lockState(actor: FixedRangeBoxActor, definition: FixedRangeBoxDefinition): Promise<FixedRangeBoxLockedState>;
  persist(actor: FixedRangeBoxActor, scope: string, key: string, command: FixedRangeBoxCommandRecord,
    definition: FixedRangeBoxDefinition, state: FixedRangeBoxLockedState, plan: FixedRangeBoxPlan): Promise<FixedRangeBoxStoredResult>;
}

export interface FixedRangeBoxOpenRepository {
  withTransaction<T>(work: (transaction: FixedRangeBoxOpenTransaction) => Promise<T>): Promise<T>;
}
