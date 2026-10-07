import { describe, expect, it } from "vite-plus/test";

import {
  deriveHarnessDeliveryStage,
  deriveHarnessCreationEdges,
  deriveHarnessRuntimeState,
  layoutHarnessCanvasAgents,
  mergeHarnessCanvasNodeState,
  selectHarnessCanvasNodeSelection,
  selectHarnessCanvasGraph,
  type HarnessCanvasAgent,
  type HarnessCanvasSnapshot,
} from "./harnessCanvas.logic";

const baseThread = {
  environmentId: "env" as never,
  id: "thread" as never,
  projectId: "project" as never,
  title: "Agent",
  session: null,
  latestTurn: null,
  archivedAt: null,
  settledOverride: null,
} as const;

function agent(id: string, patch: Partial<HarnessCanvasAgent> = {}): HarnessCanvasAgent {
  return {
    id,
    kind: "root",
    parentAgentId: null,
    environmentId: "env" as never,
    backing: { kind: "thread", threadId: id as never },
    projectId: "project" as never,
    title: id,
    projectTitle: "Project",
    activity: "No active turn",
    runtimeState: "idle",
    deliveryStage: "implementing",
    archived: false,
    completed: false,
    unreadCount: 0,
    position: null,
    latestCompletedTurnId: null,
    ...patch,
  };
}

