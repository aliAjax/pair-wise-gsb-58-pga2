import type {
  Evidence,
  InvestigationEdge,
  InvestigationNode,
  MaterialChangeEntry,
  MaterialSnapshot,
  SnapshotItem,
  SnapshotMaterialKind,
} from "../models/types";

export const snapshotKindLabels: Record<SnapshotMaterialKind, string> = {
  evidence: "证据",
  node: "关系节点",
  edge: "关系线索",
};

const describeEvidence = (item: Evidence): string =>
  `${item.source} · ${item.strength === "strong" ? "强" : item.strength === "medium" ? "中" : "弱"}证据`;

const kindLabels: Record<string, string> = {
  account: "账户",
  device: "设备",
  ip: "IP",
  merchant: "商户",
};

const describeNode = (item: InvestigationNode): string =>
  `${item.data.source} · ${kindLabels[item.data.kind] ?? item.data.kind}`;

const describeEdge = (item: InvestigationEdge): string =>
  `${item.label} · ${item.occurredAt.slice(0, 10)}`;

/** 生成某案件当前全部材料（证据、图谱节点、关系线索）的快照 */
export const buildMaterialSnapshot = (
  evidence: Evidence[],
  nodes: InvestigationNode[],
  edges: InvestigationEdge[],
): MaterialSnapshot => {
  const items: SnapshotItem[] = [
    ...evidence.map((item) => ({
      id: item.id,
      kind: "evidence" as const,
      label: item.title,
      detail: describeEvidence(item),
    })),
    ...nodes.map((item) => ({
      id: item.id,
      kind: "node" as const,
      label: item.data.label,
      detail: describeNode(item),
    })),
    ...edges.map((item) => ({
      id: item.id,
      kind: "edge" as const,
      label: item.label,
      detail: describeEdge(item),
    })),
  ];
  return {
    evidenceIds: evidence.map((item) => item.id),
    nodeIds: nodes.map((item) => item.id),
    edgeIds: edges.map((item) => item.id),
    items,
  };
};

const snapshotKey = (kind: SnapshotMaterialKind, id: string): string =>
  `${kind}:${id}`;

/** 相对上一版快照，当前快照中多出的材料（仅新增，不包含删除） */
export const diffAddedMaterials = (
  snapshot: MaterialSnapshot,
  base?: MaterialSnapshot,
): SnapshotItem[] => {
  if (!base) {
    return snapshot.items;
  }
  const baseKeys = new Set(
    base.items.map((item) => snapshotKey(item.kind, item.id)),
  );
  return snapshot.items.filter(
    (item) => !baseKeys.has(snapshotKey(item.kind, item.id)),
  );
};

/** 计算当前材料相对提交时快照的全部变化（新增与删除），调用方负责记录时间 */
export const diffMaterialChanges = (
  snapshot: MaterialSnapshot,
  evidence: Evidence[],
  nodes: InvestigationNode[],
  edges: InvestigationEdge[],
  at: string,
): MaterialChangeEntry[] => {
  const current = buildMaterialSnapshot(evidence, nodes, edges);
  const oldKeys = new Set(
    snapshot.items.map((item) => snapshotKey(item.kind, item.id)),
  );
  const currentKeys = new Set(
    current.items.map((item) => snapshotKey(item.kind, item.id)),
  );
  const added = current.items
    .filter((item) => !oldKeys.has(snapshotKey(item.kind, item.id)))
    .map((item) => ({ ...item, change: "added" as const, at }));
  const removed = snapshot.items
    .filter((item) => !currentKeys.has(snapshotKey(item.kind, item.id)))
    .map((item) => ({ ...item, change: "removed" as const, at }));
  return [...added, ...removed];
};
