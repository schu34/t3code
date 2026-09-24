import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  HarnessCanvasPosition,
  HarnessConvergenceRound,
  HarnessSendCoordinationMessageInput,
} from "./harnessGraph.ts";

const decodeCanvasPosition = Schema.decodeUnknownSync(HarnessCanvasPosition);
const decodeConvergenceRound = Schema.decodeUnknownSync(HarnessConvergenceRound);
const decodeSendMessage = Schema.decodeUnknownSync(HarnessSendCoordinationMessageInput);

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
});
