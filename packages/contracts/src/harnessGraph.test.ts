import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  HarnessAgent,
  HarnessCreateRelationshipDefinitionInput,
  HarnessSendCoordinationMessageInput,
} from "./harnessGraph.ts";
const decodeAgent = Schema.decodeUnknownSync(HarnessAgent);
const decodeRelationship = Schema.decodeUnknownSync(HarnessCreateRelationshipDefinitionInput);
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
});
