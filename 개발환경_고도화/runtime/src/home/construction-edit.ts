export interface ConstructionEditInput {
  externalUserId: string;
  channelId: string;
  message: string;
  eventId: string;
}

export interface ConstructionEditRequest extends ConstructionEditInput {
  operatorId: string;
  targetName: string;
  floorArea: number;
  homeName: string;
}

export interface ConstructionEditResult {
  status: "ignored" | "ignored_forbidden" | "invalid_command" | "invalid_floor" | "player_not_found" | "completed";
  data?: string;
  playerId?: string;
  floorArea?: number;
  homeName?: string;
  baseExperience?: string;
  auditId?: string;
  outboxId?: string;
}

export interface ConstructionEditRepository {
  findAuthorizedOperator(externalUserId: string): Promise<string | null>;
  adjust(request: ConstructionEditRequest): Promise<ConstructionEditResult>;
}
