import {
  Alert,
  Badge,
  Button,
  Divider,
  Grid,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  ArrowLeft,
  AlertTriangle,
  Check,
  FileCheck2,
  FilePlus2,
  FileText,
  GitBranchPlus,
  GitCompareArrows,
  RotateCcw,
  Send,
  Share2,
} from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../app/hooks";
import {
  CaseStatusBadge,
  ConclusionStatusBadge,
  EvidenceStrengthBadge,
  RiskBadge,
} from "../components/Badges";
import {
  focusEvidence,
  focusTimeline,
  selectNode,
} from "../features/alerts/alertsSlice";
import { InvestigationGraph } from "../features/graph/InvestigationGraph";
import {
  TransactionTimeline,
  type TimelineEvent,
} from "../features/timeline/TransactionTimeline";
import type {
  BoundMaterial,
  CaseDisposition,
  EvidenceStrength,
  NodeKind,
  RiskLevel,
} from "../models/types";
import {
  buildBoundMaterials,
  countMaterials,
  diffBoundMaterials,
} from "../models/materials";
import {
  useAddEvidenceMutation,
  useAddGraphNodeMutation,
  useGetAlertsQuery,
  useGetCaseWorkspaceQuery,
  useReviewConclusionMutation,
  useSaveConclusionMutation,
  useTransitionCaseMutation,
  useUpdateGraphNodeMutation,
} from "../services/api";
import { createId, nowIso } from "../services/mockStorage";

const dispositionLabels: Record<CaseDisposition, string> = {
  freeze: "建议冻结",
  release: "建议放行",
  observe: "继续观察",
};

const errorMessage = (error: unknown): string => {
  if (typeof error === "object" && error && "error" in error) {
    return String(error.error);
  }
  return "操作失败，请检查输入后重试。";
};

const formatTime = (value: string): string =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

function MaterialChips({
  materials,
  highlightIds,
  removedIds,
}: {
  materials: BoundMaterial[];
  highlightIds?: Set<string>;
  removedIds?: Set<string>;
}) {
  if (materials.length === 0) {
    return (
      <Text size="xs" c="dimmed">
        草稿尚未绑定材料。
      </Text>
    );
  }
  return (
    <Group gap={6}>
      {materials.map((material) => {
        const isHighlight = highlightIds?.has(material.refId);
        const isRemoved = removedIds?.has(material.refId);
        return (
          <Badge
            key={`${material.kind}-${material.refId}`}
            variant={isRemoved ? "outline" : isHighlight ? "filled" : "light"}
            color={
              isRemoved ? "red" : material.kind === "evidence" ? "cyan" : "grape"
            }
            leftSection={
              material.kind === "evidence" ? (
                <FileText size={12} />
              ) : (
                <Share2 size={12} />
              )
            }
            title={material.detail}
          >
            {material.kind === "evidence" ? "证据" : "关系"} · {material.label}
          </Badge>
        );
      })}
    </Group>
  );
}

