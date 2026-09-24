import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  HarnessAgent,
  HarnessAgentMetadata,
  HarnessCreateRelationshipDefinitionInput,
  HarnessSendCoordinationMessageInput,
  HarnessUpsertRelationshipInput,
} from "./harnessGraph.ts";
import { ThreadId } from "./baseSchemas.ts";
import { providerChildThreadId } from "./orchestration.ts";

const decodeAgent = Schema.decodeUnknownSync(HarnessAgent);
const decodeMetadata = Schema.decodeUnknownSync(HarnessAgentMetadata);
const decodeRelationship = Schema.decodeUnknownSync(HarnessCreateRelationshipDefinitionInput);
const decodeLink = Schema.decodeUnknownSync(HarnessUpsertRelationshipInput);
const decodeSend = Schema.decodeUnknownSync(HarnessSendCoordinationMessageInput);
describe("Harness MVP contracts", () => {
  const agent = {
    agentId: "agent-1",
    projectId: "project-1",
    displayName: "Implementor",
    kind: "root",
    roleDefinitionId: "role-1",
    status: "active",
    createdAt: "2026-10-04T00:00:00.000Z",
    updatedAt: "2026-10-04T00:00:00.000Z",
  };
  it("requires one explicit backing", () => {
    expect(() => decodeAgent(agent)).toThrow();
    expect(
      decodeAgent({ ...agent, backing: { kind: "thread", threadId: "thread-1" } }).backing,
    ).toEqual({ kind: "thread", threadId: "thread-1" });
  });
  it("accepts graph metadata without copying backing presentation or lifecycle", () => {
    const metadata = decodeMetadata({
      agentId: "agent-1",
      backing: { kind: "thread", threadId: "thread-1" },
      kind: "delegated",
      roleDefinitionId: "role-1",
      spawnedByAgentId: "parent-agent",
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    });
    expect(() => decodeAgent(metadata)).toThrow();
    expect(
      decodeAgent({
        ...metadata,
        projectId: "project-1",
        displayName: "Current thread title",
        status: "paused",
      }),
    ).toMatchObject({ displayName: "Current thread title", status: "paused" });
  });
  it("defines reusable behavior without enforcing role pairings", () => {
    expect(
      decodeRelationship({
        relationshipDefinitionId: "review",
        name: "Review",
        requestInstructions: "Ask for review.",
        responseInstructions: "Review the change.",
      }),
    ).toMatchObject({ name: "Review" });
  });
  it("connects agents through behavior without encoding their creation hierarchy", () => {
    const link = decodeLink({
      relationshipId: "review-link",
      sourceAgentId: "implementor",
      targetAgentId: "reviewer",
      relationshipDefinitionId: "review",
    });
    expect(link).toEqual({
      relationshipId: "review-link",
      sourceAgentId: "implementor",
      targetAgentId: "reviewer",
      relationshipDefinitionId: "review",
    });
  });
  it("accepts plain messages without a negotiation protocol", () => {
    expect(
      decodeSend({
        channelId: "channel-1",
        senderAgentId: "agent-1",
        authorKind: "agent",
        body: "Anything the agents need to discuss.",
        deduplicationKey: "message-1",
      }).body,
    ).toContain("Anything");
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

    expect("threadId" in agent).toBe(false);
    expect(agent.backing.kind).toBe("native");
    expect(agent.backing.kind === "native" ? agent.backing.threadId : undefined).toBe(
      "harness-child:thread-1:child-1",
    );
  });

  it("derives one stable T3 transcript id for a provider child", () => {
    expect(providerChildThreadId(ThreadId.make("thread-1"), "child-1")).toBe(
      "harness-child:thread-1:child-1",
    );
  });
});
