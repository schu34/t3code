import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { readHarnessConnections, type HarnessConnections } from "../../../harnessGraphStore.ts";
import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AgentMessageFailedError, AgentNotConnectedError, AgentsToolkit } from "./tools.ts";

const attribute = (value: string) => value.replaceAll(/["\n\r]/g, " ").trim();

// Agents otherwise assume their final answer reaches the sender and end the turn without
// handing off.
const AGENT_MESSAGE_FOOTER =
  "Your final answer in this turn is not seen by the sender. Use send_agent_message to reply, or to hand off to the next agent if your role says to.";

/** The text a recipient sees; the tag tells it who wrote the message and where to answer. */
export function formatAgentMessage(
  sender: HarnessConnections["self"],
  senderThreadId: ThreadId,
  message: string,
): string {
  const from = attribute(sender?.name ?? "Agent");
  const role = sender?.role ? ` role="${attribute(sender.role)}"` : "";
  return `<agent_message from="${from}"${role} thread_id="${senderThreadId}">\n${message}\n</agent_message>\n\n${AGENT_MESSAGE_FOOTER}`;
}

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;

  const connectionsOf = (threadId: ThreadId) =>
    readHarnessConnections(threadId).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError((cause) => new AgentMessageFailedError({ cause })),
    );
  const uuid = crypto.randomUUIDv4.pipe(Effect.orDie);

  return AgentsToolkit.of({
    list_connected_agents: () =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("agents");
        const { connections } = yield* connectionsOf(scope.threadId);
        return { agents: connections };
      }),
    send_agent_message: ({ threadId, message }) =>
      Effect.gen(function* () {
        const scope = yield* McpInvocationContext.requireMcpCapability("agents");
        const { self, connections } = yield* connectionsOf(scope.threadId);
        const recipient = connections.find((agent) => agent.threadId === threadId);
        if (recipient === undefined) return yield* new AgentNotConnectedError({ threadId });
        const thread = yield* snapshots.getThreadShellById(threadId).pipe(
          Effect.mapError((cause) => new AgentMessageFailedError({ cause })),
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.fail(new AgentNotConnectedError({ threadId })),
              onSome: Effect.succeed,
            }),
          ),
        );
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: CommandId.make(`server:mcp-agent-message:${threadId}:${yield* uuid}`),
            threadId,
            message: {
              messageId: MessageId.make(yield* uuid),
              role: "user",
              text: formatAgentMessage(self, scope.threadId, message),
              attachments: [],
            },
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: DateTime.formatIso(yield* DateTime.now),
          })
          .pipe(Effect.mapError((cause) => new AgentMessageFailedError({ cause })));
        return { delivered: true, recipientStatus: recipient.status };
      }),
  });
});

export const AgentsToolkitHandlersLive = AgentsToolkit.toLayer(make);
