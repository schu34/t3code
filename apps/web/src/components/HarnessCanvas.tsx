import "@xyflow/react/dist/style.css";

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import {
  ArchiveIcon,
  ArrowDownToLineIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleDotIcon,
  GitPullRequestIcon,
  LayoutDashboardIcon,
  Link2Icon,
  MessageCircleIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
  UnplugIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { cn } from "~/lib/utils";
import {
  type HarnessCanvasActions,
  type HarnessCanvasAgent,
  type HarnessCanvasChannel,
  type HarnessCanvasEdge,
  type HarnessCanvasSnapshot,
  type HarnessEdgeKind,
  mergeHarnessCanvasNodeState,
  selectHarnessCanvasNodeSelection,
  selectHarnessCanvasGraph,
} from "../harnessCanvas.logic";

export interface HarnessCanvasProps {
  readonly snapshot: HarnessCanvasSnapshot;
  readonly actions: HarnessCanvasActions | null;
  readonly onSelectAgent: (agent: HarnessCanvasAgent) => void;
  readonly onCloseChat?: () => void;
  readonly selectedAgentId?: string | null;
  readonly className?: string;
}

type HarnessFlowNodeData = {
  readonly agent: HarnessCanvasAgent;
  readonly collapsed: boolean;
  readonly onSelect: (agent: HarnessCanvasAgent) => void;
  readonly onCreateChild: (agentId: string) => void;
  readonly onForkSidechat: (agentId: string, completedTurnId: string) => void;
  readonly onToggleCollapsed: (agentId: string) => void;
  readonly onToggleDetails: (agentId: string) => void;
};

type HarnessFlowNode = Node<HarnessFlowNodeData, "harness-agent">;

const edgeKindLabels: Record<HarnessEdgeKind, string> = {
  delegation: "delegates",
  sidechat: "side chat",
  coordination: "coordinates",
};

const edgeKindClasses: Record<HarnessEdgeKind, string> = {
  delegation: "stroke-foreground/35",
  sidechat: "stroke-violet-400/80",
  coordination: "stroke-sky-400/80",
};

const runtimeStateLabels = {
  queued: "Queued",
  working: "Working",
  waiting: "Waiting",
  blocked: "Blocked",
  idle: "Idle",
  stopped: "Stopped",
  failed: "Failed",
} as const;

const deliveryStageLabels = {
  implementing: "Implementing",
  "pr-open": "PR open",
  "in-review": "In review",
  "changes-requested": "Changes requested",
  merged: "Merged",
} as const;

function runtimeBadgeVariant(
  state: HarnessCanvasAgent["runtimeState"],
): "default" | "secondary" | "success" | "warning" | "error" | "outline" {
  switch (state) {
    case "working":
      return "success";
    case "waiting":
    case "blocked":
      return "warning";
    case "failed":
      return "error";
    case "idle":
      return "secondary";
    default:
      return "outline";
  }
}

function deliveryBadgeVariant(
  stage: HarnessCanvasAgent["deliveryStage"],
): "default" | "secondary" | "success" | "warning" | "error" | "outline" {
  switch (stage) {
    case "merged":
      return "success";
    case "in-review":
      return "default";
    case "changes-requested":
      return "warning";
    case "pr-open":
      return "secondary";
    default:
      return "outline";
  }
}

function FlowAgentNode({ data, selected }: NodeProps<HarnessFlowNode>) {
  const { agent } = data;
  return (
    <div
      className={cn(
        "group relative w-[240px] overflow-visible rounded-lg border bg-card/95 text-card-foreground shadow-lg/5 backdrop-blur-sm transition-[border-color,box-shadow]",
        selected ? "border-primary/75 shadow-primary/15 shadow-lg" : "border-border/75",
      )}
      data-harness-agent-node="true"
      data-agent-id={agent.id}
    >
      <Handle
        id="top-target"
        type="target"
        position={Position.Top}
        className="!size-2 !border-2 !border-background !bg-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Connect into ${agent.title}`}
      />
      <Handle
        id="left-target"
        type="target"
        position={Position.Left}
        className="!size-2 !border-2 !border-background !bg-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Connect into ${agent.title}`}
      />
      <Handle
        id="right-source"
        type="source"
        position={Position.Right}
        className="!size-2 !border-2 !border-background !bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Connect from ${agent.title}`}
      />
      <Handle
        id="bottom-source"
        type="source"
        position={Position.Bottom}
        className="!size-2 !border-2 !border-background !bg-primary opacity-0 transition-opacity group-hover:opacity-100"
        aria-label={`Connect from ${agent.title}`}
      />

      <button
        type="button"
        className="nodrag nowheel flex w-full flex-col gap-1.5 p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => data.onSelect(agent)}
        aria-label={`Open ${agent.title} chat`}
      >
        <span className="flex items-start justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <BotIcon className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{agent.title}</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {agent.projectTitle}
              </span>
            </span>
          </span>
          {agent.unreadCount > 0 ? (
            <Badge size="sm" variant="info" aria-label={`${agent.unreadCount} unread updates`}>
              {agent.unreadCount}
            </Badge>
          ) : null}
        </span>

        <span className="line-clamp-2 min-h-7 text-xs leading-snug text-muted-foreground">
          {agent.activity}
        </span>

        <span className="flex flex-wrap gap-1">
          <Badge size="sm" variant={runtimeBadgeVariant(agent.runtimeState)}>
            <CircleDotIcon className="size-3" aria-hidden="true" />
            {runtimeStateLabels[agent.runtimeState]}
          </Badge>
          <Badge size="sm" variant={deliveryBadgeVariant(agent.deliveryStage)}>
            {agent.deliveryStage === "implementing" ? (
              <ZapIcon className="size-3" aria-hidden="true" />
            ) : (
              <GitPullRequestIcon className="size-3" aria-hidden="true" />
            )}
            {deliveryStageLabels[agent.deliveryStage]}
          </Badge>
        </span>
      </button>

      <div className="nodrag nowheel flex items-center justify-between border-t border-border/60 px-2 py-1">
        <div className="flex items-center gap-0.5">
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label={
              data.collapsed
                ? `Expand ${agent.title} descendants`
                : `Collapse ${agent.title} descendants`
            }
            onClick={() => data.onToggleCollapsed(agent.id)}
          >
            {data.collapsed ? (
              <ChevronRightIcon aria-hidden="true" />
            ) : (
              <ChevronDownIcon aria-hidden="true" />
            )}
          </Button>
          {agent.latestCompletedTurnId ? (
            <Button
              size="icon-micro"
              variant="ghost-muted"
              aria-label={`Fork a side chat from ${agent.title}`}
              onClick={() => data.onForkSidechat(agent.id, agent.latestCompletedTurnId ?? "")}
            >
              <MessageCircleIcon aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <Button
          size="icon-micro"
          variant="ghost-muted"
          aria-label={`Create child agent under ${agent.title}`}
          onClick={() => data.onCreateChild(agent.id)}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

const nodeTypes = { "harness-agent": memo(FlowAgentNode) };

function makeFlowNodes(
  agents: ReadonlyArray<HarnessCanvasAgent>,
  collapsedAgentIds: ReadonlySet<string>,
  callbacks: Pick<
    HarnessFlowNodeData,
    "onSelect" | "onCreateChild" | "onForkSidechat" | "onToggleCollapsed" | "onToggleDetails"
  >,
): HarnessFlowNode[] {
  return agents.map((agent) => ({
    id: agent.id,
    type: "harness-agent",
    position: agent.position ?? { x: 80, y: 80 },
    data: {
      agent,
      collapsed: collapsedAgentIds.has(agent.id),
      ...callbacks,
    },
  }));
}

function edgeStyle(kind: HarnessEdgeKind): Pick<Edge, "style" | "className"> {
  switch (kind) {
    case "sidechat":
      return {
        className: edgeKindClasses[kind],
        style: { strokeDasharray: "5 4", strokeWidth: 1.7 },
      };
    case "coordination":
      return {
        className: edgeKindClasses[kind],
        style: { strokeDasharray: "2 3", strokeWidth: 2 },
      };
    default:
      return { className: edgeKindClasses[kind], style: { strokeWidth: 1.5 } };
  }
}

function makeFlowEdges(edges: ReadonlyArray<HarnessCanvasEdge>): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    ...(edge.kind === "delegation"
      ? { sourceHandle: "bottom-source", targetHandle: "top-target" }
      : {}),
    label: edgeKindLabels[edge.kind],
    labelStyle: { fill: "var(--muted-foreground)", fontSize: 10, fontWeight: 500 },
    labelBgStyle: { fill: "var(--background)", fillOpacity: 0.92 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    animated: edge.kind === "coordination",
    data: { kind: edge.kind, channelId: edge.channelId },
    ...edgeStyle(edge.kind),
  }));
}

function projectCounts(snapshot: HarnessCanvasSnapshot): ReadonlyArray<{
  readonly title: string;
  readonly count: number;
}> {
  const counts = new Map<string, number>();
  for (const agent of snapshot.agents) {
    counts.set(agent.projectTitle, (counts.get(agent.projectTitle) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function ConnectionSelector({
  agents,
  onConnect,
  disabled,
}: {
  readonly agents: ReadonlyArray<HarnessCanvasAgent>;
  readonly onConnect: (source: string, target: string) => void;
  readonly disabled: boolean;
}) {
  const [source, setSource] = useState(agents[0]?.id ?? "");
  const [target, setTarget] = useState(agents[1]?.id ?? agents[0]?.id ?? "");

  const visibleSource = agents.some((agent) => agent.id === source) ? source : "";
  const visibleTarget = agents.some((agent) => agent.id === target) ? target : "";
  const canConnect =
    visibleSource.length > 0 &&
    visibleTarget.length > 0 &&
    visibleSource !== visibleTarget &&
    !disabled;
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-harness-connect-selector="true">
      <label className="sr-only" htmlFor="harness-connect-source">
        Agent to connect from
      </label>
      <select
        id="harness-connect-source"
        className="h-7 max-w-40 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={visibleSource}
        onChange={(event) => setSource(event.target.value)}
        disabled={disabled}
      >
        <option value="">From agent…</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.title}
          </option>
        ))}
      </select>
      <span className="text-xs text-muted-foreground" aria-hidden="true">
        →
      </span>
      <label className="sr-only" htmlFor="harness-connect-target">
        Agent to connect to
      </label>
      <select
        id="harness-connect-target"
        className="h-7 max-w-40 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        value={visibleTarget}
        onChange={(event) => setTarget(event.target.value)}
        disabled={disabled}
      >
        <option value="">To agent…</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.title}
          </option>
        ))}
      </select>
      <Button
        size="xs"
        variant="outline"
        disabled={!canConnect}
        onClick={() => {
          if (!canConnect) return;
          onConnect(visibleSource, visibleTarget);
        }}
      >
        <Link2Icon aria-hidden="true" />
        Connect
      </Button>
    </div>
  );
}

