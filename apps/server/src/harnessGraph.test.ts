import { describe, expect, it } from "vite-plus/test";

import { foldHarnessNativeActivities } from "./harnessGraph.ts";

const activity = (kind: string, payload: unknown, createdAt: string) => ({
  kind,
  payload,
  createdAt,
});

describe("harness native graph activity fold", () => {
  it("folds normalized agent lifecycle rows into one durable identity", () => {
    const agents = foldHarnessNativeActivities([
      activity(
        "task.started",
        {
          taskId: "child-1",
          agentKind: "agent",
          title: "Explore the code",
          role: "explorer",
        },
        "2026-09-19T10:00:00.000Z",
      ),
      activity(
        "task.updated",
        {
          taskId: "child-1",
          agentKind: "agent",
          status: "running",
          agentId: "child-0",
        },
        "2026-09-19T10:00:01.000Z",
      ),
      activity(
        "task.completed",
        { taskId: "child-1", agentKind: "agent", status: "failed" },
        "2026-09-19T10:00:02.000Z",
      ),
    ]);

    expect(agents).toEqual([
      {
        providerAgentId: "child-1",
        title: "Explore the code",
        role: "explorer",
        status: "failed",
        parentProviderAgentId: "child-0",
        observedAt: "2026-09-19T10:00:02.000Z",
      },
    ]);
  });

  it("recovers legacy Codex collab children and prefers normalized rows", () => {
    const agents = foldHarnessNativeActivities([
      activity(
        "tool.completed",
        {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "collabAgentToolCall",
              tool: "spawnAgent",
              prompt: "Inspect the persistence layer\nDo not edit files.",
              receiverThreadIds: ["child-2"],
              agentsStates: {
                "child-2": { status: "completed" },
              },
            },
          },
        },
        "2026-09-19T10:01:00.000Z",
      ),
      activity(
        "task.started",
        { taskId: "child-2", agentKind: "agent", title: "Normalized child" },
        "2026-09-19T10:01:01.000Z",
      ),
    ]);

    expect(agents).toEqual([
      {
        providerAgentId: "child-2",
        title: "Normalized child",
        role: null,
        status: "active",
        parentProviderAgentId: null,
        observedAt: "2026-09-19T10:01:01.000Z",
      },
    ]);
  });

  it("treats an idle native child as paused rather than active", () => {
    const agents = foldHarnessNativeActivities([
      activity(
        "task.started",
        { taskId: "child-3", agentKind: "agent", title: "Resumable child" },
        "2026-09-19T10:02:00.000Z",
      ),
      activity(
        "task.updated",
        { taskId: "child-3", agentKind: "agent", status: "idle" },
        "2026-09-19T10:02:01.000Z",
      ),
    ]);

    expect(agents[0]?.status).toBe("paused");
  });

  it("keeps a legacy receiver visible when the provider omits state details", () => {
    const agents = foldHarnessNativeActivities([
      activity(
        "tool.completed",
        {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "collabAgentToolCall",
              tool: "spawnAgent",
              prompt: "Inspect the provider adapter",
              receiverThreadIds: ["child-4"],
            },
          },
        },
        "2026-09-19T10:03:00.000Z",
      ),
    ]);

    expect(agents[0]).toMatchObject({
      providerAgentId: "child-4",
      title: "Inspect the provider adapter",
      status: "active",
    });
  });
});