describe("harness canvas graph logic", () => {
  it("keeps execution state independent from delivery stage", () => {
    expect(
      deriveHarnessRuntimeState({
        ...baseThread,
        session: { status: "running", lastError: null },
        latestTurn: { turnId: "turn", state: "running", completedAt: null },
      }),
    ).toBe("working");
    expect(
      deriveHarnessRuntimeState({
        ...baseThread,
        hasActionableProposedPlan: true,
      }),
    ).toBe("blocked");
    expect(
      deriveHarnessDeliveryStage({
        ...baseThread,
        pullRequests: [{ snapshot: { state: "open", reviewDecision: "approved" } }],
      }),
    ).toBe("in-review");
  });

  it("preserves saved positions while laying out only unpositioned agents", () => {
    const laidOut = layoutHarnessCanvasAgents([
      { ...agent("saved"), position: { x: 900, y: 40 } },
      agent("new"),
    ]);
    expect(laidOut[0]?.position).toEqual({ x: 900, y: 40 });
    expect(laidOut[1]?.position).toEqual({ x: 80, y: 80 });
  });

  it("skips occupied fallback slots when graph-only agents join laid-out threads", () => {
    const laidOut = layoutHarnessCanvasAgents(
      [{ ...agent("saved"), position: { x: 80, y: 280 } }, agent("graph-only")],
      { topInset: 280 },
    );
    expect(laidOut[1]?.position).toEqual({ x: 380, y: 280 });
  });

  it("centers fresh delegation children in a row below their parent", () => {
    const laidOut = layoutHarnessCanvasAgents(
      [
        agent("parent"),
        agent("child-a", { kind: "delegated", parentAgentId: "parent" }),
        agent("child-b", { kind: "delegated", parentAgentId: "parent" }),
      ],
      {
        topInset: 280,
        columnWidth: 240,
        rowHeight: 160,
      },
    );
    expect(laidOut.find((entry) => entry.id === "parent")?.position).toEqual({ x: 80, y: 280 });
    expect(laidOut.find((entry) => entry.id === "child-a")?.position).toEqual({ x: -40, y: 440 });
    expect(laidOut.find((entry) => entry.id === "child-b")?.position).toEqual({ x: 200, y: 440 });
  });

  it("keeps saved delegation positions while laying out new siblings", () => {
    const laidOut = layoutHarnessCanvasAgents(
      [
        { ...agent("parent"), position: { x: 420, y: 180 } },
        {
          ...agent("saved-child", { kind: "delegated", parentAgentId: "parent" }),
          position: { x: 700, y: 370 },
        },
        agent("new-child", { kind: "delegated", parentAgentId: "parent" }),
      ],
      {
        columnWidth: 240,
        rowHeight: 160,
      },
    );
    expect(laidOut.find((entry) => entry.id === "saved-child")?.position).toEqual({
      x: 700,
      y: 370,
    });
    expect(laidOut.find((entry) => entry.id === "new-child")?.position).toEqual({ x: 540, y: 340 });
  });

  it("derives creation lines without making sidechats or communication peers descendants", () => {
    const agents = [
      agent("parent"),
      agent("child", { kind: "delegated", parentAgentId: "parent" }),
      agent("grandchild", { kind: "delegated", parentAgentId: "child" }),
      agent("sidechat", { kind: "sidechat", parentAgentId: "parent" }),
      agent("peer"),
      agent("orphan", { kind: "delegated", parentAgentId: "missing" }),
    ];
    expect(
      deriveHarnessCreationEdges(agents).map(({ source, target, kind }) => ({
        source,
        target,
        kind,
      })),
    ).toEqual([
      { source: "parent", target: "child", kind: "delegation" },
      { source: "child", target: "grandchild", kind: "delegation" },
      { source: "parent", target: "sidechat", kind: "sidechat" },
    ]);
    const snapshot: HarnessCanvasSnapshot = {
      agents,
      edges: [
        {
          id: "review",
          source: "parent",
          target: "peer",
          kind: "coordination",
        },
      ],
    };
    expect(
      selectHarnessCanvasGraph(snapshot, { collapsedAgentIds: new Set(["parent"]) }).agents.map(
        ({ id }) => id,
      ),
    ).toEqual(["parent", "sidechat", "peer", "orphan"]);
    expect(layoutHarnessCanvasAgents(agents).find(({ id }) => id === "child")?.position?.y).toBe(
      270,
    );
  });

  it("preserves React Flow measurements when graph nodes are rebuilt", () => {
    const current = [
      {
        id: "agent",
        position: { x: 80, y: 80 },
        measured: { width: 260, height: 188 },
        data: { activity: "old" },
      },
    ];
    const next = [
      {
        id: "agent",
        position: { x: 120, y: 90 },
        data: { activity: "new" },
      },
    ];

    expect(mergeHarnessCanvasNodeState(current, next)[0]).toEqual({
      id: "agent",
      position: { x: 120, y: 90 },
      measured: { width: 260, height: 188 },
      data: { activity: "new" },
    });
  });

  it("reuses controlled nodes when the selected agent has not changed", () => {
    const nodes = [{ id: "agent", selected: false }, { id: "other" }];
    expect(selectHarnessCanvasNodeSelection(nodes, null)[0]).toBe(nodes[0]);
    const selectedNodes = selectHarnessCanvasNodeSelection(nodes, "agent");
    expect(selectedNodes[0]).toMatchObject({
      id: "agent",
      selected: true,
    });
    expect(selectHarnessCanvasNodeSelection(selectedNodes, "agent")[0]).toBe(selectedNodes[0]);
  });

  it("hides archived agents and delegation descendants without hiding coordination peers", () => {
    const snapshot: HarnessCanvasSnapshot = {
      agents: [
        agent("parent"),
        agent("child", { kind: "delegated", parentAgentId: "parent" }),
        agent("peer"),
        { ...agent("archived"), archived: true },
      ],
      edges: [
        {
          id: "coordinates",
          source: "parent",
          target: "peer",
          kind: "coordination",
        },
      ],
    };

    const selected = selectHarnessCanvasGraph(snapshot, {
      collapsedAgentIds: new Set(["parent"]),
      showArchivedCompleted: false,
    });
    expect(selected.agents.map((entry) => entry.id)).toEqual(["parent", "peer"]);
    expect(selected.edges.map((entry) => entry.id)).toEqual(["coordinates"]);
  });
});
