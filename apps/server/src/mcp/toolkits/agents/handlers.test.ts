import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { Tool } from "effect/unstable/ai";

import { makeHarnessGraphStore } from "../../../harnessGraphStore.ts";
import { OrchestrationEngineService } from "../../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { AgentsToolkitHandlersLive } from "./handlers.ts";
import { AgentsToolkit } from "./tools.ts";

const SENDER = ThreadId.make("senior");
const RECIPIENT = ThreadId.make("junior");
const STRANGER = ThreadId.make("stranger");
const createdAt = "2026-10-04T00:00:00.000Z";

const insertThread = Effect.fnUntraced(function* (threadId: string, title: string) {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id, project_id, title, model_selection_json, runtime_mode, interaction_mode,
      created_at, updated_at
    )
    VALUES (
      ${threadId}, 'project', ${title}, '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access', 'default', ${createdAt}, ${createdAt}
    )
  `;
});

function shell(threadId: ThreadId): OrchestrationThreadShell {
  return {
    id: threadId,
    projectId: ProjectId.make("project"),
    title: threadId,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    pullRequests: [],
    latestTurn: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
  };
}

const makeHarness = Effect.fn("makeAgentsToolkitHarness")(function* () {
  yield* insertThread(SENDER, "Senior Eng");
  yield* insertThread(RECIPIENT, "Junior Eng");
  yield* insertThread(STRANGER, "Stranger");
  const store = yield* makeHarnessGraphStore(yield* PubSub.unbounded<void>());
  yield* store.setAgent({ threadId: RECIPIENT, parentThreadId: SENDER });

  const commands = yield* Ref.make<ReadonlyArray<OrchestrationCommand>>([]);
  const dependencies = Layer.mergeAll(
    Layer.mock(ProjectionSnapshotQuery)({
      getThreadShellById: (threadId) => Effect.succeed(Option.some(shell(threadId))),
    }),
    Layer.mock(OrchestrationEngineService)({
      readEvents: () => Stream.empty,
      dispatch: (command) =>
        Ref.update(commands, (recorded) => [...recorded, command]).pipe(Effect.as({ sequence: 1 })),
      streamDomainEvents: Stream.empty,
      latestSequence: Effect.succeed(0),
    }),
    Layer.succeed(SqlClient.SqlClient, yield* SqlClient.SqlClient),
  );
  const toolkit = yield* AgentsToolkit.pipe(
    Effect.provide(AgentsToolkitHandlersLive.pipe(Layer.provide(dependencies))),
  );
  const call = <Name extends keyof typeof AgentsToolkit.tools>(
    name: Name,
    params: Parameters<typeof toolkit.handle<Name>>[1],
  ) =>
    toolkit.handle(name, params).pipe(
      Stream.unwrap,
      Stream.runCollect,
      Effect.map(
        (chunk) => chunk.at(-1)!.result as Tool.Success<(typeof AgentsToolkit.tools)[Name]>,
      ),
      Effect.provideService(McpInvocationContext.McpInvocationContext, {
        environmentId: EnvironmentId.make("environment-1"),
        threadId: SENDER,
        providerSessionId: "provider-session-1",
        providerInstanceId: ProviderInstanceId.make("codex"),
        capabilities: new Set<McpInvocationContext.McpCapability>(["agents"]),
        issuedAt: 1,
      }),
    );
  return { commands, call };
});

describe("agents toolkit handlers", () => {
  it.effect("delivers a message to a connected agent as a turn in its thread", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const listed = yield* harness.call("list_connected_agents", {});
      expect(listed.agents.map((agent) => agent.threadId)).toEqual([RECIPIENT]);

      yield* harness.call("send_agent_message", { threadId: RECIPIENT, message: "Take auth." });
      expect(yield* Ref.get(harness.commands)).toMatchObject([
        {
          type: "thread.turn.start",
          threadId: RECIPIENT,
          runtimeMode: "approval-required",
          message: {
            role: "user",
            text: expect.stringMatching(
              /^<agent_message from="Senior Eng" thread_id="senior">\nTake auth\.\n<\/agent_message>\n\n.*send_agent_message/,
            ),
          },
        },
      ]);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeCrypto.layer))),
  );

  it.effect("refuses agents that are not connected", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness();
      const error = yield* harness
        .call("send_agent_message", { threadId: STRANGER, message: "Hi." })
        .pipe(Effect.flip);
      expect(error._tag).toBe("AgentNotConnectedError");
      expect(yield* Ref.get(harness.commands)).toEqual([]);
    }).pipe(Effect.provide(Layer.mergeAll(SqlitePersistenceMemory, NodeCrypto.layer))),
  );
});
