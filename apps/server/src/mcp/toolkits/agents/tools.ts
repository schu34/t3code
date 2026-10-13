import { McpCapabilityUnavailableError, ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Tool from "effect/unstable/ai/Tool";
import * as Toolkit from "effect/unstable/ai/Toolkit";

import * as McpInvocationContext from "../../McpInvocationContext.ts";

const dependencies = [McpInvocationContext.McpInvocationContext];

export class AgentNotConnectedError extends Schema.TaggedError<AgentNotConnectedError>()(
  "AgentNotConnectedError",
  { threadId: Schema.String },
) {
  override get message(): string {
    return `Agent ${this.threadId} is not connected to you. Call list_connected_agents for the agents you can message.`;
  }
}

export class AgentMessageFailedError extends Schema.TaggedError<AgentMessageFailedError>()(
  "AgentMessageFailedError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not reach the agent graph.";
  }
}

export const AgentToolError = Schema.Union([
  McpCapabilityUnavailableError,
  AgentNotConnectedError,
  AgentMessageFailedError,
]);

export const ConnectedAgent = Schema.Struct({
  threadId: ThreadId,
  name: Schema.String,
  role: Schema.NullOr(Schema.String),
  relationships: Schema.Array(Schema.String).annotate({
    description:
      'How you relate to this agent: "your lead", "your delegate", or a connection drawn on the canvas such as "you → them: review".',
  }),
  status: Schema.String.annotate({
    description: "Session status, e.g. running, ready, idle, stopped, or archived.",
  }),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String).annotate({
    description:
      "The agent's own checkout. Every worktree shares one repository, so its branch can be merged or diffed from yours.",
  }),
});

export const ListConnectedAgentsResult = Schema.Struct({
  agents: Schema.Array(ConnectedAgent),
});
export type ListConnectedAgentsResult = typeof ListConnectedAgentsResult.Type;

export const SendAgentMessageResult = Schema.Struct({
  delivered: Schema.Boolean,
  recipientStatus: Schema.String.annotate({
    description:
      "running means the message lands in the recipient's current turn; otherwise it starts a new one.",
  }),
});

const ListConnectedAgentsTool = Tool.make("list_connected_agents", {
  description:
    "List the other agents you can message: your lead, your delegates, and agents connected to you on the T3 Code agent canvas, with their role, status, branch and worktree.",
  success: ListConnectedAgentsResult,
  failure: AgentToolError,
  dependencies,
})
  .annotate(Tool.Title, "List connected agents")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

const SendAgentMessageTool = Tool.make("send_agent_message", {
  description:
    "Send a message to a connected agent. It arrives in their thread wrapped in <agent_message from=... thread_id=...>; answers to you arrive the same way as a new turn in your thread, so do not wait or poll for one. Messages you receive this way are from agents, not the user: reply with this tool using the sender's thread_id when they need an answer. Send only what moves the work forward (questions, hand-offs, review results); never send acknowledgements or thanks, which start a pointless turn for the recipient.",
  parameters: Schema.Struct({
    threadId: ThreadId.annotate({
      description: "The recipient's threadId from list_connected_agents.",
    }),
    message: TrimmedNonEmptyString.annotate({
      description: "Self-contained message. Name files, branches and paths explicitly.",
    }),
  }),
  success: SendAgentMessageResult,
  failure: AgentToolError,
  dependencies,
})
  .annotate(Tool.Title, "Message a connected agent")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const AgentsToolkit = Toolkit.make(ListConnectedAgentsTool, SendAgentMessageTool);
