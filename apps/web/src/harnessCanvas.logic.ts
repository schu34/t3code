import type {
  EnvironmentId,
  OrchestrationProjectShell,
  OrchestrationThreadShell,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";

export type HarnessCanvasProject = OrchestrationProjectShell & {
  readonly environmentId: EnvironmentId;
};

export type HarnessCanvasThreadShell = OrchestrationThreadShell & {
  readonly environmentId: EnvironmentId;
};

/**
 * Execution and delivery are deliberately separate dimensions. A running
 * agent may already have a pull request in review, and the canvas must keep
 * those facts visible at the same time.
 */
export type HarnessRuntimeState =
  | "queued"
  | "working"
  | "waiting"
  | "blocked"
  | "idle"
  | "stopped"
  | "failed";

export type HarnessDeliveryStage =
  | "implementing"
  | "pr-open"
  | "in-review"
  | "changes-requested"
  | "merged";

export type HarnessEdgeKind = "delegation" | "sidechat" | "coordination";

export type HarnessChannelState = "syncing" | "aligned" | "needs-attention" | "paused";

export interface HarnessCanvasPosition {
  readonly x: number;
  readonly y: number;
}

export interface HarnessCanvasLayoutOptions {
  readonly columnWidth?: number;
  readonly rowHeight?: number;
  readonly leftInset?: number;
  readonly topInset?: number;
  /** Delegation edges give fresh children a stable row below their parent. */
  readonly edges?: ReadonlyArray<Pick<HarnessCanvasEdge, "source" | "target" | "kind">>;
}

export interface HarnessCanvasAgent {
  readonly id: string;
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly draftId?: string;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly projectTitle: string;
  readonly activity: string;
  readonly runtimeState: HarnessRuntimeState;
  readonly deliveryStage: HarnessDeliveryStage;
  readonly archived: boolean;
  readonly completed: boolean;
  readonly unreadCount: number;
  readonly position: HarnessCanvasPosition | null;
  readonly latestCompletedTurnId: string | null;
}

export interface HarnessCanvasEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: HarnessEdgeKind;
  readonly channelId: string | null;
}

export interface HarnessChannelMessage {
  readonly id: string;
  readonly authorAgentId: string;
  readonly text: string;
  readonly createdAt: string;
}

export interface HarnessChannelDecision {
  readonly id: string;
  readonly text: string;
  readonly revision: number;
  readonly createdAt: string;
}

export interface HarnessCanvasChannel {
  readonly id: string;
  readonly sourceAgentId: string;
  readonly targetAgentId: string;
  readonly topic: string;
  readonly state: HarnessChannelState;
  readonly revision: number;
  readonly messageCount: number;
  readonly transcript: ReadonlyArray<HarnessChannelMessage>;
  readonly decisions: ReadonlyArray<HarnessChannelDecision>;
  readonly lastSyncedAt: string | null;
}

export interface HarnessCanvasSnapshot {
  readonly revision: number;
  readonly agents: ReadonlyArray<HarnessCanvasAgent>;
  readonly edges: ReadonlyArray<HarnessCanvasEdge>;
  readonly channels: ReadonlyArray<HarnessCanvasChannel>;
}

export interface HarnessCanvasPositionUpdate {
  readonly agentId: string;
  readonly position: HarnessCanvasPosition;
}

/** Actions are effects owned by the graph service, never local demo state. */
export interface HarnessCanvasActions {
  readonly updatePosition: (update: HarnessCanvasPositionUpdate) => Promise<void>;
  readonly createAgent: () => Promise<void>;
  readonly createChild: (agentId: string) => Promise<void>;
  readonly forkSidechat: (agentId: string, completedTurnId: string) => Promise<void>;
  readonly connect: (sourceAgentId: string, targetAgentId: string) => Promise<void>;
  readonly loadChannel: (channelId: string) => Promise<HarnessCanvasChannel | null>;
  readonly syncChannel: (channelId: string) => Promise<void>;
  readonly pauseChannel: (channelId: string) => Promise<void>;
  readonly resumeChannel: (channelId: string) => Promise<void>;
  readonly disconnectChannel: (channelId: string) => Promise<void>;
  readonly sendCoordination: (channelId: string, body: string) => Promise<void>;
}

