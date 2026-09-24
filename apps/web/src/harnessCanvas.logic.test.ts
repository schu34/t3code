import { describe, expect, it } from "vite-plus/test";

import {
  deriveHarnessDeliveryStage,
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

function agent(id: string): HarnessCanvasAgent {
  return {
    id,
    environmentId: "env" as never,
    threadId: id as never,
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
      [agent("parent"), agent("child-a"), agent("child-b")],
      {
        topInset: 280,
        columnWidth: 240,
        rowHeight: 160,
        edges: [
          {
            id: "delegates-a",
            source: "parent",
            target: "child-a",
            kind: "delegation",
            channelId: null,
          },
          {
            id: "delegates-b",
            source: "parent",
            target: "child-b",
            kind: "delegation",
            channelId: null,
          },
        ],
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
        { ...agent("saved-child"), position: { x: 700, y: 370 } },
        agent("new-child"),
      ],
      {
        columnWidth: 240,
        rowHeight: 160,
        edges: [
          {
            id: "delegates-saved",
            source: "parent",
            target: "saved-child",
            kind: "delegation",
            channelId: null,
          },
          {
            id: "delegates-new",
            source: "parent",
            target: "new-child",
            kind: "delegation",
            channelId: null,
          },
        ],
      },
    );
    expect(laidOut.find((entry) => entry.id === "saved-child")?.position).toEqual({
      x: 700,
      y: 370,
    });
    expect(laidOut.find((entry) => entry.id === "new-child")?.position).toEqual({ x: 540, y: 340 });
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
      revision: 2,
      agents: [
        agent("parent"),
        agent("child"),
        agent("peer"),
        { ...agent("archived"), archived: true },
      ],
      edges: [
        { id: "delegates", source: "parent", target: "child", kind: "delegation", channelId: null },
        {
          id: "coordinates",
          source: "parent",
          target: "peer",
          kind: "coordination",
          channelId: "channel",
        },
      ],
      channels: [],
    };

    const selected = selectHarnessCanvasGraph(snapshot, {
      collapsedAgentIds: new Set(["parent"]),
      showArchivedCompleted: false,
    });
    expect(selected.agents.map((entry) => entry.id)).toEqual(["parent", "peer"]);
    expect(selected.edges.map((entry) => entry.id)).toEqual(["coordinates"]);
  });
});
