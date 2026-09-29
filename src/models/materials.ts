import type {
  BoundMaterial,
  ConclusionVersion,
  EdgeKind,
  Evidence,
  InvestigationEdge,
  MaterialDiff,
  MaterialDrift,
} from "./types";

export const edgeKindLabels: Record<EdgeKind, string> = {
  transfer: "转账关系",
  shared_device: "共用设备",
  shared_ip: "共用 IP",
  payee: "收款关系",
};

const sameMaterial = (a: BoundMaterial, b: BoundMaterial): boolean =>
  a.kind === b.kind && a.refId === b.refId;

/** 比较两版材料清单，base 为旧版、next 为新版。 */
export const diffBoundMaterials = (
  base: BoundMaterial[],
  next: BoundMaterial[],
): MaterialDiff => ({
  added: next.filter((item) => !base.some((other) => sameMaterial(other, item))),
  removed: base.filter(
    (item) => !next.some((other) => sameMaterial(other, item)),
  ),
});

export const evidenceToMaterial = (evidence: Evidence): BoundMaterial => ({
  kind: "evidence",
  refId: evidence.id,
  label: evidence.title,
  detail: `来源：${evidence.source}`,
});

export const edgeToMaterial = (edge: InvestigationEdge): BoundMaterial => ({
  kind: "relation",
  refId: edge.id,
  label: edge.label,
  detail: edgeKindLabels[edge.kind],
});

/** 结论提交时固化的材料清单：当前全部证据与关系。 */
export const buildBoundMaterials = (
  evidence: Evidence[],
  edges: InvestigationEdge[],
): BoundMaterial[] => [
  ...evidence.map(evidenceToMaterial),
  ...edges.map(edgeToMaterial),
];

/**
 * 计算已提交结论相对当前案件材料的漂移。
 * 只有 submitted 版本参与；已通过 / 已退回的历史版本保留原快照，不再重算。
 */
export const getConclusionDrift = (
  conclusion: ConclusionVersion,
  evidence: Evidence[],
  edges: InvestigationEdge[],
): MaterialDrift | undefined => {
  if (conclusion.status !== "submitted" || conclusion.materials.length === 0) {
    return undefined;
  }
  const diff = diffBoundMaterials(
    conclusion.materials,
    buildBoundMaterials(evidence, edges),
  );
  return {
    ...diff,
    changed: diff.added.length > 0 || diff.removed.length > 0,
  };
};

/** 新版本相对于上一版（按版本号相邻且带快照的旧版）多出或缺少的材料。 */
export const getDiffFromPrevious = (
  conclusion: ConclusionVersion,
  previous?: ConclusionVersion,
): MaterialDiff | undefined => {
  if (
    conclusion.materials.length === 0 ||
    !previous ||
    previous.materials.length === 0
  ) {
    return undefined;
  }
  const diff = diffBoundMaterials(previous.materials, conclusion.materials);
  return diff.added.length > 0 || diff.removed.length > 0 ? diff : undefined;
};

export const countMaterials = (materials: BoundMaterial[]) => ({
  evidenceCount: materials.filter((item) => item.kind === "evidence").length,
  relationCount: materials.filter((item) => item.kind === "relation").length,
});