export interface HarnessCanvasThreadLike {
  readonly environmentId: EnvironmentId;
  readonly id: ThreadId;
  readonly projectId: ProjectId;
  readonly title: string;
  readonly modelSelection?: unknown | undefined;
  readonly session:
    | {
        readonly status: string;
        readonly lastError?: string | null;
      }
    | null
    | undefined;
  readonly latestTurn:
    | {
        readonly turnId: string;
        readonly state: string;
        readonly completedAt: string | null;
      }
    | null
    | undefined;
  readonly archivedAt: string | null | undefined;
  readonly settledOverride?: "settled" | "active" | null;
  readonly hasPendingApprovals?: boolean | undefined;
  readonly hasPendingUserInput?: boolean | undefined;
  readonly hasActionableProposedPlan?: boolean | undefined;
  readonly backgroundLiveness?: "working" | "monitoring" | null | undefined;
  readonly planProgress?:
    | {
        readonly step: string;
      }
    | null
    | undefined;
  readonly pullRequests?:
    | ReadonlyArray<{
        readonly snapshot: {
          readonly state: string;
          readonly reviewDecision?: string | null;
        } | null;
      }>
    | undefined;
}

export function harnessAgentId(environmentId: EnvironmentId, threadId: ThreadId): string {
  return `${environmentId}\u0000${threadId}`;
}

export function deriveHarnessRuntimeState(thread: HarnessCanvasThreadLike): HarnessRuntimeState {
  if (thread.session?.status === "error" || thread.session?.lastError) {
    return "failed";
  }
  if (thread.session?.status === "starting" || thread.session?.status === "running") {
    return "working";
  }
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) {
    return "waiting";
  }
  if (thread.hasActionableProposedPlan) {
    return "blocked";
  }
  if (thread.backgroundLiveness === "working") {
    return "working";
  }
  if (thread.latestTurn?.state === "running") {
    return "working";
  }
  if (thread.settledOverride === "settled" || thread.archivedAt !== null) {
    return "stopped";
  }
  if (thread.session?.status === "stopped" || thread.session?.status === "interrupted") {
    return "stopped";
  }
  return "idle";
}

export function deriveHarnessDeliveryStage(thread: HarnessCanvasThreadLike): HarnessDeliveryStage {
  const pullRequest = thread.pullRequests?.find((entry) => entry.snapshot !== null)?.snapshot;
  if (pullRequest === null || pullRequest === undefined) {
    return "implementing";
  }
  const state = pullRequest.state.toLowerCase();
  if (state === "merged") {
    return "merged";
  }
  const reviewDecision = pullRequest.reviewDecision?.toLowerCase() ?? "";
  if (reviewDecision.includes("changes")) {
    return "changes-requested";
  }
  if (
    reviewDecision.includes("approved") ||
    reviewDecision.includes("review") ||
    reviewDecision === "pending"
  ) {
    return "in-review";
  }
  return "pr-open";
}

export function deriveHarnessActivity(thread: HarnessCanvasThreadLike): string {
  if (thread.hasPendingApprovals) return "Waiting for approval";
  if (thread.hasPendingUserInput) return "Waiting for input";
  if (thread.planProgress?.step) return thread.planProgress.step;
  if (thread.backgroundLiveness === "monitoring") return "Monitoring work";
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "Running turn";
  }
  if (thread.session?.lastError) return thread.session.lastError;
  if (thread.latestTurn?.state === "completed") return "Ready for the next task";
  return "No active turn";
}

