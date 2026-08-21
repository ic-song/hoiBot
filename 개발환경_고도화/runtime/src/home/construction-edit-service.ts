import type { ConstructionEditInput, ConstructionEditRepository, ConstructionEditResult } from "./construction-edit.js";
import { parseConstructionEditCommand } from "./construction-edit-policy.js";

const USAGE = "사용법: /건설수정 닉네임 [평수]\n예) /건설수정 🏆호이 남 5";
const NUMERIC_ERROR = "평수는 숫자로 입력해주세요.\n예) /건설수정 🏆호이 남 5";
const INVALID_FLOOR = "해당 평수의 집 정보가 없습니다.\n가능한 평수: 1 ~ 300";

// 관리자 권한과 레거시 입력 형식을 확인한 뒤 건설 수정을 repository에 위임합니다.
export class ConstructionEditService {
  constructor(private readonly repository: ConstructionEditRepository) {}

  async handle(input: ConstructionEditInput): Promise<ConstructionEditResult> {
    const operatorId = await this.repository.findAuthorizedOperator(input.externalUserId);
    if (operatorId === null) return { status: "ignored_forbidden" };
    const parsed = parseConstructionEditCommand(input.message);
    if (parsed.kind === "ignored") return { status: "ignored" };
    if (parsed.kind === "usage") return { status: "invalid_command", data: USAGE };
    if (parsed.kind === "numeric_error") return { status: "invalid_command", data: NUMERIC_ERROR };
    if (parsed.kind === "invalid_floor") return { status: "invalid_floor", data: INVALID_FLOOR };
    return this.repository.adjust({ ...input, ...parsed, operatorId });
  }
}
