import {
  seedAlerts,
  seedAuditLogs,
  seedCases,
  seedConclusions,
  seedEdges,
  seedEvidence,
  seedNodes,
} from "../data/seed";
import type {
  Alert,
  AuditLog,
  ConclusionVersion,
  Evidence,
  InvestigationCase,
  InvestigationEdge,
  InvestigationNode,
} from "../models/types";
import { buildMaterialSnapshot } from "./materialSnapshot";

export interface MockDatabase {
  alerts: Alert[];
  cases: InvestigationCase[];
  nodes: InvestigationNode[];
  edges: InvestigationEdge[];
  evidence: Evidence[];
  conclusions: ConclusionVersion[];
  auditLogs: AuditLog[];
}

const STORAGE_KEY = "bank-fraud-investigation-db-v1";

const createSeedDatabase = (): MockDatabase => ({
  alerts: structuredClone(seedAlerts),
  cases: structuredClone(seedCases),
  nodes: structuredClone(seedNodes),
  edges: structuredClone(seedEdges),
  evidence: structuredClone(seedEvidence),
  conclusions: structuredClone(seedConclusions),
  auditLogs: structuredClone(seedAuditLogs),
});

/**
 * 为历史结论补建材料快照：旧版本本地数据没有快照字段，
 * 用该案件当前材料回填，保证结论卡片能正常渲染绑定材料。
 */
const migrateDatabase = (database: MockDatabase): MockDatabase => {
  let changed = false;
  database.conclusions = database.conclusions.map((conclusion) => {
    if (conclusion.materialSnapshot) {
      return conclusion;
    }
    changed = true;
    const evidence = database.evidence.filter(
      (item) => item.caseId === conclusion.caseId,
    );
    const nodes = database.nodes.filter(
      (item) => item.caseId === conclusion.caseId,
    );
    const edges = database.edges.filter(
      (item) => item.caseId === conclusion.caseId,
    );
    return {
      ...conclusion,
      materialSnapshot: buildMaterialSnapshot(evidence, nodes, edges),
    };
  });
  if (changed) {
    writeDatabase(database);
  }
  return database;
};

export const readDatabase = (): MockDatabase => {
  if (typeof window === "undefined") {
    return createSeedDatabase();
  }

  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }

  try {
    return migrateDatabase(JSON.parse(stored) as MockDatabase);
  } catch {
    const seeded = createSeedDatabase();
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
    return seeded;
  }
};

export const writeDatabase = (database: MockDatabase): void => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
  }
};

export const resetDatabase = (): MockDatabase => {
  const seeded = createSeedDatabase();
  writeDatabase(seeded);
  return seeded;
};

export const createId = (prefix: string): string =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export const nowIso = (): string => new Date().toISOString();

export const appendAudit = (
  database: MockDatabase,
  log: Omit<AuditLog, "id" | "at">,
): void => {
  database.auditLogs.unshift({
    id: createId("LOG"),
    at: nowIso(),
    ...log,
  });
};
