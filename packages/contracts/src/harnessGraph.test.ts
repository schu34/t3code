import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  HarnessAgent,
  HarnessConvergenceRound,
  HarnessCreateRelationshipDefinitionInput,
  HarnessCoordinationMessageKind,
  HarnessSendCoordinationMessageInput,
} from "./harnessGraph.ts";
import { ThreadId } from "./baseSchemas.ts";
import { providerChildThreadId } from "./orchestration.ts";

const decodeAgent = Schema.decodeUnknownSync(HarnessAgent);
const decodeConvergenceRound = Schema.decodeUnknownSync(HarnessConvergenceRound);
const decodeSendMessage = Schema.decodeUnknownSync(HarnessSendCoordinationMessageInput);
const decodeMessageKind = Schema.decodeUnknownSync(HarnessCoordinationMessageKind);
const decodeRelationshipDefinition = Schema.decodeUnknownSync(
  HarnessCreateRelationshipDefinitionInput,
);

describe("Harness graph contracts", () => {
  it("uses structural agent kinds separately from custom role definitions", () => {
    expect(
      decodeAgent({
        agentId: "agent-1",
        threadId: "thread-1",
        projectId: "project-1",
        displayName: "Implementor",
        kind: "delegated",
        roleDefinitionId: "role-implementor",
        status: "active",
        createdAt: "2026-09-29T00:00:00.000Z",
        updatedAt: "2026-09-29T00:00:00.000Z",
      }),
    ).toMatchObject({ kind: "delegated", roleDefinitionId: "role-implementor" });
  });

  it("allows reusable directed role relationships with request and response instructions", () => {
    expect(
      decodeRelationshipDefinition({
        relationshipDefinitionId: "product-consultation",
        projectId: "project-1",
        name: "Product consultation",
        requesterRoleIds: ["role-implementor", "role-senior-engineer"],
        responderRoleIds: ["role-product-manager"],
        requestInstructions: "Ask for a product decision with relevant context.",
        responseInstructions: "Return a decision and rationale.",
      }),
    ).toMatchObject({
      requesterRoleIds: ["role-implementor", "role-senior-engineer"],
      responderRoleIds: ["role-product-manager"],
    });
  });

  it("accepts custom coordination labels and bounds convergence rounds", () => {
    expect(decodeMessageKind("custom-review-note")).toBe("custom-review-note");
    expect(decodeConvergenceRound(3)).toBe(3);
    expect(() => decodeConvergenceRound(4)).toThrow();
  });

  it("rejects a coordination message that tries to exceed the loop bound", () => {
    expect(() =>
      decodeSendMessage({
        channelId: "channel-1",
        senderAgentId: "agent-a",
        authorKind: "agent",
        kind: "update",
        body: "still working",
        deduplicationKey: "message-1",
        round: 4,
      }),
    ).toThrow();
  });

  it("distinguishes a provider-native child from a T3 thread", () => {
    const agent = decodeAgent({
      agentId: "native:child-1",
      projectId: "project-1",
      displayName: "Explore the code",
      kind: "delegated",
      roleDefinitionId: "role-general",
      status: "active",
      backing: {
        kind: "native",
        threadId: "harness-child:thread-1:child-1",
        provider: "codex",
        providerInstanceId: "codex",
        providerAgentId: "child-1",
        parentThreadId: "thread-1",
        capabilities: ["inspect"],
      },
      createdAt: "2026-09-19T10:00:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z",
    });

    expect(agent.threadId).toBeUndefined();
    expect(agent.backing?.kind).toBe("native");
    expect(agent.backing?.kind === "native" ? agent.backing.threadId : undefined).toBe(
      "harness-child:thread-1:child-1",
    );
  });

  it("derives one stable T3 transcript id for a provider child", () => {
    expect(providerChildThreadId(ThreadId.make("thread-1"), "child-1")).toBe(
      "harness-child:thread-1:child-1",
    );
  });
});
