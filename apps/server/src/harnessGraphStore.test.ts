import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { HarnessRoleDefinitionId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { makeHarnessGraphStore } from "./harnessGraphStore.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "./orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "./orchestration/ThreadPlanProgress.ts";
import { SqlitePersistenceMemory } from "./persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "./project/RepositoryIdentityResolver.ts";

const testLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(
    Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
      resolve: () => Effect.succeed(null),
    }),
  ),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeCrypto.layer),
);

const createdAt = "2026-10-04T00:00:00.000Z";
const updatedAt = "2026-10-04T00:01:00.000Z";
const encodePayload = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const seedParent = Effect.fnUntraced(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    INSERT INTO projection_projects (
      project_id,
      title,
      workspace_root,
      scripts_json,
      created_at,
      updated_at
    )
    VALUES (
      'project',
      'Project',
      '/tmp/harness-metadata-test',
      '[]',
      ${createdAt},
      ${createdAt}
    )
  `;
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
      'parent',
      'project',
      'Parent',
      '{"instanceId":"codex","model":"gpt-5.4"}',
      'full-access',
      'default',
      ${createdAt},
      ${createdAt}
    )
  `;
  return yield* makeHarnessGraphStore(yield* PubSub.unbounded<void>());
});

it.effect("derives a thread agent view without changing graph metadata", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* seedParent();
    const initial = yield* store.read();
    const metadataBefore = yield* sql`SELECT * FROM harness_agents`;
    yield* sql`
      UPDATE projection_threads
      SET
        title = 'Renamed backing',
        settled_override = 'settled',
        updated_at = ${updatedAt}
      WHERE thread_id = 'parent'
    `;
    const current = yield* store.read();
    assert.equal(current.agents[0]?.displayName, "Renamed backing");
    assert.equal(current.agents[0]?.status, "completed");
    assert.equal(current.agents[0]?.updatedAt, updatedAt);
    assert.equal(current.agents[0]?.agentId, initial.agents[0]?.agentId);
    assert.deepStrictEqual(yield* sql`SELECT * FROM harness_agents`, metadataBefore);
    assert.equal(current.revision, initial.revision);
  }).pipe(Effect.provide(testLayer)),
);

it.effect("derives native lifecycle changes while preserving graph role and origin", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const store = yield* seedParent();
    const appendActivity = Effect.fnUntraced(function* (
      sequence: number,
      status: string,
      title: string,
      timestamp: string,
    ) {
      const payload = encodePayload({ taskId: "child", agentKind: "agent", title, status });
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id,
          thread_id,
          sequence,
          tone,
          kind,
          summary,
          payload_json,
          created_at
        )
        VALUES (
          ${`activity-${sequence}`},
          'parent',
          ${sequence},
          'info',
          'task.updated',
          'Child activity',
          ${payload},
          ${timestamp}
        )
      `;
    });
    yield* appendActivity(1, "running", "Explore", createdAt);
    const initial = yield* store.read();
    const child = initial.agents.find((agent) => agent.backing.kind === "native")!;
    assert.equal(child.displayName, "Explore");
    assert.equal(child.status, "active");
    assert.equal(child.spawnedByAgentId, "parent");
    const roleDefinitionId = HarnessRoleDefinitionId.make("reviewer");
    yield* store.createRole({
      roleDefinitionId,
      name: "Reviewer",
      instructions: "Review carefully.",
    });
    yield* sql`
      UPDATE harness_agents
      SET role_definition_id = ${roleDefinitionId}
      WHERE agent_id = ${child.agentId}
    `;
    const metadataBefore = yield* sql`SELECT * FROM harness_agents ORDER BY agent_id`;
    const graphBefore = yield* store.read();
    yield* appendActivity(2, "idle", "Review finished", updatedAt);
    const current = yield* store.read();
    const updatedChild = current.agents.find((agent) => agent.agentId === child.agentId)!;
    assert.equal(updatedChild.displayName, "Review finished");
    assert.equal(updatedChild.status, "paused");
    assert.equal(updatedChild.updatedAt, updatedAt);
    assert.equal(updatedChild.roleDefinitionId, roleDefinitionId);
    assert.equal(updatedChild.spawnedByAgentId, child.spawnedByAgentId);
    assert.deepStrictEqual(updatedChild.backing, child.backing);
    assert.deepStrictEqual(
      yield* sql`SELECT * FROM harness_agents ORDER BY agent_id`,
      metadataBefore,
    );
    assert.equal(current.revision, graphBefore.revision);
    assert.deepStrictEqual(current.relationships, initial.relationships);
    assert.equal(current.agents.filter((agent) => agent.backing.kind === "native").length, 1);

    yield* sql`
      UPDATE projection_threads
      SET
        archived_at = ${updatedAt},
        updated_at = ${updatedAt}
      WHERE thread_id = ${ThreadId.make("parent")}
    `;
    assert.isTrue((yield* store.read()).agents.some((agent) => agent.agentId === child.agentId));
    yield* sql`DELETE FROM projection_threads WHERE thread_id = 'parent'`;
    assert.equal((yield* store.read()).agents.length, 0);
    assert.equal((yield* sql`SELECT * FROM harness_agents`).length, 0);
  }).pipe(Effect.provide(testLayer)),
);