function ChannelPanel({
  channel,
  source,
  target,
  actions,
  onClose,
}: {
  readonly channel: HarnessCanvasChannel;
  readonly source: HarnessCanvasAgent | undefined;
  readonly target: HarnessCanvasAgent | undefined;
  readonly actions: HarnessCanvasActions | null;
  readonly onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const action = async (execute: (channelId: string) => Promise<void>) => {
    await execute(channel.id);
  };
  const sendUpdate = async () => {
    const body = draft.trim();
    if (body.length === 0 || actions === null) return;
    setIsSending(true);
    try {
      await actions.sendCoordination(channel.id, body);
      setDraft("");
    } finally {
      setIsSending(false);
    }
  };
  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex w-[min(380px,calc(100%-1rem))] flex-col border-l border-border/75 bg-background/96 shadow-2xl backdrop-blur-md"
      aria-label={`Channel between ${source?.title ?? "agent"} and ${target?.title ?? "agent"}`}
      data-harness-channel-panel="true"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {source?.title ?? "Agent"} ↔ {target?.title ?? "Agent"}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{channel.topic}</p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close channel details" onClick={onClose}>
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <Badge
            variant={
              channel.state === "aligned"
                ? "success"
                : channel.state === "needs-attention"
                  ? "warning"
                  : channel.state === "paused"
                    ? "outline"
                    : "info"
            }
          >
            <CircleDotIcon aria-hidden="true" />
            {channel.state === "needs-attention" ? "Needs attention" : channel.state}
          </Badge>
          <span className="text-xs text-muted-foreground">Revision {channel.revision}</span>
        </div>

        <section aria-labelledby="harness-channel-transcript-heading">
          <h3
            id="harness-channel-transcript-heading"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Transcript
          </h3>
          <div className="space-y-2">
            {channel.transcript.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/75 px-3 py-4 text-xs text-muted-foreground">
                No messages have been exchanged yet.
              </p>
            ) : (
              channel.transcript.map((message) => (
                <div
                  key={message.id}
                  className="rounded-lg border border-border/60 bg-card/60 p-2.5"
                >
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                    {message.authorAgentId === channel.sourceAgentId
                      ? source?.title
                      : target?.title}
                  </p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed">{message.text}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section aria-labelledby="harness-channel-decisions-heading">
          <h3
            id="harness-channel-decisions-heading"
            className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
          >
            Shared decisions
          </h3>
          {channel.decisions.length === 0 ? (
            <p className="text-xs text-muted-foreground">No decisions recorded.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {channel.decisions.map((decision) => (
                <li key={decision.id} className="rounded-lg border border-border/60 px-3 py-2">
                  <span className="me-1.5 text-muted-foreground">R{decision.revision}</span>
                  {decision.text}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="harness-channel-message-heading">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3
              id="harness-channel-message-heading"
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Send coordination update
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {channel.messageCount} exchanged
            </span>
          </div>
          <textarea
            className="min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Share context, a test result, or a decision…"
            aria-label="Coordination update"
            disabled={actions === null || channel.state === "paused" || isSending}
          />
          <Button
            className="mt-2"
            size="sm"
            variant="default"
            disabled={
              actions === null ||
              channel.state === "paused" ||
              draft.trim().length === 0 ||
              isSending
            }
            onClick={() => void sendUpdate()}
          >
            <MessageCircleIcon aria-hidden="true" />
            {isSending ? "Sending…" : "Send update"}
          </Button>
        </section>

        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/45 p-2">
            <dt className="text-muted-foreground">Latest revision</dt>
            <dd className="mt-1 font-medium">{channel.revision}</dd>
          </div>
          <div className="rounded-lg bg-muted/45 p-2">
            <dt className="text-muted-foreground">Last synced</dt>
            <dd className="mt-1 truncate font-medium">
              {channel.lastSyncedAt ? new Date(channel.lastSyncedAt).toLocaleString() : "Never"}
            </dd>
          </div>
        </dl>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-border/70 p-3">
        <Button
          size="sm"
          variant="default"
          disabled={actions === null || channel.state === "paused"}
          onClick={() => {
            if (actions) void action(actions.syncChannel);
          }}
        >
          <RotateCcwIcon aria-hidden="true" />
          Sync now
        </Button>
        {channel.state === "paused" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={actions === null}
            onClick={() => {
              if (actions) void action(actions.resumeChannel);
            }}
          >
            <PlayIcon aria-hidden="true" />
            Resume
          </Button>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={actions === null}
            onClick={() => {
              if (actions) void action(actions.pauseChannel);
            }}
          >
            <PauseIcon aria-hidden="true" />
            Pause
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost-muted"
          disabled={actions === null}
          onClick={() => {
            if (actions) void action(actions.disconnectChannel);
          }}
        >
          <UnplugIcon aria-hidden="true" />
          Disconnect
        </Button>
      </div>
    </aside>
  );
}

function HarnessCanvasInner({
  snapshot,
  actions,
  onSelectAgent,
  selectedAgentId = null,
  className,
}: HarnessCanvasProps) {
  const [showArchivedCompleted, setShowArchivedCompleted] = useState(true);
  const [collapsedAgentIds, setCollapsedAgentIds] = useState<ReadonlySet<string>>(new Set());
  const [showDetails, setShowDetails] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [selectedChannelDetail, setSelectedChannelDetail] = useState<HarnessCanvasChannel | null>(
    null,
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<HarnessFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView } = useReactFlow();

  const visibleSnapshot = useMemo(
    () => selectHarnessCanvasGraph(snapshot, { collapsedAgentIds, showArchivedCompleted }),
    [collapsedAgentIds, showArchivedCompleted, snapshot],
  );
  const projectGroups = useMemo(() => projectCounts(visibleSnapshot), [visibleSnapshot]);

  const onCreateChild = useCallback(
    (agentId: string) => {
      if (actions) void actions.createChild(agentId);
    },
    [actions],
  );
  const onForkSidechat = useCallback(
    (agentId: string, completedTurnId: string) => {
      if (actions) void actions.forkSidechat(agentId, completedTurnId);
    },
    [actions],
  );
  const onToggleCollapsed = useCallback((agentId: string) => {
    setCollapsedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);
  const onToggleDetails = useCallback(
    (agentId: string) => {
      setShowDetails((current) => !current);
      onSelectAgent(snapshot.agents.find((agent) => agent.id === agentId) ?? snapshot.agents[0]!);
    },
    [onSelectAgent, snapshot.agents],
  );

  const callbacks = useMemo(
    () => ({
      onSelect: onSelectAgent,
      onCreateChild,
      onForkSidechat,
      onToggleCollapsed,
      onToggleDetails,
    }),
    [onCreateChild, onForkSidechat, onSelectAgent, onToggleCollapsed, onToggleDetails],
  );

  useEffect(() => {
    const nextNodes = makeFlowNodes(visibleSnapshot.agents, collapsedAgentIds, callbacks);
    setNodes((current) => mergeHarnessCanvasNodeState(current, nextNodes));
    setEdges(makeFlowEdges(visibleSnapshot.edges));
  }, [
    callbacks,
    collapsedAgentIds,
    setEdges,
    setNodes,
    visibleSnapshot.agents,
    visibleSnapshot.edges,
  ]);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (
        !actions ||
        !connection.source ||
        !connection.target ||
        connection.source === connection.target
      ) {
        return;
      }
      void actions.connect(connection.source, connection.target);
    },
    [actions],
  );

  const onNodeDragStop = useCallback(
    (_event: MouseEvent | TouchEvent, node: HarnessFlowNode, _nodes: HarnessFlowNode[]) => {
      if (!actions) return;
      void actions.updatePosition({ agentId: node.id, position: node.position });
    },
    [actions],
  );

  useEffect(() => {
    let cancelled = false;
    const summary = selectedChannelId
      ? (visibleSnapshot.channels.find((channel) => channel.id === selectedChannelId) ?? null)
      : null;
    if (selectedChannelId === null || actions === null || summary === null) {
      return () => {
        cancelled = true;
      };
    }
    void actions
      .loadChannel(selectedChannelId)
      .then((detail) => {
        if (!cancelled && detail !== null) setSelectedChannelDetail(detail);
      })
      .catch(() => {
        // The lightweight summary remains usable when a detail read is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [actions, selectedChannelId, visibleSnapshot.channels]);

  const selectedChannelSummary = selectedChannelId
    ? (visibleSnapshot.channels.find((channel) => channel.id === selectedChannelId) ?? null)
    : null;
  const selectedChannel =
    selectedChannelSummary === null
      ? null
      : selectedChannelDetail?.id === selectedChannelSummary.id
        ? selectedChannelDetail
        : selectedChannelSummary;
  const selectedChannelSource = selectedChannel
    ? visibleSnapshot.agents.find((agent) => agent.id === selectedChannel.sourceAgentId)
    : undefined;
  const selectedChannelTarget = selectedChannel
    ? visibleSnapshot.agents.find((agent) => agent.id === selectedChannel.targetAgentId)
    : undefined;
  const renderedNodes = useMemo(
    () => selectHarnessCanvasNodeSelection(nodes, selectedAgentId),
    [nodes, selectedAgentId],
  );

  return (
    <div
      className={cn(
        "relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-background",
        className,
      )}
    >
      <ReactFlow
        nodes={renderedNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStop={onNodeDragStop}
        onEdgeClick={(_event, edge) => {
          const channelId = (edge.data as { channelId?: string | null } | undefined)?.channelId;
          if (channelId) {
            setSelectedChannelDetail(
              visibleSnapshot.channels.find((channel) => channel.id === channelId) ?? null,
            );
            setSelectedChannelId(channelId);
          }
        }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2, minZoom: 0.35, maxZoom: 1.15 }}
        minZoom={0.2}
        maxZoom={1.8}
        nodesDraggable
        nodesConnectable={actions !== null}
        className="h-full w-full"
        defaultEdgeOptions={{ type: "default" }}
        aria-label="Harness agent canvas"
      >
        <Background gap={24} size={1} color="var(--border)" />
        <Controls showInteractive={false} position="bottom-left" />
        <MiniMap
          className="max-sm:hidden"
          nodeColor={(node) =>
            node.id === selectedAgentId ? "var(--primary)" : "var(--muted-foreground)"
          }
          maskColor="color-mix(in srgb, var(--background) 78%, transparent)"
          position="bottom-right"
          pannable
          zoomable
        />

        <Panel
          position="top-left"
          className="!m-4 !mt-3 flex max-w-[calc(100%-2rem)] flex-col gap-3"
        >
          <div className="surface-glass flex flex-wrap items-center gap-2 rounded-xl border border-border/70 px-3 py-2 shadow-sm">
            <div className="me-1 flex items-center gap-2">
              <LayoutDashboardIcon className="size-4 text-primary" aria-hidden="true" />
              <span className="text-sm font-semibold">Agent canvas</span>
              <span className="text-xs text-muted-foreground">
                {visibleSnapshot.agents.length}{" "}
                {visibleSnapshot.agents.length === 1 ? "agent" : "agents"}
              </span>
            </div>
            <div className="h-4 w-px bg-border/75" aria-hidden="true" />
            <Button
              size="xs"
              variant="ghost"
              onClick={() => fitView({ padding: 0.2, duration: 250 })}
              aria-label="Fit all agents in view"
            >
              <ArrowDownToLineIcon className="rotate-180" aria-hidden="true" />
              Fit view
            </Button>
            <Button
              size="xs"
              variant="ghost"
              onClick={() => {
                setCollapsedAgentIds(new Set());
                fitView({ padding: 0.2, duration: 250 });
              }}
              aria-label="Show all agent descendants"
            >
              <ChevronDownIcon aria-hidden="true" />
              Expand all
            </Button>
            <Button
              size="xs"
              variant={showArchivedCompleted ? "secondary" : "ghost"}
              onClick={() => setShowArchivedCompleted((current) => !current)}
              aria-pressed={showArchivedCompleted}
            >
              <ArchiveIcon aria-hidden="true" />
              {showArchivedCompleted ? "Hide archived" : "Show archived"}
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={actions === null}
              onClick={() => {
                if (actions) void actions.createAgent();
              }}
            >
              <PlusIcon aria-hidden="true" />
              New Codex agent
            </Button>
          </div>

          <div className="surface-glass flex flex-wrap items-center gap-2 rounded-xl border border-border/70 px-3 py-2 shadow-sm">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Projects
            </span>
            {projectGroups.length === 0 ? (
              <span className="text-xs text-muted-foreground">No agents yet</span>
            ) : (
              projectGroups.map((group) => (
                <Badge key={group.title} variant="outline" size="sm">
                  {group.title}
                  <span className="text-muted-foreground">{group.count}</span>
                </Badge>
              ))
            )}
          </div>

          <div className="surface-glass flex flex-wrap items-center gap-2 rounded-xl border border-border/70 px-3 py-2 shadow-sm">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Link2Icon className="size-3.5" aria-hidden="true" />
              Connect agents
            </span>
            <ConnectionSelector
              agents={visibleSnapshot.agents}
              onConnect={(source, target) => {
                if (actions) void actions.connect(source, target);
              }}
              disabled={actions === null}
            />
          </div>
        </Panel>

        <Panel position="bottom-left" className="!m-4 !mb-3">
          <div className="surface-glass flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border/70 px-3 py-2 text-[11px] text-muted-foreground shadow-sm">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-foreground/45" /> delegates
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-violet-400" /> side chat
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-sky-400" /> coordinates
            </span>
          </div>
        </Panel>
      </ReactFlow>

      {selectedChannel ? (
        <ChannelPanel
          channel={selectedChannel}
          source={selectedChannelSource}
          target={selectedChannelTarget}
          actions={actions}
          onClose={() => {
            setSelectedChannelId(null);
            setSelectedChannelDetail(null);
          }}
        />
      ) : null}

      {showDetails && !selectedChannel ? (
        <div className="absolute bottom-4 right-4 z-20 max-w-xs rounded-lg border border-border/70 bg-background/95 p-3 text-xs text-muted-foreground shadow-lg backdrop-blur">
          Select an agent to open its full chat controls. Select a labeled connection to inspect its
          transcript and decisions.
          <Button
            size="icon-micro"
            variant="ghost"
            className="absolute right-1 top-1"
            onClick={() => setShowDetails(false)}
            aria-label="Close canvas help"
          >
            <XIcon aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function HarnessCanvas(props: HarnessCanvasProps) {
  return (
    <ReactFlowProvider>
      <HarnessCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