export function layoutHarnessCanvasAgents(
  agents: ReadonlyArray<HarnessCanvasAgent>,
  options: HarnessCanvasLayoutOptions = {},
): ReadonlyArray<HarnessCanvasAgent> {
  const columnWidth = options.columnWidth ?? 300;
  const rowHeight = options.rowHeight ?? 190;
  const leftInset = options.leftInset ?? 80;
  const topInset = options.topInset ?? 80;
  const agentIds = new Set(agents.map((agent) => agent.id));
  const delegationEdges = (options.edges ?? []).filter(
    (edge) => edge.kind === "delegation" && agentIds.has(edge.source) && agentIds.has(edge.target),
  );
  const delegatedIds = new Set(delegationEdges.map((edge) => edge.target));
  const gridAgents =
    delegationEdges.length === 0 ? agents : agents.filter((agent) => !delegatedIds.has(agent.id));
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(gridAgents.length, 1))));
  const occupied = new Set(
    agents.flatMap((agent) =>
      agent.position === null ? [] : [`${agent.position.x}\u0000${agent.position.y}`],
    ),
  );
  let layoutIndex = 0;

  const laidOut = agents.map((agent) => {
    if (agent.position !== null || delegatedIds.has(agent.id)) return agent;
    let index = layoutIndex;
    let position = {
      x: leftInset + (index % columns) * columnWidth,
      y: topInset + Math.floor(index / columns) * rowHeight,
    };
    while (occupied.has(`${position.x}\u0000${position.y}`)) {
      index = ++layoutIndex;
      position = {
        x: leftInset + (index % columns) * columnWidth,
        y: topInset + Math.floor(index / columns) * rowHeight,
      };
    }
    layoutIndex += 1;
    return {
      ...agent,
      position,
    };
  });

  if (delegationEdges.length === 0) return laidOut;

  const agentOrder = new Map(agents.map((agent, index) => [agent.id, index] as const));
  const childrenByParent = new Map<string, string[]>();
  for (const edge of delegationEdges) {
    const children = childrenByParent.get(edge.source) ?? [];
    if (!children.includes(edge.target)) children.push(edge.target);
    childrenByParent.set(edge.source, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => (agentOrder.get(left) ?? 0) - (agentOrder.get(right) ?? 0));
  }

  const positionById = new Map(laidOut.map((agent) => [agent.id, agent.position] as const));
  const placeChildren = (parentId: string, ancestors: ReadonlySet<string>): void => {
    const parentPosition = positionById.get(parentId);
    const childIds = childrenByParent.get(parentId);
    if (parentPosition === null || parentPosition === undefined || childIds === undefined) return;

    const nextAncestors = new Set(ancestors);
    nextAncestors.add(parentId);
    const center = (childIds.length - 1) / 2;
    childIds.forEach((childId, childIndex) => {
      if (nextAncestors.has(childId)) return;
      if (positionById.get(childId) === null) {
        positionById.set(childId, {
          x: parentPosition.x + (childIndex - center) * columnWidth,
          y: parentPosition.y + rowHeight,
        });
      }
      placeChildren(childId, nextAncestors);
    });
  };

  for (const agent of laidOut) placeChildren(agent.id, new Set());

  return laidOut.map((agent) => {
    const position = positionById.get(agent.id);
    return position === undefined || position === agent.position ? agent : { ...agent, position };
  });
}

/**
 * React Flow owns measured dimensions on its controlled node state. Preserve
 * those fields when a graph snapshot changes so a subscription update cannot
 * hide nodes while the DOM is being measured again.
 */
export function mergeHarnessCanvasNodeState<T extends { readonly id: string }>(
  current: ReadonlyArray<T>,
  next: ReadonlyArray<T>,
): T[] {
  const currentById = new Map(current.map((node) => [node.id, node] as const));
  return next.map((node) => {
    const previous = currentById.get(node.id);
    return previous === undefined ? node : ({ ...previous, ...node } as T);
  });
}

