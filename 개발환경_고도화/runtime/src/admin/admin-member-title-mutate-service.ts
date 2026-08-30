import { createHash, randomUUID } from "node:crypto";
import type { DatabaseClient, DatabaseTransaction } from "../database.js";
import { ApplicationError } from "../shared/application-error.js";
import { MariaPlayerTitleDefinitionLinkRepository } from "../player/maria-player-title-definition-link-repository.js";
import { PlayerTitleDefinitionLinkProvider } from "../player/player-title-definition-link.js";

type ParsedCommand =
  | { kind: "usage"; commandCode: string }
  | { kind: "add"; commandCode: "ADMIN_MEMBER_TITLE_ADD"; targetNames: string[]; titleName: string; priceRaw: string; priceJson: string }
  | { kind: "grant"; commandCode: "ADMIN_MEMBER_TITLE_GRANT"; targetNames: string[]; titleName: string; priceRaw: string; priceJson: string }
  | { kind: "remove"; commandCode: "ADMIN_MEMBER_TITLE_REMOVE"; targetNames: string[]; index: number };

interface OperatorRow { operator_id: bigint; external_identity_id: bigint; display_name: string; }
interface TargetRow { player_id: bigint; display_name: string; }
interface OwnedInstanceRow { id: bigint; title_id: bigint; snapshot_name: string; display_order: bigint; equipped: number; }

export interface AdminMemberTitleMutateResult {
  status: "usage" | "applied" | "not_found";
  commandCode: string;
  data: string;
  changedCount: number;
  missingTargets: string[];
  stableInstanceIds: string[];
  outboxId: string;
  replayed: boolean;
}

// 운영자 타이틀 변경은 안내용 정확 명령 또는 완전한 인자 형식만 후보로 인정합니다.
export function isAdminMemberTitleMutateCandidate(message: string | undefined): boolean {
  return message !== undefined && parseAdminMemberTitleMutateCommand(message) !== null;
}

// 세 운영 명령을 각 DB alias로 정규화합니다.
export function normalizeAdminMemberTitleMutateDispatchMessage(message: string): string {
  const parsed = parseAdminMemberTitleMutateCommand(message);
  if (parsed?.commandCode === "ADMIN_MEMBER_TITLE_ADD") return "/타이틀추가";
  if (parsed?.commandCode === "ADMIN_MEMBER_TITLE_GRANT") return "/타이틀지급";
  if (parsed?.commandCode === "ADMIN_MEMBER_TITLE_REMOVE") return "/타이틀제거";
  return message;
}

// 레거시 가격 JSON 타입과 대상 순서를 잃지 않도록 세 명령을 파싱합니다.
export function parseAdminMemberTitleMutateCommand(message: string): ParsedCommand | null {
  if (message === "/타이틀추가") return { kind: "usage", commandCode: "ADMIN_MEMBER_TITLE_ADD" };
  if (message === "/타이틀지급") return { kind: "usage", commandCode: "ADMIN_MEMBER_TITLE_GRANT" };
  if (message === "/타이틀제거") return { kind: "usage", commandCode: "ADMIN_MEMBER_TITLE_REMOVE" };
  const add = /^\/타이틀추가\s+(.+?),\s*(.+)\s+(\d{1,27})$/u.exec(message);
  if (add !== null) {
    const target = add[1]!.trim(), titleName = add[2]!.trim(), priceRaw = add[3]!;
    if (target.length === 0 || titleName.length === 0 || target.length > 191 || titleName.length > 191) return null;
    return { kind: "add", commandCode: "ADMIN_MEMBER_TITLE_ADD", targetNames: [target], titleName, priceRaw, priceJson: JSON.stringify(priceRaw) };
  }
  const grant = /^\/타이틀지급\s+(.+?)\/(.+)\/(\d{1,27})$/u.exec(message);
  if (grant !== null) {
    const targetNames = grant[1]!.split(",").map((value) => value.trim());
    const titleName = grant[2]!.trim(), priceRaw = grant[3]!;
    if (targetNames.some((value) => value.length === 0 || value.length > 191) || titleName.length === 0 || titleName.length > 191) return null;
    return { kind: "grant", commandCode: "ADMIN_MEMBER_TITLE_GRANT", targetNames, titleName, priceRaw, priceJson: BigInt(priceRaw).toString() };
  }
  const remove = /^\/타이틀제거\s+(.+)\s+([1-9]\d*)$/u.exec(message);
  if (remove !== null) {
    const target = remove[1]!.trim(), index = Number(remove[2]!);
    if (target.length === 0 || target.length > 191 || !Number.isSafeInteger(index)) return null;
    return { kind: "remove", commandCode: "ADMIN_MEMBER_TITLE_REMOVE", targetNames: [target], index };
  }
  return null;
}

