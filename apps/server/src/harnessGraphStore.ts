import {
  HarnessEdgeId,
  HarnessGraphValidationError,
  HarnessRoleId,
  ThreadId,
  TurnId,
  type HarnessAgent,
  type HarnessCreateRoleInput,
  type HarnessGraphReadInput,
  type HarnessGraphSnapshot,
  type HarnessSetAgentInput,
  type HarnessUpsertEdgeInput,
  type ProjectId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as SqlClient from "effect/unstable/sql/SqlClient";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const invalid = (detail: string) =>
  new HarnessGraphValidationError({ operation: "harness-graph", detail });

type ThreadRow = {
  thread_id: string;
  project_id: string;
  title: string;
  archived_at: string | null;
  settled_override: string | null;
  session_status: string | null;
};
type AgentRow = {
  thread_id: string;
  role_id: string | null;
  parent_thread_id: string | null;
  forked_from_turn_id: string | null;
};
type EdgeRow = {
  edge_id: string;
  source_thread_id: string;
  target_thread_id: string;
  label: string | null;
  created_at: string;
};

function threadStatus(row: ThreadRow): HarnessAgent["status"] {
  if (row.session_status === "error") return "failed";
  if (row.settled_override === "settled" || row.archived_at !== null) return "completed";
  if (row.session_status === "stopped") return "paused";
  return "active";
}

/**
 * SQL store for graph-owned metadata. Thread title, project, and lifecycle stay
 * in orchestration and are joined on read.
 */
export const makeHarnessGraphStore = Effect.fnUntraced(function* (changes: PubSub.PubSub<void>) {
  const sql = yield* SqlClient.SqlClient;
  const crypto = yield* Crypto.Crypto;
  const publish = PubSub.publish(changes, undefined);

  const threadRows = (projectId: ProjectId | null) => sql<ThreadRow>`
    SELECT
      t.thread_id,
      t.project_id,
      t.title,
      t.archived_at,
      t.settled_override,
      s.status AS session_status
    FROM projection_threads t
    LEFT JOIN projection_thread_sessions s
      ON s.thread_id = t.thread_id
    WHERE t.deleted_at IS NULL
      AND t.thread_kind = 'user'
      AND (${projectId} IS NULL OR t.project_id = ${projectId})
    ORDER BY
      t.created_at,
      t.thread_id
  `;

  const read = Effect.fnUntraced(function* (input: HarnessGraphReadInput = {}) {
    const projectId = input.projectId ?? null;
    const threads = new Map((yield* threadRows(projectId)).map((row) => [row.thread_id, row]));
    const metadata = new Map(
      (yield* sql<AgentRow>`
        SELECT
          *
        FROM harness_agents
      `).map((row) => [row.thread_id, row]),
    );
    const agents = [...threads.values()].map((thread): HarnessAgent => {
      const row = metadata.get(thread.thread_id);
      return {
        threadId: ThreadId.make(thread.thread_id),
        ...(row?.role_id ? { roleId: HarnessRoleId.make(row.role_id) } : {}),
        ...(row?.parent_thread_id ? { parentThreadId: ThreadId.make(row.parent_thread_id) } : {}),
        ...(row?.forked_from_turn_id
          ? { forkedFromTurnId: TurnId.make(row.forked_from_turn_id) }
          : {}),
        projectId: thread.project_id as ProjectId,
        displayName: thread.title,
        status: threadStatus(thread),
      };
    });
    const agentIds = new Set<string>(agents.map((agent) => agent.threadId));
    const edges = (yield* sql<EdgeRow>`
      SELECT
        *
      FROM harness_edges
      ORDER BY
        created_at,
        edge_id
    `).filter((row) => agentIds.has(row.source_thread_id) && agentIds.has(row.target_thread_id));
    const roles = yield* sql<{
      role_id: string;
      name: string;
      instructions: string;
      created_at: string;
    }>`
      SELECT
        *
      FROM harness_roles
      ORDER BY
        name
    `;
    const snapshot: HarnessGraphSnapshot = {
      agents,
      edges: edges.map((row) => ({
        edgeId: HarnessEdgeId.make(row.edge_id),
        sourceThreadId: ThreadId.make(row.source_thread_id),
        targetThreadId: ThreadId.make(row.target_thread_id),
        ...(row.label === null ? {} : { label: row.label }),
        createdAt: row.created_at,
      })),
      roles: roles.map((row) => ({
        roleId: HarnessRoleId.make(row.role_id),
        name: row.name,
        instructions: row.instructions,
        createdAt: row.created_at,
      })),
    };
    return snapshot;
  });

  const userThread = Effect.fnUntraced(function* (threadId: ThreadId) {
    return (yield* sql<{ project_id: string }>`
      SELECT
        project_id
      FROM projection_threads
      WHERE thread_id = ${threadId}
        AND deleted_at IS NULL
        AND thread_kind = 'user'
    `)[0];
  });

  const createRole = Effect.fnUntraced(function* (input: HarnessCreateRoleInput) {
    const existing = yield* sql`
      SELECT
        role_id
      FROM harness_roles
      WHERE name = ${input.name}
    `;
    if (existing.length > 0) return yield* invalid("A role with this name already exists.");
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_roles (
        role_id,
        name,
        instructions,
        created_at
      )
      VALUES (
        ${input.roleId},
        ${input.name},
        ${input.instructions},
        ${now}
      )
    `;
    yield* publish;
  });

  const setAgent = Effect.fnUntraced(function* (input: HarnessSetAgentInput) {
    yield* sql.withTransaction(
      Effect.gen(function* () {
        const thread = yield* userThread(input.threadId);
        if (thread === undefined)
          return yield* invalid("Only existing T3 threads can be configured as agents.");
        if (input.roleId != null) {
          const roles = yield* sql`
            SELECT
              role_id
            FROM harness_roles
            WHERE role_id = ${input.roleId}
          `;
          if (roles.length === 0) return yield* invalid("The role does not exist.");
        }
        const existing = (yield* sql<AgentRow>`
          SELECT
            *
          FROM harness_agents
          WHERE thread_id = ${input.threadId}
        `)[0];
        const changes = (stored: string | null | undefined, next: string | undefined) =>
          next !== undefined && stored != null && stored !== next;
        if (
          changes(existing?.parent_thread_id, input.parentThreadId) ||
          changes(existing?.forked_from_turn_id, input.forkedFromTurnId)
        )
          return yield* invalid("An agent's creation origin cannot be changed.");
        const parentThreadId = existing?.parent_thread_id ?? input.parentThreadId ?? null;
        const forkedFromTurnId = existing?.forked_from_turn_id ?? input.forkedFromTurnId ?? null;
        if (forkedFromTurnId !== null && parentThreadId === null)
          return yield* invalid("A forked agent needs the thread it was forked from.");
        if (input.parentThreadId !== undefined && existing?.parent_thread_id == null) {
          const parent = yield* userThread(input.parentThreadId);
          if (parent?.project_id !== thread.project_id)
            return yield* invalid("The creator must be a thread in the same project.");
          let ancestor: string | null = input.parentThreadId;
          const visited = new Set<string>();
          while (ancestor !== null) {
            if (ancestor === input.threadId || visited.has(ancestor))
              return yield* invalid("Creation origin cannot contain a cycle.");
            visited.add(ancestor);
            const row: AgentRow | undefined = (yield* sql<AgentRow>`
              SELECT
                *
              FROM harness_agents
              WHERE thread_id = ${ancestor}
            `)[0];
            ancestor = row?.parent_thread_id ?? null;
          }
        }
        const roleId =
          input.roleId === undefined ? (existing?.role_id ?? null) : (input.roleId ?? null);
        yield* sql`
          INSERT INTO harness_agents (
            thread_id,
            role_id,
            parent_thread_id,
            forked_from_turn_id
          )
          VALUES (
            ${input.threadId},
            ${roleId},
            ${parentThreadId},
            ${forkedFromTurnId}
          )
          ON CONFLICT (thread_id)
          DO UPDATE
          SET
            role_id = excluded.role_id,
            parent_thread_id = excluded.parent_thread_id,
            forked_from_turn_id = excluded.forked_from_turn_id
        `;
      }),
    );
    yield* publish;
  });

  const upsertEdge = Effect.fnUntraced(function* (input: HarnessUpsertEdgeInput) {
    if (input.sourceThreadId === input.targetThreadId)
      return yield* invalid("An agent cannot connect to itself.");
    const { agents } = yield* read();
    const source = agents.find((agent) => agent.threadId === input.sourceThreadId);
    const target = agents.find((agent) => agent.threadId === input.targetThreadId);
    if (source === undefined || target === undefined)
      return yield* invalid("Both agents must exist.");
    if (source.projectId !== target.projectId)
      return yield* invalid("Connected agents must belong to the same project.");
    const edgeId = input.edgeId ?? HarnessEdgeId.make(yield* crypto.randomUUIDv4);
    const existing = (yield* sql<EdgeRow>`
      SELECT
        *
      FROM harness_edges
      WHERE edge_id = ${edgeId}
    `)[0];
    if (
      existing &&
      (existing.source_thread_id !== input.sourceThreadId ||
        existing.target_thread_id !== input.targetThreadId)
    )
      return yield* invalid("Edge endpoints cannot be changed.");
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_edges (
        edge_id,
        source_thread_id,
        target_thread_id,
        label,
        created_at
      )
      VALUES (
        ${edgeId},
        ${input.sourceThreadId},
        ${input.targetThreadId},
        ${input.label ?? null},
        ${now}
      )
      ON CONFLICT (edge_id)
      DO UPDATE
      SET
        label = excluded.label
    `;
    yield* publish;
  });

  return { read, createRole, setAgent, upsertEdge };
});