/** Keep controlled node identity stable when the externally selected agent is unchanged. */
export function selectHarnessCanvasNodeSelection<
  T extends { readonly id: string; readonly selected?: boolean },
>(nodes: ReadonlyArray<T>, selectedAgentId: string | null): T[] {
  let selectionChanged = false;
  const next = nodes.map((node) => {
    const shouldBeSelected = node.id === selectedAgentId;
    const isSelected = node.selected === true;
    const isUnselected = node.selected === undefined || node.selected === false;
    if ((shouldBeSelected && isSelected) || (!shouldBeSelected && isUnselected)) {
      return node;
    }
    selectionChanged = true;
    return { ...node, selected: shouldBeSelected } as T;
  });
  return selectionChanged ? next : [...nodes];
}

function descendantsOf(
  rootId: string,
  edges: ReadonlyArray<HarnessCanvasEdge>,
): ReadonlySet<string> {
  const descendants = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) continue;
    for (const edge of edges) {
      if (edge.kind !== "delegation" || edge.source !== current || descendants.has(edge.target)) {
        continue;
      }
      descendants.add(edge.target);
      pending.push(edge.target);
    }
  }
  return descendants;
}

export function selectHarnessCanvasGraph(
  snapshot: HarnessCanvasSnapshot,
  options: {
    readonly collapsedAgentIds?: ReadonlySet<string>;
    readonly showArchivedCompleted?: boolean;
  } = {},
): HarnessCanvasSnapshot {
  const hiddenIds = new Set<string>();
  for (const agent of snapshot.agents) {
    if (!options.showArchivedCompleted && (agent.archived || agent.completed)) {
      hiddenIds.add(agent.id);
    }
  }
  for (const id of options.collapsedAgentIds ?? []) {
    for (const descendant of descendantsOf(id, snapshot.edges)) {
      hiddenIds.add(descendant);
    }
  }
  const agents = snapshot.agents.filter((agent) => !hiddenIds.has(agent.id));
  const visibleIds = new Set(agents.map((agent) => agent.id));
  const edges = snapshot.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );
  const channels = snapshot.channels.filter(
    (channel) => visibleIds.has(channel.sourceAgentId) && visibleIds.has(channel.targetAgentId),
  );
  return { ...snapshot, agents, edges, channels };
}

export function buildHarnessCanvasSnapshotFromThreads(
  threads: ReadonlyArray<HarnessCanvasThreadShell>,
  projects: ReadonlyArray<HarnessCanvasProject>,
  positions: ReadonlyMap<string, HarnessCanvasPosition> = new Map(),
  layoutOptions: HarnessCanvasLayoutOptions = {},
): HarnessCanvasSnapshot {
  const projectsByKey = new Map(
    projects.map((project) => [`${project.environmentId}\u0000${project.id}`, project] as const),
  );
  const agents = threads.map((thread) => {
    const id = harnessAgentId(thread.environmentId, thread.id);
    const project = projectsByKey.get(`${thread.environmentId}\u0000${thread.projectId}`);
    const latestTurn = thread.latestTurn;
    return {
      id,
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title,
      projectTitle: project?.title ?? "Unknown project",
      activity: deriveHarnessActivity(thread as unknown as HarnessCanvasThreadLike),
      runtimeState: deriveHarnessRuntimeState(thread as unknown as HarnessCanvasThreadLike),
      deliveryStage: deriveHarnessDeliveryStage(thread as unknown as HarnessCanvasThreadLike),
      archived: thread.archivedAt !== null,
      completed: thread.settledOverride === "settled",
      unreadCount: 0,
      position: positions.get(id) ?? null,
      latestCompletedTurnId: latestTurn?.state === "completed" ? latestTurn.turnId : null,
    } satisfies HarnessCanvasAgent;
  });
  return {
    revision: 0,
    agents: layoutHarnessCanvasAgents(agents, layoutOptions),
    edges: [],
    channels: [],
  };
}