// 관리자 권한·stable title instance·감사·응답을 한 transaction으로 변경합니다.
export class AdminMemberTitleMutateService {
  public constructor(
    private readonly database: DatabaseClient,
    private readonly titleDefinitions = new PlayerTitleDefinitionLinkProvider(new MariaPlayerTitleDefinitionLinkRepository()),
  ) {}

  public async handle(input: { eventId: string; externalUserId: string; destinationId: string; message: string }): Promise<AdminMemberTitleMutateResult | null> {
    const parsed = parseAdminMemberTitleMutateCommand(input.message);
    if (parsed === null) return null;
    return this.database.withTransaction(async (transaction) => {
      const operator = (await transaction.query<OperatorRow[]>(
        `SELECT operator.id operator_id,identity.id external_identity_id,COALESCE(identity.display_name,'운영자') display_name
           FROM external_identities identity
           JOIN admin_operator_external_identities mapping ON mapping.external_identity_id=identity.id
           JOIN admin_operators operator ON operator.id=mapping.operator_id AND operator.status='active'
           JOIN admin_operator_roles operator_role ON operator_role.operator_id=operator.id
           JOIN admin_role_permissions permission ON permission.role_id=operator_role.role_id AND permission.permission_code='player.title.change'
          WHERE identity.provider_code='kakao' AND identity.external_user_id=? AND identity.status='linked'
          ORDER BY operator.id LIMIT 2 FOR UPDATE`, [input.externalUserId]))[0];
      if (operator === undefined) return null;
      const scope = `admin.member_title.${parsed.kind}:${operator.operator_id}`;
      const key = input.eventId.length <= 191 ? input.eventId : `sha256:${createHash("sha256").update(input.eventId).digest("hex")}`;
      await transaction.execute("INSERT INTO operations(operation_key,idempotency_scope,idempotency_key,actor_type,actor_id,source_code,status,created_at) VALUES (?,?,?,'admin_operator',?,'iris','processing',UTC_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)", [randomUUID(), scope, key, operator.operator_id]);
      const operation = (await transaction.query<Array<{ id: bigint; result_json: string | AdminMemberTitleMutateResult | null }>>("SELECT id,result_json FROM operations WHERE idempotency_scope=? AND idempotency_key=? FOR UPDATE", [scope, key]))[0];
      if (operation === undefined) throw new Error("Admin member title operation claim failed.");
      if (operation.result_json !== null) return { ...(typeof operation.result_json === "string" ? JSON.parse(operation.result_json) : operation.result_json), replayed: true };
      if (parsed.kind === "usage") return complete(transaction, operation.id, input, operator, parsed.commandCode, "usage", usage(parsed.commandCode), [], [], []);

      const targetRows = await transaction.query<TargetRow[]>(`SELECT player.id player_id,profile.current_display_name display_name FROM players player JOIN player_profiles profile ON profile.player_id=player.id WHERE player.status='active' AND player.deleted_at IS NULL AND BINARY profile.current_display_name IN (${parsed.targetNames.map(() => "?").join(",")}) ORDER BY player.id FOR UPDATE`, parsed.targetNames);
      const byName = new Map(targetRows.map((target) => [target.display_name, target]));
      const missing = parsed.targetNames.filter((name) => !byName.has(name));
      const instanceIds: string[] = [];
      if (parsed.kind === "remove") {
        const target = byName.get(parsed.targetNames[0]!);
        if (target !== undefined) {
          const instances = await transaction.query<OwnedInstanceRow[]>("SELECT instance_row.id,instance_row.title_id,COALESCE(instance_row.snapshot_name,definition.display_name) snapshot_name,instance_row.display_order,instance_row.equipped FROM player_title_instances instance_row JOIN title_definitions definition ON definition.id=instance_row.title_id WHERE instance_row.player_id=? AND instance_row.status='owned' ORDER BY instance_row.display_order,instance_row.id FOR UPDATE", [target.player_id]);
          const selected = instances[parsed.index - 1];
          if (selected !== undefined) {
            const archivedOrder = (await transaction.query<Array<{ next_order: bigint }>>("SELECT COALESCE(MAX(display_order),0)+1 next_order FROM player_title_instances WHERE player_id=? FOR UPDATE", [target.player_id]))[0]?.next_order ?? 1n;
            await transaction.execute("UPDATE player_title_instances SET status='removed',equipped=FALSE,display_order=?,version=version+1 WHERE id=? AND status='owned'", [archivedOrder, selected.id]);
            if (selected.equipped) await transaction.execute("UPDATE player_titles SET equipped=FALSE WHERE player_id=?", [target.player_id]);
            const same = (await transaction.query<Array<{ count_value: bigint }>>("SELECT COUNT(*) count_value FROM player_title_instances WHERE player_id=? AND title_id=? AND status='owned'", [target.player_id, selected.title_id]))[0]?.count_value ?? 0n;
            if (same === 0n) await transaction.execute("DELETE FROM player_titles WHERE player_id=? AND title_id=?", [target.player_id, selected.title_id]);
            const remaining = await transaction.query<Array<{ id: bigint }>>("SELECT id FROM player_title_instances WHERE player_id=? AND status='owned' ORDER BY display_order,id FOR UPDATE", [target.player_id]);
            for (let index = 0; index < remaining.length; index += 1) await transaction.execute("UPDATE player_title_instances SET display_order=? WHERE id=?", [index + 1, remaining[index]!.id]);
            instanceIds.push(selected.id.toString());
          }
        }
      } else {
        const definition = await this.titleDefinitions.ensureAdminCustom(transaction, parsed.titleName);
        let sequence = 0;
        for (const targetName of parsed.targetNames) {
          const target = byName.get(targetName); if (target === undefined) continue;
          const maxOrder = (await transaction.query<Array<{ max_order: bigint | null }>>("SELECT MAX(display_order) max_order FROM player_title_instances WHERE player_id=? AND status='owned' FOR UPDATE", [target.player_id]))[0]?.max_order ?? 0n;
          sequence += 1;
          const inserted = await transaction.execute("INSERT INTO player_title_instances(instance_key,player_id,title_id,title_catalog_entry_id,snapshot_name,source_operation_id,source_sequence_no,price_value,legacy_price_json,display_order,status,equipped,acquired_at,version) VALUES (UUID(),?,?,?,?,?,?,?,?,?,'owned',FALSE,UTC_TIMESTAMP(3),1)", [target.player_id, definition.titleId, definition.catalogEntryId, parsed.titleName, operation.id, sequence, parsed.priceRaw, parsed.priceJson, maxOrder + 1n]);
          await transaction.execute("INSERT IGNORE INTO player_titles(player_id,title_id,acquired_at,equipped,display_order,acquisition_price) VALUES (?,?,UTC_TIMESTAMP(3),FALSE,?,?)", [target.player_id, definition.titleId, maxOrder + 1n, parsed.priceRaw]);
          instanceIds.push(inserted.insertId.toString());
        }
      }
      const changed = instanceIds.length;
      const status = changed > 0 ? "applied" : "not_found";
      const data = resultText(parsed, changed, missing);
      return complete(transaction, operation.id, input, operator, parsed.commandCode, status, data, targetRows, missing, instanceIds);
    });
  }
}

