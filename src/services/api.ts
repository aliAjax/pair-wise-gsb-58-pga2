import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type {
  Alert,
  AlertFilters,
  AuditLog,
  CaseDisposition,
  CaseStatus,
  ConclusionVersion,
  DashboardSummary,
  Evidence,
  InvestigationCase,
  InvestigationNode,
  RiskLevel,
} from "../models/types";
import {
  buildBoundMaterials,
  diffBoundMaterials,
  getConclusionDrift,
  getDiffFromPrevious,
} from "../models/materials";
import {
  appendAudit,
  createId,
  nowIso,
  readDatabase,
  resetDatabase,
  writeDatabase,
} from "./mockStorage";

const wait = (milliseconds = 260) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

/** 找到案件当前仍处于待复核的结论（已通过 / 退回的版本不参与）。 */
const findActiveSubmitted = (
  database: ReturnType<typeof readDatabase>,
  caseId: string,
): ConclusionVersion | undefined =>
  database.conclusions
    .filter((item) => item.caseId === caseId && item.status === "submitted")
    .sort((a, b) => b.version - a.version)[0];

/**
 * 案件材料发生增减后，检查待复核结论是否漂移：
 * 漂移则让案件回到待补证，并在结论上标记材料已经变化。
 */
const reconcileActiveSubmission = (
  database: ReturnType<typeof readDatabase>,
  caseId: string,
  changeSummary: string,
): boolean => {
  const active = findActiveSubmitted(database, caseId);
  if (!active) {
    return false;
  }
  const current = buildBoundMaterials(
    database.evidence.filter((item) => item.caseId === caseId),
    database.edges.filter((item) => item.caseId === caseId),
  );
  const diff = diffBoundMaterials(active.materials, current);
  if (diff.added.length === 0 && diff.removed.length === 0) {
    return false;
  }
  if (!active.materialsChangedAt) {
    active.materialsChangedAt = nowIso();
  }
  const targetCase = database.cases.find((item) => item.id === caseId);
  if (targetCase && targetCase.status !== "supplement") {
    targetCase.status = "supplement";
    targetCase.updatedAt = nowIso();
  }
  const addedNames = diff.added.map((item) => item.label).join("、");
  const removedNames = diff.removed.map((item) => item.label).join("、");
  appendAudit(database, {
    caseId,
    actor: "系统",
    action: "复核材料变化",
    detail:
      `待复核结论 V${active.version} 的绑定材料在提交后发生变化` +
      `（${changeSummary}），案件退回待补证。` +
      `${addedNames ? `新增：${addedNames}。` : ""}` +
      `${removedNames ? `减少：${removedNames}。` : ""}` +
      `复核人需退回或由调查员重新提交后再通过。`,
  });
  return true;
};

export interface AddNodeInput {
  caseId: string;
  node: InvestigationNode;
  relation?: {
    sourceId: string;
    kind: "transfer" | "shared_device" | "shared_ip" | "payee";
    label: string;
    explanation: string;
    amount?: number;
  };
}

