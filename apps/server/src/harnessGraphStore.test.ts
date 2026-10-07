import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { HarnessRoleId, ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeHarnessGraphStore } from "./harnessGraphStore.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";

const testLayer = Layer.mergeAll(SqlitePersistenceMemory, NodeCrypto.layer);

const createdAt = "2026-10-04T00:00:00.000Z";
const parent = ThreadId.make("parent");

const insertThread = Effect.fnUntraced(function* (threadId: string, projectId = "project") {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_threads (
      thread_id,
      project_id,
      title,
      model_selection_json,
      runtime_mode,
      interaction_mode,
      created_at,
      updated_at
    )
    VALUES (
      ${threadId},
      ${projectId},
      ${threadId},
      '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access',
      'default',
      ${createdAt},
      ${createdAt}
    )
  `;
});

const makeStore = Effect.fnUntraced(function* () {
  yield* insertThread(parent);
  return yield* makeHarnessGraphStore(yield* PubSub.unbounded<void>());
});

it.effect("reads every thread as an agent without writing graph metadata", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* makeStore();
    yield* insertThread("elsewhere", "other-project");
    yield* sql`
      UPDATE projection_threads
      SET
        title = 'Renamed',
        settled_override = 'settled'
      WHERE thread_id = ${parent}
    `;
    const graph = yield* store.read({ projectId: ProjectId.make("project") });
    assert.deepStrictEqual(graph.agents, [
      {
        threadId: parent,
        projectId: ProjectId.make("project"),
        displayName: "Renamed",
        status: "completed",
      },
    ]);
    assert.equal((yield* sql`SELECT * FROM harness_agents`).length, 0);
    assert.equal((yield* store.read()).agents.length, 2);

    yield* sql`DELETE FROM projection_threads WHERE thread_id = ${parent}`;
    assert.equal((yield* store.read({ projectId: ProjectId.make("project") })).agents.length, 0);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("sets roles freely but creation origin only once", () =>
  Effect.gen(function* () {
    const store = yield* makeStore();
    const child = ThreadId.make("child");
    yield* insertThread(child);
    const roleId = HarnessRoleId.make("reviewer");
    yield* store.createRole({ roleId, name: "Reviewer", instructions: "Review it." });

    yield* store.setAgent({
      threadId: child,
      parentThreadId: parent,
      forkedFromTurnId: TurnId.make("turn-1"),
    });
    yield* store.setAgent({ threadId: child, roleId });
    let agent = (yield* store.read()).agents.find((entry) => entry.threadId === child)!;
    assert.equal(agent.roleId, roleId);
    assert.equal(agent.parentThreadId, parent);
    assert.equal(agent.forkedFromTurnId, "turn-1");

    yield* store.setAgent({ threadId: child, roleId: null });
    agent = (yield* store.read()).agents.find((entry) => entry.threadId === child)!;
    assert.isUndefined(agent.roleId);
    assert.equal(agent.parentThreadId, parent);

    const reparent = yield* store
      .setAgent({ threadId: child, parentThreadId: ThreadId.make("other") })
      .pipe(Effect.flip);
    assert.equal(reparent._tag, "HarnessGraphValidationError");
    const cycle = yield* store
      .setAgent({ threadId: parent, parentThreadId: child })
      .pipe(Effect.flip);
    assert.equal(cycle._tag, "HarnessGraphValidationError");
  }).pipe(Effect.provide(testLayer)),
);

it.effect("links agents within a project and hides edges to deleted threads", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* makeStore();
    const reviewer = ThreadId.make("reviewer");
    yield* insertThread(reviewer);
    yield* insertThread("elsewhere", "other-project");

    yield* store.upsertEdge({ sourceThreadId: parent, targetThreadId: reviewer, label: "review" });
    yield* store.upsertEdge({ sourceThreadId: parent, targetThreadId: reviewer });
    const labels = (yield* store.read()).edges.map((edge) => edge.label ?? null);
    assert.deepStrictEqual(labels.toSorted(), [null, "review"]);

    const crossProject = yield* store
      .upsertEdge({ sourceThreadId: parent, targetThreadId: ThreadId.make("elsewhere") })
      .pipe(Effect.flip);
    assert.equal(crossProject._tag, "HarnessGraphValidationError");

    yield* sql`DELETE FROM projection_threads WHERE thread_id = ${reviewer}`;
    assert.equal((yield* store.read()).edges.length, 0);
  }).pipe(Effect.provide(testLayer)),
);