async function complete(transaction: DatabaseTransaction, operationId: bigint, input: { eventId: string; destinationId: string }, operator: OperatorRow, commandCode: string, status: AdminMemberTitleMutateResult["status"], data: string, targets: TargetRow[], missing: string[], instanceIds: string[]): Promise<AdminMemberTitleMutateResult> {
  const outbox = await transaction.execute("INSERT INTO outbox_messages(operation_id,provider_code,destination_id,message_type,payload_json,status,available_at,created_at) VALUES (?,'iris',?,'text',?,'pending',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [operationId, input.destinationId, JSON.stringify({ data })]);
  await transaction.execute("INSERT INTO command_executions(event_id,command_code,operation_id,execution_status,result_code,created_at,completed_at) VALUES (?,?,?,'completed',?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [input.eventId, commandCode, operationId, status]);
  await transaction.execute("INSERT INTO command_audit(operation_id,actor_type,actor_id,target_type,target_id,action_code,result_code,reason,change_summary_json,created_at) VALUES (?,'admin_operator',?,'player',NULL,'admin.member_title.mutate',?,'Iris 운영자 타이틀 변경',?,UTC_TIMESTAMP(3))", [operationId, operator.operator_id, status, JSON.stringify({ targetPlayerIds: targets.map((target) => target.player_id.toString()), missingTargets: missing, stableInstanceIds: instanceIds })]);
  const result: AdminMemberTitleMutateResult = { status, commandCode, data, changedCount: instanceIds.length, missingTargets: missing, stableInstanceIds: instanceIds, outboxId: outbox.insertId.toString(), replayed: false };
  await transaction.execute("UPDATE operations SET status='completed',result_json=?,completed_at=UTC_TIMESTAMP(3) WHERE id=?", [JSON.stringify(result), operationId]);
  return result;
}

function usage(code: string): string { if (code === "ADMIN_MEMBER_TITLE_ADD") return "사용법: /타이틀추가 [대상], [제목] [가격]"; if (code === "ADMIN_MEMBER_TITLE_GRANT") return "사용법: /타이틀지급 [대상,대상]/[제목]/[가격]"; return "사용법: /타이틀제거 [대상] [번호]"; }
function resultText(parsed: Exclude<ParsedCommand,{kind:"usage"}>, changed: number, missing: string[]): string { const action = parsed.kind === "remove" ? "제거" : "지급"; const lines=[`타이틀 ${action} 완료: ${changed}건`]; if (missing.length>0) lines.push(`대상 없음: ${missing.join(", ")}`); return lines.join("\n"); }
