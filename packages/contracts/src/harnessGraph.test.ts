import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  HarnessCanvasPosition,
  HarnessConvergenceRound,
  HarnessAgent,
  HarnessSendCoordinationMessageInput,
} from "./harnessGraph.ts";

const decodeCanvasPosition = Schema.decodeUnknownSync(HarnessCanvasPosition);
const decodeConvergenceRound = Schema.decodeUnknownSync(HarnessConvergenceRound);
const decodeSendMessage = Schema.decodeUnknownSync(HarnessSendCoordinationMessageInput);
const decodeAgent = Schema.decodeUnknownSync(HarnessAgent);

describe("Harness graph contracts", () => {
  it("accepts finite canvas coordinates and bounds convergence rounds", () => {
    expect(
      decodeCanvasPosition({
        x: 120,
        y: -40,
        collapsed: false,
      }),
    ).toEqual({ x: 120, y: -40, collapsed: false });
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
      role: "delegated",
      status: "active",
      backing: {
        kind: "native",
        provider: "codex",
        providerInstanceId: "codex",
        providerAgentId: "child-1",
        parentThreadId: "thread-1",
        capabilities: ["inspect"],
      },
      canvas: { x: 100, y: 200, collapsed: false },
      createdAt: "2026-09-19T10:00:00.000Z",
      updatedAt: "2026-09-19T10:00:00.000Z",
    });

    expect(agent.threadId).toBeUndefined();
    expect(agent.backing?.kind).toBe("native");
  });
});
