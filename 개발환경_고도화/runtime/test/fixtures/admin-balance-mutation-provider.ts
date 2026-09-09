import type { DatabaseClient, DatabaseTransaction, DatabaseWriteResult } from "../../src/database.js";
import type { AdminBalanceDomain, AdminBalanceDomainProjection, AdminBalanceValueProjection } from "../../src/admin/admin-balance-read-model.js";
import type { AdminBalanceActivationInput, AdminBalanceMutationRepository } from "../../src/admin/admin-balance-mutation-provider.js";

const value = (input: Partial<AdminBalanceValueProjection> & Pick<AdminBalanceValueProjection, "domain" | "key" | "label" | "value" | "unit" | "step">): AdminBalanceValueProjection => ({
  group: input.key.replace(/\.[^.]+$/, ""), sumGroup: null, min: "0", max: null, version: "1", editable: true, source: `fixture:${input.domain}:1`, ...input,
});

const initialDomains = (): Record<AdminBalanceDomain, AdminBalanceDomainProjection> => ({
  home_badge: {
    domain: "home_badge", label: "홈뱃지 조건", version: "1", source: "fixture:home_badge:1",
    values: [value({ domain: "home_badge", key: "home_badge.F01.criteria.followers", label: "첫인연 팔로워", value: "1", unit: "명", step: "1", max: "9007199254740991" })],
  },
  home_furniture: {
    domain: "home_furniture", label: "가구 뽑기", version: "1", source: "fixture:home_furniture:1",
    values: [
      value({ domain: "home_furniture", key: "home_furniture.grade.1.probability", label: "루비 확률", value: "60", unit: "%", step: "0.001", max: "100", sumGroup: "home_furniture.grade.probability" }),
      value({ domain: "home_furniture", key: "home_furniture.grade.2.probability", label: "전설 확률", value: "40", unit: "%", step: "0.001", max: "100", sumGroup: "home_furniture.grade.probability" }),
      value({ domain: "home_furniture", key: "home_furniture.grade.1.entry_count", label: "루비 수", value: "10", unit: "개", step: "1", editable: false }),
    ],
  },
  pendant: {
    domain: "pendant", label: "펜던트 강화", version: "1", source: "fixture:pendant:1",
    values: [
      value({ domain: "pendant", key: "pendant.level.1.success_rate", label: "+1 성공 확률", value: "100", unit: "%", step: "0.0001", max: "100" }),
      value({ domain: "pendant", key: "pendant.level.1.explore_increment", label: "+1 탐험", value: "1", unit: "탐험", step: "0.001", max: "99999.999" }),
    ],
  },
});

const clone = <T>(input: T): T => structuredClone(input);

export interface FakeBalanceRepository extends AdminBalanceMutationRepository {
  snapshot(): Map<AdminBalanceDomain, Map<string, AdminBalanceDomainProjection>>;
  restore(snapshot: Map<AdminBalanceDomain, Map<string, AdminBalanceDomainProjection>>): void;
}

export function createFakeBalanceRepository(): FakeBalanceRepository {
  let history = new Map<AdminBalanceDomain, Map<string, AdminBalanceDomainProjection>>();
  for (const [domain, projection] of Object.entries(initialDomains()) as Array<[AdminBalanceDomain, AdminBalanceDomainProjection]>) {
    history.set(domain, new Map([["1", projection]]));
  }
  const current = (domain: AdminBalanceDomain): AdminBalanceDomainProjection => {
    const versions = history.get(domain)!;
    return [...versions.values()].sort((left, right) => Number(right.version) - Number(left.version))[0]!;
  };
  return {
    readCurrent: async (domain) => clone(current(domain)),
    readVersion: async (domain, version) => {
      const found = history.get(domain)!.get(version);
      return found === undefined ? undefined : clone(found);
    },
    activate: async (_transaction, input: AdminBalanceActivationInput) => {
      const versions = history.get(input.domain)!;
      const sourceVersion = input.mode === "rollback" ? input.targetVersion! : input.currentVersion;
      const source = clone(versions.get(sourceVersion)!);
      const nextVersion = (Math.max(...[...versions.keys()].map(Number)) + 1).toString();
      const replacements = new Map(input.changes.map((entry) => [entry.key, entry.value]));
      const values = source.values.map((entry) => ({
        ...entry,
        value: input.mode === "apply" ? replacements.get(entry.key) ?? entry.value : entry.value,
        version: nextVersion,
        source: `fixture:${input.domain}:${nextVersion}`,
      }));
      const next = { ...source, version: nextVersion, source: `fixture:${input.domain}:${nextVersion}`, values };
      versions.set(nextVersion, next);
      return clone(next);
    },
    snapshot: () => clone(history),
    restore: (snapshot) => { history = clone(snapshot); },
  };
}

export interface FakeBalanceDatabaseState {
  sql: string[];
  operations: Map<string, string | null>;
  auditFailure: boolean;
}

export function createFakeBalanceDatabase(repository: FakeBalanceRepository): { database: DatabaseClient; state: FakeBalanceDatabaseState } {
  const state: FakeBalanceDatabaseState = { sql: [], operations: new Map(), auditFailure: false };
  let nextId = 100n;
  let lastConfigId = 0n;
  const transaction: DatabaseTransaction = {
    query: async <T>(sql: string, values: readonly unknown[] = []): Promise<T> => {
      state.sql.push(sql);
      if (sql.startsWith("SELECT result_json FROM operations")) return (state.operations.has(`${values[0]}:${values[1]}`) ? [{ result_json: state.operations.get(`${values[0]}:${values[1]}`)! }] : []) as T;
      if (sql.startsWith("SELECT id FROM admin_operators")) return [{ id: 7n }] as T;
      if (sql.startsWith("SELECT id FROM configuration_sets")) return [{ id: lastConfigId }] as T;
      return [] as T;
    },
    execute: async (sql: string, values: readonly unknown[] = []): Promise<DatabaseWriteResult> => {
      state.sql.push(sql);
      if (sql.startsWith("INSERT INTO operations")) {
        state.operations.set(`${values[1]}:${values[2]}`, null);
        return { affectedRows: 1n, insertId: nextId++ };
      }
      if (sql.startsWith("INSERT INTO configuration_sets")) lastConfigId = nextId++;
      if (sql.startsWith("INSERT INTO command_audit") && state.auditFailure) throw new Error("synthetic audit failure");
      if (sql.startsWith("UPDATE operations SET")) {
        const operationId = BigInt(String(values[1]));
        const operationKey = [...state.operations.keys()].find((entry) => {
          const stored = state.operations.get(entry);
          return stored === null && operationId >= 100n;
        });
        if (operationKey !== undefined) state.operations.set(operationKey, String(values[0]));
      }
      return { affectedRows: 1n, insertId: nextId++ };
    },
  };
  const database: DatabaseClient = {
    ping: async () => undefined,
    verifyRollback: async () => true,
    query: transaction.query,
    execute: transaction.execute,
    withTransaction: async <T>(work: (value: DatabaseTransaction) => Promise<T>) => {
      const operationSnapshot = clone(state.operations);
      const repositorySnapshot = repository.snapshot();
      const idSnapshot = nextId;
      try { return await work(transaction); }
      catch (error) {
        state.operations = clone(operationSnapshot);
        repository.restore(repositorySnapshot);
        nextId = idSnapshot;
        throw error;
      }
    },
    close: async () => undefined,
  };
  return { database, state };
}