export const bankApi = createApi({
  reducerPath: "bankApi",
  baseQuery: fakeBaseQuery(),
  tagTypes: ["Alerts", "Cases", "Case", "Audit", "Dashboard"],
  endpoints: (builder) => ({
    getDashboard: builder.query<DashboardSummary, void>({
      queryFn: async () => {
        await wait();
        const database = readDatabase();
        const activeCases = database.cases.filter(
          (item) => item.status !== "closed",
        );
        const caseStatusCounts: DashboardSummary["caseStatusCounts"] = {
          investigating: 0,
          pending_review: 0,
          supplement: 0,
          closed: 0,
        };
        const riskCounts: DashboardSummary["riskCounts"] = {
          high: 0,
          medium: 0,
          low: 0,
        };

        database.cases.forEach((item) => {
          caseStatusCounts[item.status] += 1;
          riskCounts[item.riskLevel] += 1;
        });

        return {
          data: {
            newAlerts: database.alerts.filter((item) => item.status === "new")
              .length,
            highRiskAlerts: database.alerts.filter(
              (item) => item.riskLevel === "high",
            ).length,
            activeCases: activeCases.length,
            pendingReview: database.cases.filter((item) =>
              ["pending_review", "supplement"].includes(item.status),
            ).length,
            totalExposure: database.alerts.reduce(
              (sum, item) => sum + item.amount,
              0,
            ),
            caseStatusCounts,
            riskCounts,
          },
        };
      },
      providesTags: ["Dashboard"],
    }),
    getAlerts: builder.query<Alert[], AlertFilters>({
      queryFn: async (filters) => {
        await wait();
        const database = readDatabase();
        const keyword = filters.keyword.trim().toLowerCase();
        const items = database.alerts.filter((item) => {
          const matchesKeyword =
            !keyword ||
            [
              item.id,
              item.title,
              item.account,
              item.counterparty,
              item.deviceId,
              item.ip,
              ...item.tags,
            ]
              .join(" ")
              .toLowerCase()
              .includes(keyword);
          const matchesRisk =
            filters.riskLevel === "all" ||
            item.riskLevel === filters.riskLevel;
          const matchesStatus =
            filters.status === "all" || item.status === filters.status;
          const matchesChannel =
            !filters.channel || item.channel === filters.channel;
          return (
            matchesKeyword && matchesRisk && matchesStatus && matchesChannel
          );
        });
        return { data: items };
      },
      providesTags: ["Alerts"],
    }),
    getCases: builder.query<InvestigationCase[], void>({
      queryFn: async () => {
        await wait();
        return { data: readDatabase().cases };
      },
      providesTags: ["Cases"],
    }),
    getCaseWorkspace: builder.query<
      {
        case: InvestigationCase;
        nodes: InvestigationNode[];
        edges: ReturnType<typeof readDatabase>["edges"];
        evidence: Evidence[];
        conclusions: ConclusionVersion[];
      },
      string
    >({
      queryFn: async (caseId) => {
        await wait();
        const database = readDatabase();
        const investigationCase = database.cases.find(
          (item) => item.id === caseId,
        );
        if (!investigationCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        const caseEvidence = database.evidence.filter(
          (item) => item.caseId === caseId,
        );
        const caseEdges = database.edges.filter(
          (item) => item.caseId === caseId,
        );
        const conclusions = database.conclusions
          .filter((item) => item.caseId === caseId)
          .sort((a, b) => b.version - a.version);
        // 历史已通过 / 已退回版本保留提交快照，不附加漂移信息。
        const conclusionsWithDrift = conclusions.map((conclusion, index) => {
          const previous = conclusions[index + 1];
          return {
            ...conclusion,
            drift: getConclusionDrift(conclusion, caseEvidence, caseEdges),
            diffFromPrevious: getDiffFromPrevious(conclusion, previous),
          };
        });
        return {
          data: {
            case: investigationCase,
            nodes: database.nodes.filter((item) => item.caseId === caseId),
            edges: caseEdges,
            evidence: caseEvidence,
            conclusions: conclusionsWithDrift,
          },
        };
      },
      providesTags: (_result, _error, caseId) => [
        { type: "Case", id: caseId },
        "Dashboard",
      ],
    }),
    getAuditLogs: builder.query<AuditLog[], void>({
      queryFn: async () => {
        await wait();
        return { data: readDatabase().auditLogs };
      },
      providesTags: ["Audit"],
    }),
    linkAlertsToCase: builder.mutation<
      Alert[],
      { alertIds: string[]; caseId: string }
    >({
      queryFn: async ({ alertIds, caseId }) => {
        await wait();
        const database = readDatabase();
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (!targetCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        const updated = database.alerts.map((item) =>
          alertIds.includes(item.id)
            ? { ...item, caseId, status: "linked" as const }
            : item,
        );
        const selected = updated.filter((item) => alertIds.includes(item.id));
        targetCase.alertIds = Array.from(
          new Set([...targetCase.alertIds, ...alertIds]),
        );
        targetCase.updatedAt = nowIso();
        database.alerts = updated;
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "批量关联告警",
          detail: `关联告警 ${alertIds.join("、")}。`,
        });
        writeDatabase(database);
        return { data: selected };
      },
      invalidatesTags: ["Alerts", "Cases", "Audit", "Dashboard"],
    }),
    updateAlertStatus: builder.mutation<
      Alert,
      { alertId: string; status: Alert["status"] }
    >({
      queryFn: async ({ alertId, status }) => {
        await wait();
        const database = readDatabase();
        const alert = database.alerts.find((item) => item.id === alertId);
        if (!alert) {
          return { error: { status: "CUSTOM_ERROR", error: "告警不存在" } };
        }
        alert.status = status;
        appendAudit(database, {
          caseId: alert.caseId,
          actor: "林澜",
          action: "更新告警状态",
          detail: `${alert.id} 状态更新为 ${status}。`,
        });
        writeDatabase(database);
        return { data: alert };
      },
      invalidatesTags: ["Alerts", "Case", "Audit", "Dashboard"],
    }),
    addGraphNode: builder.mutation<
      { node: InvestigationNode; materialsChanged: boolean },
      AddNodeInput
    >({
      queryFn: async ({ caseId, node, relation }) => {
        await wait();
        const database = readDatabase();
        if (!database.cases.some((item) => item.id === caseId)) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        database.nodes.push(node);
        if (relation) {
          database.edges.push({
            id: createId("E"),
            caseId,
            source: relation.sourceId,
            target: node.id,
            kind: relation.kind,
            label: relation.label,
            amount: relation.amount,
            occurredAt: node.data.occurredAt,
            explanation: relation.explanation,
          });
        }
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (targetCase) {
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "加入图谱节点",
          detail: `${node.data.label} 已加入，证据强度 ${node.data.evidenceStrength}。`,
        });
        let materialsChanged = false;
        if (relation) {
          materialsChanged = reconcileActiveSubmission(
            database,
            caseId,
            `新增关系：${relation.label}`,
          );
        }
        writeDatabase(database);
        return { data: { node, materialsChanged } };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Dashboard",
      ],
    }),
    updateGraphNode: builder.mutation<
      InvestigationNode,
      { caseId: string; node: InvestigationNode }
    >({
      queryFn: async ({ caseId, node }) => {
        await wait(80);
        const database = readDatabase();
        const index = database.nodes.findIndex((item) => item.id === node.id);
        if (index < 0) {
          return { error: { status: "CUSTOM_ERROR", error: "节点不存在" } };
        }
        database.nodes[index] = { ...database.nodes[index], ...node };
        writeDatabase(database);
        return { data: database.nodes[index] };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
      ],
    }),
    addEvidence: builder.mutation<
      { evidence: Evidence; materialsChanged: boolean },
      Omit<Evidence, "id" | "submittedAt" | "submittedBy" | "version">
    >({
      queryFn: async (input) => {
        await wait();
        const database = readDatabase();
        const evidence: Evidence = {
          ...input,
          id: createId("EV"),
          submittedAt: nowIso(),
          submittedBy: "林澜",
          version: 1,
        };
        database.evidence.unshift(evidence);
        const targetCase = database.cases.find(
          (item) => item.id === input.caseId,
        );
        if (targetCase) {
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId: input.caseId,
          actor: "林澜",
          action: "新增证据",
          detail: `${input.title} 已登记，来源为 ${input.source}。`,
        });
        const materialsChanged = reconcileActiveSubmission(
          database,
          input.caseId,
          `新增证据：${input.title}`,
        );
        writeDatabase(database);
        return { data: { evidence, materialsChanged } };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Dashboard",
      ],
    }),
    saveConclusion: builder.mutation<
      ConclusionVersion,
      {
        caseId: string;
        disposition: CaseDisposition;
        rationale: string;
        riskControls: string[];
        submit?: boolean;
      }
    >({
      queryFn: async (input) => {
        await wait();
        const database = readDatabase();
        const caseEvidence = database.evidence.filter(
          (item) => item.caseId === input.caseId,
        );
        const caseEdges = database.edges.filter(
          (item) => item.caseId === input.caseId,
        );
        const active = findActiveSubmitted(database, input.caseId);
        if (input.submit) {
          if (active) {
            const current = buildBoundMaterials(caseEvidence, caseEdges);
            const diff = diffBoundMaterials(active.materials, current);
            const changed = diff.added.length > 0 || diff.removed.length > 0;
            return {
              error: {
                status: "CUSTOM_ERROR",
                error: changed
                  ? `V${active.version} 提交后材料已变化且案件处于待补证，请复核人退回该版本后，再基于当前材料提交新版本。`
                  : `V${active.version} 正在复核中，不能重复提交；如需更新，请由复核人退回后再提交新版本。`,
              },
            };
          }
        }
        const existing = database.conclusions.filter(
          (item) => item.caseId === input.caseId,
        );
        const conclusion: ConclusionVersion = {
          id: createId("CV"),
          caseId: input.caseId,
          version:
            existing.reduce((max, item) => Math.max(max, item.version), 0) + 1,
          status: input.submit ? "submitted" : "draft",
          disposition: input.disposition,
          rationale: input.rationale,
          riskControls: input.riskControls,
          createdBy: "林澜",
          createdAt: nowIso(),
          reviewer: "赵平",
          // 草稿不绑定材料；提交时刻固化当前证据与关系快照。
          materials: input.submit
            ? buildBoundMaterials(caseEvidence, caseEdges)
            : [],
        };
        database.conclusions.unshift(conclusion);
        const targetCase = database.cases.find(
          (item) => item.id === input.caseId,
        );
        if (targetCase) {
          if (input.submit) {
            targetCase.status = "pending_review";
          } else if (!active) {
            // 已有待复核（含材料变化待补证）版本时，保存草稿不得改变案件状态。
            targetCase.status = "investigating";
          }
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId: input.caseId,
          actor: "林澜",
          action: "保存结论版本",
          detail:
            `${conclusion.id} V${conclusion.version} 已${input.submit ? "提交复核" : "保存为草稿"}。` +
            (input.submit
              ? `提交时绑定证据 ${conclusion.materials.filter((item) => item.kind === "evidence").length} 份、关系 ${conclusion.materials.filter((item) => item.kind === "relation").length} 条，后续材料增减以该快照为准。`
              : ""),
        });
        writeDatabase(database);
        return { data: conclusion };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Audit",
        "Cases",
        "Dashboard",
      ],
    }),
    transitionCase: builder.mutation<
      InvestigationCase,
      { caseId: string; status: CaseStatus; reason?: string }
    >({
      queryFn: async ({ caseId, status, reason }) => {
        await wait();
        const database = readDatabase();
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (!targetCase) {
          return { error: { status: "CUSTOM_ERROR", error: "案件不存在" } };
        }
        if (status === "pending_review") {
          const active = findActiveSubmitted(database, caseId);
          if (!active) {
            return {
              error: {
                status: "CUSTOM_ERROR",
                error: "请先提交一份结论版本，再进入复核。",
              },
            };
          }
          const current = buildBoundMaterials(
            database.evidence.filter((item) => item.caseId === caseId),
            database.edges.filter((item) => item.caseId === caseId),
          );
          const diff = diffBoundMaterials(active.materials, current);
          if (diff.added.length > 0 || diff.removed.length > 0) {
            return {
              error: {
                status: "CUSTOM_ERROR",
                error: `V${active.version} 提交后材料已变化，案件需保持待补证；请退回该版本并由调查员重新提交。`,
              },
            };
          }
        }
        targetCase.status = status;
        targetCase.updatedAt = nowIso();
        appendAudit(database, {
          caseId,
          actor: "林澜",
          action: "案件状态流转",
          detail: `状态更新为 ${status}${reason ? `，原因：${reason}` : ""}。`,
        });
        writeDatabase(database);
        return { data: targetCase };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Cases",
        "Audit",
        "Dashboard",
      ],
    }),
    reviewConclusion: builder.mutation<
      ConclusionVersion,
      {
        caseId: string;
        conclusionId: string;
        decision: "approve" | "return";
        reviewerNote: string;
      }
    >({
      queryFn: async ({ caseId, conclusionId, decision, reviewerNote }) => {
        await wait();
        const database = readDatabase();
        const conclusion = database.conclusions.find(
          (item) => item.id === conclusionId,
        );
        if (!conclusion) {
          return { error: { status: "CUSTOM_ERROR", error: "结论不存在" } };
        }
        if (conclusion.status !== "submitted") {
          return {
            error: {
              status: "CUSTOM_ERROR",
              error: "只有已提交复核的版本可以复核；草稿请先提交。",
            },
          };
        }
        // 通过前再次比对提交快照与当前材料，防止复核期间材料被补进。
        const currentMaterials = buildBoundMaterials(
          database.evidence.filter((item) => item.caseId === caseId),
          database.edges.filter((item) => item.caseId === caseId),
        );
        const drift = diffBoundMaterials(conclusion.materials, currentMaterials);
        const materialsChanged =
          drift.added.length > 0 || drift.removed.length > 0;
        if (decision === "approve" && materialsChanged) {
          return {
            error: {
              status: "CUSTOM_ERROR",
              error: `V${conclusion.version} 提交后材料已变化，不能通过；请退回该版本，由调查员基于当前材料重新提交。`,
            },
          };
        }
        conclusion.status = decision === "approve" ? "approved" : "returned";
        conclusion.reviewerNote = reviewerNote;
        const targetCase = database.cases.find((item) => item.id === caseId);
        if (targetCase) {
          // 材料已变化时退回保持待补证；材料一致的退回也进入待补证流程。
          targetCase.status =
            decision === "approve" ? "closed" : "supplement";
          targetCase.updatedAt = nowIso();
        }
        appendAudit(database, {
          caseId,
          actor: "赵平",
          action: decision === "approve" ? "复核通过" : "退回补证",
          detail:
            decision === "approve"
              ? `${conclusion.id} V${conclusion.version} 已通过，结论按提交时绑定的 ${conclusion.materials.length} 项材料快照生效。${reviewerNote}`
              : `${conclusion.id} V${conclusion.version} 已退回${materialsChanged ? "（提交后材料发生变化）" : ""}，案件进入待补证。${reviewerNote}`,
        });
        writeDatabase(database);
        return { data: conclusion };
      },
      invalidatesTags: (_result, _error, input) => [
        { type: "Case", id: input.caseId },
        "Cases",
        "Audit",
        "Dashboard",
      ],
    }),
    resetMockData: builder.mutation<{ ok: boolean }, void>({
      queryFn: async () => {
        await wait(180);
        resetDatabase();
        return { data: { ok: true } };
      },
      invalidatesTags: ["Alerts", "Cases", "Case", "Audit", "Dashboard"],
    }),
  }),
});

export const {
  useAddEvidenceMutation,
  useAddGraphNodeMutation,
  useGetAlertsQuery,
  useGetAuditLogsQuery,
  useGetCaseWorkspaceQuery,
  useGetCasesQuery,
  useGetDashboardQuery,
  useLinkAlertsToCaseMutation,
  useResetMockDataMutation,
  useReviewConclusionMutation,
  useSaveConclusionMutation,
  useTransitionCaseMutation,
  useUpdateAlertStatusMutation,
  useUpdateGraphNodeMutation,
} = bankApi;

export type { RiskLevel };