export function CaseDetailPage() {
  const { caseId = "" } = useParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const selectedNodeId = useAppSelector(
    (state) => state.alertsUi.selectedNodeId,
  );
  const focusedTimelineId = useAppSelector(
    (state) => state.alertsUi.focusedTimelineId,
  );
  const focusedEvidenceId = useAppSelector(
    (state) => state.alertsUi.focusedEvidenceId,
  );
  const { data, isLoading, error } = useGetCaseWorkspaceQuery(caseId);
  const { data: allAlerts = [] } = useGetAlertsQuery({
    keyword: "",
    riskLevel: "all",
    status: "all",
    channel: "",
  });
  const [addNode] = useAddGraphNodeMutation();
  const [updateNode] = useUpdateGraphNodeMutation();
  const [addEvidence, { isLoading: isAddingEvidence }] =
    useAddEvidenceMutation();
  const [saveConclusion, { isLoading: isSavingConclusion }] =
    useSaveConclusionMutation();
  const [transitionCase, { isLoading: isTransitioning }] =
    useTransitionCaseMutation();
  const [reviewConclusion, { isLoading: isReviewing }] =
    useReviewConclusionMutation();

  const [nodeOpened, nodeModal] = useDisclosure(false);
  const [evidenceOpened, evidenceModal] = useDisclosure(false);
  const [conclusionOpened, conclusionModal] = useDisclosure(false);
  const [reviewNote, setReviewNote] = useState("");
  const [nodeForm, setNodeForm] = useState({
    sourceId: "",
    kind: "account" as NodeKind,
    label: "",
    riskLevel: "medium" as RiskLevel,
    evidenceStrength: "medium" as EvidenceStrength,
    source: "",
    occurredAt: "2026-09-29T09:00",
    note: "",
    relationLabel: "",
    relationExplanation: "",
    amount: 0,
  });
  const [evidenceForm, setEvidenceForm] = useState({
    title: "",
    source: "",
    strength: "medium" as EvidenceStrength,
    occurredAt: "2026-09-29T09:00",
    attachment: "",
    note: "",
  });
  const [conclusionForm, setConclusionForm] = useState({
    disposition: "observe" as CaseDisposition,
    rationale: "",
    riskControls: "",
  });

  if (isLoading) {
    return <Text>正在加载案件工作区...</Text>;
  }

  if (error || !data) {
    return (
      <Alert color="red" title="案件加载失败">
        {errorMessage(error)}
      </Alert>
    );
  }

  const caseAlerts = allAlerts.filter((item) =>
    data.case.alertIds.includes(item.id),
  );
  const selectedNode = data.nodes.find((item) => item.id === selectedNodeId);
  const latestConclusion = data.conclusions[0];
  // 当前仍处于待复核的结论（已通过 / 已退回版本不算活动版本）。
  const activeSubmitted = data.conclusions.find(
    (item) => item.status === "submitted",
  );
  const activeDrift = activeSubmitted?.drift;
  const currentMaterials = buildBoundMaterials(data.evidence, data.edges);
  const currentMaterialStats = countMaterials(currentMaterials);
  // 新建结论弹窗中预览：提交后将绑定的材料相对最近一版快照的差异。
  const previousSnapshotConclusion = data.conclusions.find(
    (item) => item.materials.length > 0,
  );
  const previewDiff = previousSnapshotConclusion
    ? diffBoundMaterials(
        previousSnapshotConclusion.materials,
        currentMaterials,
      )
    : undefined;

  const handleTimelineFocus = (event?: TimelineEvent) => {
    dispatch(focusTimeline(event?.id));
    dispatch(focusEvidence(event?.source === "evidence" ? event.id : undefined));
    if (event?.source === "transaction") {
      const edge = data.edges.find((item) => item.id === event.id);
      if (edge) {
        dispatch(selectNode(edge.target));
      }
    }
  };

  const handleAddNode = async () => {
    if (!nodeForm.sourceId || !nodeForm.label.trim() || !nodeForm.source.trim()) {
      notifications.show({
        color: "red",
        title: "信息不完整",
        message: "关系源节点、节点名称和证据来源均为必填项。",
      });
      return;
    }
    try {
      const result = await addNode({
        caseId,
        node: {
          id: createId("NODE"),
          caseId,
          position: { x: 420, y: 240 },
          data: {
            label: nodeForm.label.trim(),
            kind: nodeForm.kind,
            riskLevel: nodeForm.riskLevel,
            note: nodeForm.note.trim() || "待补充关系说明。",
            evidenceStrength: nodeForm.evidenceStrength,
            source: nodeForm.source.trim(),
            occurredAt: new Date(nodeForm.occurredAt).toISOString(),
          },
        },
        relation: {
          sourceId: nodeForm.sourceId,
          kind: "transfer",
          label: nodeForm.relationLabel.trim() || "已登记关系",
          explanation:
            nodeForm.relationExplanation.trim() ||
            "关系来自调查员登记，需结合来源材料复核。",
          amount: nodeForm.amount || undefined,
        },
      }).unwrap();
      notifications.show({
        color: result.materialsChanged ? "orange" : "teal",
        title: result.materialsChanged ? "关系已加入，复核材料已变化" : "节点已加入",
        message: result.materialsChanged
          ? "该关系在结论提交后新增，案件已回到待补证；复核人只能退回或由调查员重新提交。"
          : "图谱、证据来源和审计日志已同步更新。",
      });
      nodeModal.close();
      setNodeForm((current) => ({
        ...current,
        label: "",
        source: "",
        note: "",
      }));
    } catch (mutationError) {
      notifications.show({
        color: "red",
        title: "加入失败",
        message: errorMessage(mutationError),
      });
    }
  };

  const handleAddEvidence = async () => {
    if (
      !evidenceForm.title.trim() ||
      !evidenceForm.source.trim() ||
      !evidenceForm.attachment.trim()
    ) {
      notifications.show({
        color: "red",
        title: "信息不完整",
        message: "证据名称、来源和附件标识均为必填项。",
      });
      return;
    }
    try {
      const result = await addEvidence({
        caseId,
        title: evidenceForm.title.trim(),
        source: evidenceForm.source.trim(),
        strength: evidenceForm.strength,
        occurredAt: new Date(evidenceForm.occurredAt).toISOString(),
        attachment: evidenceForm.attachment.trim(),
        note: evidenceForm.note.trim() || "未补充说明。",
      }).unwrap();
      notifications.show({
        color: result.materialsChanged ? "orange" : "teal",
        title: result.materialsChanged ? "证据已登记，复核材料已变化" : "证据已登记",
        message: result.materialsChanged
          ? "该证据在结论提交后新增，原结论标记为材料已变化，案件已回到待补证。"
          : "证据来源、发生时间与提交时间已写入台账。",
      });
      evidenceModal.close();
      setEvidenceForm((current) => ({
        ...current,
        title: "",
        source: "",
        attachment: "",
        note: "",
      }));
    } catch (mutationError) {
      notifications.show({
        color: "red",
        title: "证据登记失败",
        message: errorMessage(mutationError),
      });
    }
  };

  const handleSaveConclusion = async (submit: boolean) => {
    if (conclusionForm.rationale.trim().length < 12) {
      notifications.show({
        color: "red",
        title: "结论依据不足",
        message: "结论说明至少需要 12 个字符。",
      });
      return;
    }
    try {
      await saveConclusion({
        caseId,
        disposition: conclusionForm.disposition,
        rationale: conclusionForm.rationale.trim(),
        riskControls: conclusionForm.riskControls
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
        submit,
      }).unwrap();
      notifications.show({
        color: "teal",
        title: submit ? "已提交复核" : "草稿已保存",
        message: "结论版本已锁定创建人和创建时间。",
      });
      conclusionModal.close();
      setConclusionForm({
        disposition: "observe",
        rationale: "",
        riskControls: "",
      });
    } catch (mutationError) {
      notifications.show({
        color: "red",
        title: "结论保存失败",
        message: errorMessage(mutationError),
      });
    }
  };

  const handleTransition = async (
    status: "investigating" | "pending_review" | "supplement" | "closed",
  ) => {
    try {
      await transitionCase({ caseId, status }).unwrap();
      notifications.show({
        color: "teal",
        title: "状态已更新",
        message: `案件状态已流转为 ${status}。`,
      });
    } catch (mutationError) {
      notifications.show({
        color: "red",
        title: "状态流转失败",
        message: errorMessage(mutationError),
      });
    }
  };

  const handleReview = async (decision: "approve" | "return") => {
    if (!activeSubmitted) {
      return;
    }
    if (reviewNote.trim().length < 6) {
      notifications.show({
        color: "red",
        title: "复核意见不足",
        message: "复核意见至少需要 6 个字符。",
      });
      return;
    }
    try {
      await reviewConclusion({
        caseId,
        conclusionId: activeSubmitted.id,
        decision,
        reviewerNote: reviewNote.trim(),
      }).unwrap();
      notifications.show({
        color: decision === "approve" ? "teal" : "orange",
        title: decision === "approve" ? "复核通过" : "已退回补证",
        message:
          decision === "approve"
            ? "结论按提交时的材料快照生效，已写入审计日志。"
            : "复核动作和意见已写入审计日志，等待调查员基于当前材料重新提交。",
      });
      setReviewNote("");
    } catch (mutationError) {
      notifications.show({
        color: "red",
        title: "复核失败",
        message: errorMessage(mutationError),
      });
    }
  };

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-start">
        <Group align="flex-start">
          <Button
            variant="subtle"
            px={6}
            leftSection={<ArrowLeft size={16} />}
            onClick={() => navigate("/cases")}
          >
            返回案件
          </Button>
          <div>
            <Group gap="sm">
              <Title order={2}>{data.case.title}</Title>
              <RiskBadge value={data.case.riskLevel} />
              <CaseStatusBadge value={data.case.status} />
            </Group>
            <Text c="dimmed" size="sm" mt={5}>
              {data.case.id} · 负责人 {data.case.owner} · 更新于{" "}
              {new Date(data.case.updatedAt).toLocaleString("zh-CN", {
                hour12: false,
              })}
            </Text>
          </div>
        </Group>
        <Group>
          <Button
            variant="default"
            leftSection={<GitBranchPlus size={16} />}
            onClick={nodeModal.open}
          >
            加入图谱节点
          </Button>
          <Button
            variant="light"
            leftSection={<FilePlus2 size={16} />}
            onClick={evidenceModal.open}
          >
            登记证据
          </Button>
          <Button
            leftSection={<Send size={16} />}
            onClick={conclusionModal.open}
          >
            新建结论版本
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="md">
        <Group justify="space-between">
          <div>
            <Text size="sm" fw={600}>
              案件摘要
            </Text>
            <Text size="sm" c="dimmed" mt={4}>
              {data.case.summary}
            </Text>
          </div>
          <Group>
            <Button
              size="xs"
              variant="default"
              loading={isTransitioning}
              onClick={() => handleTransition("investigating")}
            >
              标记调查中
            </Button>
            <Button
              size="xs"
              variant="light"
              loading={isTransitioning}
              onClick={() => handleTransition("pending_review")}
            >
              提交复核
            </Button>
            <Button
              size="xs"
              variant="light"
              color="orange"
              loading={isTransitioning}
              onClick={() => handleTransition("supplement")}
            >
              要求补证
            </Button>
            <Button
              size="xs"
              variant="light"
              color="teal"
              loading={isTransitioning}
              onClick={() => handleTransition("closed")}
            >
              关闭案件
            </Button>
          </Group>
        </Group>
      </Paper>

      <Tabs defaultValue="graph" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="graph">关系图谱与时间轴</Tabs.Tab>
          <Tabs.Tab value="evidence">证据台账</Tabs.Tab>
          <Tabs.Tab value="conclusions">结论与复核</Tabs.Tab>
          <Tabs.Tab value="alerts">关联告警</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="graph" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, xl: 8 }}>
              <Paper withBorder>
                <Group justify="space-between" p="sm">
                  <div>
                    <Text size="sm" fw={600}>
                      案件关系图谱
                    </Text>
                    <Text size="xs" c="dimmed">
                      拖动节点可调整布局；关联关系必须结合解释和证据复核。
                    </Text>
                  </div>
                  <Badge variant="light" color="gray">
                    {data.nodes.length} 节点 / {data.edges.length} 关系
                  </Badge>
                </Group>
                <Divider />
                <InvestigationGraph
                  nodes={data.nodes}
                  edges={data.edges}
                  selectedNodeId={selectedNodeId}
                  focusedTimelineId={focusedTimelineId}
                  onSelectNode={(nodeId) => dispatch(selectNode(nodeId))}
                  onNodePositionChange={(nodeId, position) => {
                    const node = data.nodes.find((item) => item.id === nodeId);
                    if (node) {
                      void updateNode({
                        caseId,
                        node: { ...node, position },
                      });
                    }
                  }}
                />
              </Paper>
              {selectedNode ? (
                <Paper withBorder p="md" mt="md">
                  <Group justify="space-between">
                    <div>
                      <Text fw={600}>{selectedNode.data.label} 节点说明</Text>
                      <Text size="xs" c="dimmed">
                        {selectedNode.data.source} ·{" "}
                        {new Date(
                          selectedNode.data.occurredAt,
                        ).toLocaleString("zh-CN", { hour12: false })}
                      </Text>
                    </div>
                    <EvidenceStrengthBadge
                      value={selectedNode.data.evidenceStrength}
                    />
                  </Group>
                  <Text size="sm" mt="sm">
                    {selectedNode.data.note}
                  </Text>
                </Paper>
              ) : null}
            </Grid.Col>
            <Grid.Col span={{ base: 12, xl: 4 }}>
              <Paper withBorder h={selectedNode ? 702 : 620}>
                <Group justify="space-between" p="sm">
                  <div>
                    <Text size="sm" fw={600}>
                      联动时间轴
                    </Text>
                    <Text size="xs" c="dimmed">
                      点击事件可高亮关系或证据
                    </Text>
                  </div>
                  {focusedTimelineId ? (
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<RotateCcw size={13} />}
                      onClick={() => handleTimelineFocus(undefined)}
                    >
                      清除
                    </Button>
                  ) : null}
                </Group>
                <Divider />
                <div style={{ height: selectedNode ? 642 : 560, padding: 12 }}>
                  <TransactionTimeline
                    alerts={caseAlerts}
                    edges={data.edges}
                    evidence={data.evidence}
                    focusedId={focusedTimelineId}
                    onFocus={handleTimelineFocus}
                  />
                </div>
              </Paper>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="evidence" pt="md">
          <Paper withBorder>
            <Group justify="space-between" p="md">
              <div>
                <Text fw={600}>证据台账</Text>
                <Text size="sm" c="dimmed">
                  每份证据记录来源、发生时间、提交时间和证据强度。
                </Text>
              </div>
              <Button
                leftSection={<FilePlus2 size={16} />}
                onClick={evidenceModal.open}
              >
                登记证据
              </Button>
            </Group>
            <Table.ScrollContainer minWidth={980}>
              <Table highlightOnHover verticalSpacing="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>证据名称</Table.Th>
                    <Table.Th>来源</Table.Th>
                    <Table.Th>强度</Table.Th>
                    <Table.Th>发生时间</Table.Th>
                    <Table.Th>提交记录</Table.Th>
                    <Table.Th>附件标识</Table.Th>
                    <Table.Th>说明</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.evidence.map((item) => (
                    <Table.Tr
                      key={item.id}
                      className={
                        focusedEvidenceId === item.id
                          ? "table-row-focused"
                          : ""
                      }
                    >
                      <Table.Td>
                        <Group gap={6}>
                          <Text size="sm" fw={600}>
                            {item.title}
                          </Text>
                          {activeSubmitted &&
                          !activeSubmitted.materials.some(
                            (material) =>
                              material.kind === "evidence" &&
                              material.refId === item.id,
                          ) ? (
                            <Badge
                              color="red"
                              variant="filled"
                              size="xs"
                              leftSection={<AlertTriangle size={10} />}
                            >
                              V{activeSubmitted.version} 提交后新增
                            </Badge>
                          ) : null}
                        </Group>
                        <Text size="xs" c="dimmed" ff="monospace">
                          {item.id}
                        </Text>
                      </Table.Td>
                      <Table.Td>{item.source}</Table.Td>
                      <Table.Td>
                        <EvidenceStrengthBadge value={item.strength} />
                      </Table.Td>
                      <Table.Td>
                        {new Date(item.occurredAt).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs">
                          {item.submittedBy} · V{item.version}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {new Date(item.submittedAt).toLocaleString("zh-CN", {
                            hour12: false,
                          })}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="xs" ff="monospace">
                          {item.attachment}
                        </Text>
                      </Table.Td>
                      <Table.Td maw={300}>
                        <Text size="xs" c="dimmed">
                          {item.note}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="conclusions" pt="md">
          <Grid>
            <Grid.Col span={{ base: 12, lg: 7 }}>
              <Paper withBorder>
                <Group justify="space-between" p="md">
                  <div>
                    <Text fw={600}>结论版本</Text>
                    <Text size="sm" c="dimmed">
                      每个版本绑定提交时刻的证据与关系快照；提交后材料增减会标记“材料已变化”，已通过版本保留原快照不受影响。
                    </Text>
                  </div>
                  <Button onClick={conclusionModal.open}>新建版本</Button>
                </Group>
                <Stack gap={0}>
                  {data.conclusions.map((item, index) => {
                    const stats = countMaterials(item.materials);
                    const drift = item.drift;
                    const versionDiff = item.diffFromPrevious;
                    const addedIds = new Set(
                      (versionDiff?.added ?? []).map((material) => material.refId),
                    );
                    const removedIds = new Set(
                      (versionDiff?.removed ?? []).map(
                        (material) => material.refId,
                      ),
                    );
                    const previousVersion = data.conclusions[index + 1]?.version;
                    return (
                      <div key={item.id}>
                        {index > 0 ? <Divider /> : null}
                        <Stack gap="xs" p="md">
                          <Group justify="space-between">
                            <Group>
                              <Text fw={600}>V{item.version}</Text>
                              <ConclusionStatusBadge value={item.status} />
                              <Badge variant="light" color="gray">
                                {dispositionLabels[item.disposition]}
                              </Badge>
                              {item.materials.length > 0 ? (
                                <Badge
                                  variant="outline"
                                  color={drift?.changed ? "red" : "cyan"}
                                  leftSection={<FileCheck2 size={12} />}
                                >
                                  绑定 {stats.evidenceCount} 证据 /{" "}
                                  {stats.relationCount} 关系
                                </Badge>
                              ) : (
                                <Badge variant="outline" color="gray">
                                  草稿未绑定材料
                                </Badge>
                              )}
                              {drift?.changed ? (
                                <Badge
                                  variant="filled"
                                  color="red"
                                  leftSection={<AlertTriangle size={12} />}
                                >
                                  材料已变化
                                </Badge>
                              ) : null}
                            </Group>
                            <Text size="xs" c="dimmed">
                              {item.createdBy} · {formatTime(item.createdAt)}
                            </Text>
                          </Group>
                          <Text size="sm">{item.rationale}</Text>
                          <Group gap="xs">
                            {item.riskControls.map((control) => (
                              <Badge
                                key={control}
                                variant="outline"
                                color="gray"
                              >
                                {control}
                              </Badge>
                            ))}
                          </Group>

                          {item.materials.length > 0 ? (
                            <Paper
                              withBorder
                              p="xs"
                              bg={drift?.changed ? "red.0" : "gray.0"}
                            >
                              <Group gap={6} mb={6}>
                                <FileCheck2 size={13} />
                                <Text size="xs" fw={600}>
                                  {item.status === "submitted"
                                    ? "提交时绑定的材料快照"
                                    : "提交时材料快照（历史版本已固化）"}
                                </Text>
                                <Text size="xs" c="dimmed">
                                  {item.status === "approved"
                                    ? "后续补充材料不会改变本结论。"
                                    : "以此清单判断复核期间材料是否增减。"}
                                </Text>
                              </Group>
                              <MaterialChips
                                materials={item.materials}
                                highlightIds={addedIds}
                                removedIds={removedIds}
                              />
                            </Paper>
                          ) : null}

                          {drift?.changed ? (
                            <Alert
                              color="red"
                              icon={<AlertTriangle size={16} />}
                              title={`提交后材料发生变化（${drift.added.length} 项新增 / ${drift.removed.length} 项减少）`}
                            >
                              <Stack gap={6}>
                                <Text size="sm">
                                  该结论不能在缺少新材料的情况下通过，案件已回到待补证。复核人只能退回本版，或由调查员基于当前材料重新提交新版本。
                                </Text>
                                {drift.added.length > 0 ? (
                                  <div>
                                    <Text size="xs" fw={600} c="red">
                                      提交后新增
                                    </Text>
                                    <MaterialChips
                                      materials={drift.added}
                                      highlightIds={new Set(
                                        drift.added.map(
                                          (material) => material.refId,
                                        ),
                                      )}
                                    />
                                  </div>
                                ) : null}
                                {drift.removed.length > 0 ? (
                                  <div>
                                    <Text size="xs" fw={600} c="red">
                                      提交后缺失
                                    </Text>
                                    <MaterialChips
                                      materials={drift.removed}
                                      removedIds={new Set(
                                        drift.removed.map(
                                          (material) => material.refId,
                                        ),
                                      )}
                                    />
                                  </div>
                                ) : null}
                                {item.materialsChangedAt ? (
                                  <Text size="xs" c="dimmed">
                                    首次变化时间：
                                    {formatTime(item.materialsChangedAt)}
                                  </Text>
                                ) : null}
                              </Stack>
                            </Alert>
                          ) : null}

                          {versionDiff ? (
                            <Alert
                              color={
                                versionDiff.removed.length > 0 ? "orange" : "teal"
                              }
                              variant="light"
                              icon={<GitCompareArrows size={16} />}
                              title={
                                previousVersion
                                  ? `相比上一版 V${previousVersion} 的材料变化`
                                  : "相比上一版的材料变化"
                              }
                            >
                              <Stack gap={6}>
                                {versionDiff.added.length > 0 ? (
                                  <div>
                                    <Text size="xs" fw={600}>
                                      多出 {versionDiff.added.length} 项材料
                                    </Text>
                                    <MaterialChips
                                      materials={versionDiff.added}
                                      highlightIds={new Set(
                                        versionDiff.added.map(
                                          (material) => material.refId,
                                        ),
                                      )}
                                    />
                                  </div>
                                ) : null}
                                {versionDiff.removed.length > 0 ? (
                                  <div>
                                    <Text size="xs" fw={600} c="orange">
                                      少了 {versionDiff.removed.length} 项材料
                                    </Text>
                                    <MaterialChips
                                      materials={versionDiff.removed}
                                      removedIds={new Set(
                                        versionDiff.removed.map(
                                          (material) => material.refId,
                                        ),
                                      )}
                                    />
                                  </div>
                                ) : null}
                              </Stack>
                            </Alert>
                          ) : null}

                          {item.status === "submitted" &&
                          drift &&
                          !drift.changed ? (
                            <Text size="xs" c="teal">
                              当前案件材料与提交快照一致，可以复核。
                            </Text>
                          ) : null}
                          {item.reviewerNote ? (
                            <Alert
                              color={
                                item.status === "approved" ? "teal" : "orange"
                              }
                              title={`复核意见 · ${item.reviewer}`}
                            >
                              {item.reviewerNote}
                            </Alert>
                          ) : null}
                        </Stack>
                      </div>
                    );
                  })}
                </Stack>
              </Paper>
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 5 }}>
              <Paper withBorder p="md">
                <Title order={4}>复核操作</Title>
                {activeSubmitted ? (
                  <>
                    <Text size="sm" c="dimmed" mt={5}>
                      待复核版本 V{activeSubmitted.version} ·{" "}
                      {dispositionLabels[activeSubmitted.disposition]} ·
                      提交时绑定{" "}
                      {countMaterials(activeSubmitted.materials).evidenceCount}{" "}
                      份证据 /{" "}
                      {countMaterials(activeSubmitted.materials).relationCount}{" "}
                      条关系
                    </Text>
                    {activeDrift?.changed ? (
                      <Alert
                        color="red"
                        icon={<AlertTriangle size={16} />}
                        mt="md"
                        title="材料已变化，禁止通过"
                      >
                        <Stack gap={6}>
                          <Text size="sm">
                            该版本提交后，案件补进或移除了绑定材料，结论不能在缺少这些材料的情况下生效。请退回本版，由调查员基于当前材料重新提交新版本。
                          </Text>
                          <Group gap={6}>
                            <Badge color="red" variant="filled">
                              新增 {activeDrift.added.length} 项
                            </Badge>
                            <Badge color="red" variant="outline">
                              减少 {activeDrift.removed.length} 项
                            </Badge>
                          </Group>
                        </Stack>
                      </Alert>
                    ) : (
                      <Alert
                        color="orange"
                        icon={<RotateCcw size={16} />}
                        mt="md"
                      >
                        关系关联不能直接作为结论。通过前应检查证据来源、发生时间与证据强度；当前材料与提交快照一致。
                      </Alert>
                    )}
                    <Textarea
                      label="复核意见"
                      description="通过或退回意见均进入不可删除的审计记录"
                      minRows={4}
                      mt="md"
                      value={reviewNote}
                      onChange={(event) =>
                        setReviewNote(event.currentTarget.value)
                      }
                    />
                    <Group mt="md">
                      <Button
                        leftSection={<Check size={16} />}
                        color="teal"
                        loading={isReviewing}
                        disabled={Boolean(activeDrift?.changed)}
                        onClick={() => handleReview("approve")}
                      >
                        复核通过
                      </Button>
                      <Button
                        variant="light"
                        color="orange"
                        leftSection={<RotateCcw size={16} />}
                        loading={isReviewing}
                        onClick={() => handleReview("return")}
                      >
                        退回补证
                      </Button>
                    </Group>
                    {activeDrift?.changed ? (
                      <Text size="xs" c="red" mt={8}>
                        材料变化期间仅可退回；调查员重新提交后才能再次通过。
                      </Text>
                    ) : null}
                  </>
                ) : latestConclusion?.status === "approved" ? (
                  <Alert color="teal" mt="md" icon={<FileCheck2 size={16} />}>
                    V{latestConclusion.version} 已通过并按提交时材料快照结案。
                    后续即使补进材料，也不会改变该历史结论；如需调整请新建版本。
                  </Alert>
                ) : latestConclusion?.status === "returned" ? (
                  <Alert color="orange" mt="md" icon={<RotateCcw size={16} />}>
                    最新版本 V{latestConclusion.version} 已退回，案件处于待补证。
                    调查员补充材料后请新建并提交新版本。
                  </Alert>
                ) : latestConclusion?.status === "draft" ? (
                  <Alert color="gray" mt="md">
                    最新版本 V{latestConclusion.version} 还是草稿，尚未绑定提交时材料，请先提交复核。
                  </Alert>
                ) : (
                  <Text c="dimmed" mt="md">
                    尚无结论版本。
                  </Text>
                )}
              </Paper>
            </Grid.Col>
          </Grid>
        </Tabs.Panel>

        <Tabs.Panel value="alerts" pt="md">
          <Paper withBorder>
            <Table.ScrollContainer minWidth={820}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>告警编号</Table.Th>
                    <Table.Th>标题</Table.Th>
                    <Table.Th>账户</Table.Th>
                    <Table.Th>风险</Table.Th>
                    <Table.Th>金额</Table.Th>
                    <Table.Th>检测时间</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {caseAlerts.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td ff="monospace">{item.id}</Table.Td>
                      <Table.Td>{item.title}</Table.Td>
                      <Table.Td>{item.account}</Table.Td>
                      <Table.Td>
                        <RiskBadge value={item.riskLevel} />
                      </Table.Td>
                      <Table.Td>¥{item.amount.toLocaleString("zh-CN")}</Table.Td>
                      <Table.Td>
                        {new Date(item.detectedAt).toLocaleString("zh-CN", {
                          hour12: false,
                        })}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </Tabs.Panel>
      </Tabs>

      <Modal
        opened={nodeOpened}
        onClose={nodeModal.close}
        title="加入案件图谱节点"
        size="lg"
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <Select
            label="关系源节点"
            required
            searchable
            value={nodeForm.sourceId}
            onChange={(value) =>
              setNodeForm((current) => ({
                ...current,
                sourceId: value ?? "",
              }))
            }
            data={data.nodes.map((item) => ({
              value: item.id,
              label: item.data.label,
            }))}
          />
          <Select
            label="节点类型"
            value={nodeForm.kind}
            onChange={(value) =>
              setNodeForm((current) => ({
                ...current,
                kind: (value as NodeKind) ?? "account",
              }))
            }
            data={[
              { value: "account", label: "账户" },
              { value: "device", label: "设备" },
              { value: "ip", label: "IP 地址" },
              { value: "merchant", label: "商户" },
            ]}
          />
          <TextInput
            label="节点名称"
            required
            value={nodeForm.label}
            onChange={(event) =>
              setNodeForm((current) => ({
                ...current,
                label: event.currentTarget.value,
              }))
            }
          />
          <TextInput
            label="证据来源"
            required
            value={nodeForm.source}
            onChange={(event) =>
              setNodeForm((current) => ({
                ...current,
                source: event.currentTarget.value,
              }))
            }
          />
          <Select
            label="风险等级"
            value={nodeForm.riskLevel}
            onChange={(value) =>
              setNodeForm((current) => ({
                ...current,
                riskLevel: (value as RiskLevel) ?? "medium",
              }))
            }
            data={[
              { value: "high", label: "高风险" },
              { value: "medium", label: "中风险" },
              { value: "low", label: "低风险" },
            ]}
          />
          <Select
            label="证据强度"
            value={nodeForm.evidenceStrength}
            onChange={(value) =>
              setNodeForm((current) => ({
                ...current,
                evidenceStrength:
                  (value as EvidenceStrength) ?? "medium",
              }))
            }
            data={[
              { value: "strong", label: "强" },
              { value: "medium", label: "中" },
              { value: "weak", label: "弱" },
            ]}
          />
          <TextInput
            type="datetime-local"
            label="证据发生时间"
            value={nodeForm.occurredAt}
            onChange={(event) =>
              setNodeForm((current) => ({
                ...current,
                occurredAt: event.currentTarget.value,
              }))
            }
          />
          <NumberInput
            label="关联金额"
            value={nodeForm.amount}
            min={0}
            thousandSeparator
            onChange={(value) =>
              setNodeForm((current) => ({
                ...current,
                amount: Number(value) || 0,
              }))
            }
          />
          <TextInput
            label="关系名称"
            placeholder="例如：转账 12 万"
            value={nodeForm.relationLabel}
            onChange={(event) =>
              setNodeForm((current) => ({
                ...current,
                relationLabel: event.currentTarget.value,
              }))
            }
          />
          <TextInput
            label="关系解释"
            placeholder="说明关联依据与限制"
            value={nodeForm.relationExplanation}
            onChange={(event) =>
              setNodeForm((current) => ({
                ...current,
                relationExplanation: event.currentTarget.value,
              }))
            }
          />
        </SimpleGrid>
        <Textarea
          label="节点说明"
          minRows={3}
          mt="md"
          value={nodeForm.note}
          onChange={(event) =>
            setNodeForm((current) => ({
              ...current,
              note: event.currentTarget.value,
            }))
          }
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={nodeModal.close}>
            取消
          </Button>
          <Button onClick={handleAddNode}>加入图谱</Button>
        </Group>
      </Modal>

      <Modal
        opened={evidenceOpened}
        onClose={evidenceModal.close}
        title="登记案件证据"
        size="lg"
      >
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="证据名称"
            required
            value={evidenceForm.title}
            onChange={(event) =>
              setEvidenceForm((current) => ({
                ...current,
                title: event.currentTarget.value,
              }))
            }
          />
          <TextInput
            label="证据来源"
            required
            value={evidenceForm.source}
            onChange={(event) =>
              setEvidenceForm((current) => ({
                ...current,
                source: event.currentTarget.value,
              }))
            }
          />
          <Select
            label="证据强度"
            value={evidenceForm.strength}
            onChange={(value) =>
              setEvidenceForm((current) => ({
                ...current,
                strength: (value as EvidenceStrength) ?? "medium",
              }))
            }
            data={[
              { value: "strong", label: "强证据" },
              { value: "medium", label: "中等证据" },
              { value: "weak", label: "弱证据" },
            ]}
          />
          <TextInput
            type="datetime-local"
            label="证据发生时间"
            value={evidenceForm.occurredAt}
            onChange={(event) =>
              setEvidenceForm((current) => ({
                ...current,
                occurredAt: event.currentTarget.value,
              }))
            }
          />
          <TextInput
            label="附件标识"
            required
            placeholder="文件名或本地附件编号"
            value={evidenceForm.attachment}
            onChange={(event) =>
              setEvidenceForm((current) => ({
                ...current,
                attachment: event.currentTarget.value,
              }))
            }
          />
        </SimpleGrid>
        <Textarea
          label="证据说明"
          minRows={3}
          mt="md"
          value={evidenceForm.note}
          onChange={(event) =>
            setEvidenceForm((current) => ({
              ...current,
              note: event.currentTarget.value,
            }))
          }
        />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={evidenceModal.close}>
            取消
          </Button>
          <Button loading={isAddingEvidence} onClick={handleAddEvidence}>
            登记证据
          </Button>
        </Group>
      </Modal>

      <Modal
        opened={conclusionOpened}
        onClose={conclusionModal.close}
        title="新建结论版本"
        size="lg"
      >
        <Select
          label="处置建议"
          value={conclusionForm.disposition}
          onChange={(value) =>
            setConclusionForm((current) => ({
              ...current,
              disposition: (value as CaseDisposition) ?? "observe",
            }))
          }
          data={[
            { value: "freeze", label: "建议冻结" },
            { value: "release", label: "建议放行" },
            { value: "observe", label: "继续观察" },
          ]}
        />
        <Textarea
          label="结论依据"
          description="至少 12 个字符；说明关联事实、证据限制与判断边界"
          minRows={5}
          mt="md"
          value={conclusionForm.rationale}
          onChange={(event) =>
            setConclusionForm((current) => ({
              ...current,
              rationale: event.currentTarget.value,
            }))
          }
        />
        <Textarea
          label="风险控制措施"
          description="每行一项"
          minRows={4}
          mt="md"
          value={conclusionForm.riskControls}
          onChange={(event) =>
            setConclusionForm((current) => ({
              ...current,
              riskControls: event.currentTarget.value,
            }))
          }
        />
        {activeSubmitted ? (
          <Alert color="red" mt="md" icon={<AlertTriangle size={16} />}>
            {activeDrift?.changed
              ? `V${activeSubmitted.version} 提交后材料已变化，案件处于待补证。请先由复核人退回该版本，才能重新提交新版本；期间仍可保存草稿。`
              : `V${activeSubmitted.version} 正在复核中，不能重复提交；如需更新请等复核人退回后再提交。`}
          </Alert>
        ) : null}
        <Paper withBorder p="sm" mt="md" bg="gray.0">
          <Group justify="space-between" mb={6}>
            <Group gap={6}>
              <FileCheck2 size={14} />
              <Text size="sm" fw={600}>
                提交后将绑定当前材料
              </Text>
            </Group>
            <Badge variant="light" color="cyan">
              {currentMaterialStats.evidenceCount} 份证据 /{" "}
              {currentMaterialStats.relationCount} 条关系
            </Badge>
          </Group>
          {currentMaterials.length > 0 ? (
            <MaterialChips materials={currentMaterials} />
          ) : (
            <Text size="xs" c="dimmed">
              当前案件还没有证据或关系，请先登记材料。
            </Text>
          )}
          {previewDiff &&
          (previewDiff.added.length > 0 || previewDiff.removed.length > 0) ? (
            <Stack gap={6} mt="sm">
              {previewDiff.added.length > 0 ? (
                <div>
                  <Text size="xs" fw={600} c="teal">
                    相比 V{previousSnapshotConclusion?.version} 将多出{" "}
                    {previewDiff.added.length} 项
                  </Text>
                  <MaterialChips
                    materials={previewDiff.added}
                    highlightIds={new Set(
                      previewDiff.added.map((material) => material.refId),
                    )}
                  />
                </div>
              ) : null}
              {previewDiff.removed.length > 0 ? (
                <div>
                  <Text size="xs" fw={600} c="orange">
                    相比 V{previousSnapshotConclusion?.version} 将少{" "}
                    {previewDiff.removed.length} 项
                  </Text>
                  <MaterialChips
                    materials={previewDiff.removed}
                    removedIds={new Set(
                      previewDiff.removed.map((material) => material.refId),
                    )}
                  />
                </div>
              ) : null}
            </Stack>
          ) : null}
        </Paper>
        <Alert color="gray" mt="md">
          保存草稿不会触发复核也不绑定材料；提交时固化当前证据与关系快照，提交后材料增减会让该版本标记为“材料已变化”。
        </Alert>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={conclusionModal.close}>
            取消
          </Button>
          <Button
            variant="light"
            loading={isSavingConclusion}
            onClick={() => handleSaveConclusion(false)}
          >
            保存草稿
          </Button>
          <Button
            loading={isSavingConclusion}
            disabled={Boolean(activeSubmitted)}
            onClick={() => handleSaveConclusion(true)}
          >
            提交复核
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
