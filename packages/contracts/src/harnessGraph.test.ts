import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { HarnessAgent, HarnessSetAgentInput, HarnessUpsertEdgeInput } from "./harnessGraph.ts";

const decodeAgent = Schema.decodeUnknownSync(HarnessAgent);
const decodeSetAgent = Schema.decodeUnknownSync(HarnessSetAgentInput);
const decodeEdge = Schema.decodeUnknownSync(HarnessUpsertEdgeInput);

describe("Harness graph contracts", () => {
  it("treats a bare thread as a root agent with no role", () => {
    const agent = decodeAgent({
      threadId: "thread-1",
      projectId: "project-1",
      displayName: "Implementor",
      status: "active",
    });
    expect(agent.roleId).toBeUndefined();
    expect(agent.parentThreadId).toBeUndefined();
  });

  it("distinguishes clearing a role from leaving it unchanged", () => {
    expect(decodeSetAgent({ threadId: "thread-1", roleId: null }).roleId).toBeNull();
    expect("roleId" in decodeSetAgent({ threadId: "thread-1" })).toBe(false);
  });

  it("links agents without behavior or creation semantics", () => {
    expect(decodeEdge({ sourceThreadId: "implementor", targetThreadId: "reviewer" })).toEqual({
      sourceThreadId: "implementor",
      targetThreadId: "reviewer",
    });
  });
});
