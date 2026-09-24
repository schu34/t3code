import {
  HarnessAgentId,
  HarnessChannelId,
  HarnessCoordinationMessageId,
  HarnessGraphValidationError,
  HarnessRelationshipDefinitionId,
  HarnessRelationshipId,
  HarnessRoleDefinitionId,
  ProviderInstanceId,
  providerChildThreadId,
  ThreadId,
  TurnId,
  type HarnessAgentMetadata,
  type HarnessCreateRelationshipDefinitionInput,
  type HarnessCreateRoleDefinitionInput,
  type HarnessGraphReadInput,
  type HarnessRegisterAgentInput,
  type HarnessSendCoordinationMessageInput,
  type HarnessUpsertRelationshipInput,
  type HarnessOpenChannelInput,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import { foldHarnessNativeActivities, type HarnessNativeAgentObservation } from "./harnessGraph.ts";
const decodePayload = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { ProjectionSnapshotQuery } from "./orchestration/Services/ProjectionSnapshotQuery.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
const invalid = (detail: string) =>
  new HarnessGraphValidationError({ operation: "harness-graph", detail });
type AgentMetadataRow = {
  agent_id: string;
  thread_id: string | null;
  backing_kind: "thread" | "native";
  provider_name: string | null;
  provider_instance_id: string | null;
  provider_agent_id: string | null;
  parent_thread_id: string | null;
  kind: HarnessAgentMetadata["kind"];
  role_definition_id: string;
  spawned_by_agent_id: string | null;
  created_at: string;
  updated_at: string;
};
const toAgentMetadata = (row: AgentMetadataRow) =>
  ({
    agentId: HarnessAgentId.make(row.agent_id),
    backing:
      row.backing_kind === "native"
        ? {
            kind: "native" as const,
            provider: row.provider_name!,
            providerAgentId: row.provider_agent_id!,
            parentThreadId: ThreadId.make(row.parent_thread_id!),
            ...(row.provider_instance_id === null
              ? {}
              : { providerInstanceId: ProviderInstanceId.make(row.provider_instance_id) }),
          }
        : { kind: "thread" as const, threadId: ThreadId.make(row.thread_id!) },
    kind: row.kind,
    roleDefinitionId: HarnessRoleDefinitionId.make(row.role_definition_id),
    ...(row.spawned_by_agent_id === null
      ? {}
      : { spawnedByAgentId: HarnessAgentId.make(row.spawned_by_agent_id) }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }) satisfies HarnessAgentMetadata;

type RelationshipRow = {
  relationship_id: string;
  source_agent_id: string;
  target_agent_id: string;
  relationship_definition_id: string;
  topic: string | null;
  forked_from_turn_id: string | null;
  created_at: string;
};
type ChannelRow = {
  channel_id: string;
  relationship_id: string;
  topic: string;
  created_at: string;
  message_count: number;
  last_sequence: number;
};
type MessageRow = {
  message_id: string;
  channel_id: string;
  sender_agent_id: string;
  recipient_agent_id: string;
  author_kind: "user" | "agent";
  body: string;
  sequence: number;
  deduplication_key: string;
  created_at: string;
};

/** Small SQL store for graph-owned configuration; thread state stays in orchestration. */
export const makeHarnessGraphStore = Effect.fnUntraced(function* (changes: PubSub.PubSub<void>) {
  const sql = yield* SqlClient.SqlClient;
  const query = yield* ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;
  const publish = PubSub.publish(changes, undefined);
  const bump = sql`
    UPDATE harness_graph_meta
    SET
      value = CAST(value AS INTEGER) + 1
    WHERE key = 'revision'
  `;
  const builtins = Effect.gen(function* () {
    const now = yield* nowIso;
    yield* sql`
      INSERT OR IGNORE INTO harness_role_definitions
      VALUES (
        'builtin:general',
        'General agent',
        'Follow the user’s task and report progress clearly.',
        ${now},
        ${now}
      )
    `;
    for (const name of ["delegation", "sidechat"]) {
      yield* sql`
        INSERT OR IGNORE INTO harness_relationship_definitions
        VALUES (
          ${`builtin:${name}`},
          ${name},
          'Describe the task and relevant context.',
          'Respond with the result, rationale, and any blockers.',
          ${now},
          ${now}
        )
      `;
    }
  });
  const threads = Effect.gen(function* () {
    const active = yield* query.getShellSnapshot();
    const archived = yield* query.getArchivedShellSnapshot();
    return new Map([...active.threads, ...archived.threads].map((thread) => [thread.id, thread]));
  });
  const sync = Effect.gen(function* () {
    yield* builtins;
    const byId = yield* threads;
    const rows = yield* sql<AgentMetadataRow>`
      SELECT
        *
      FROM harness_agents
    `;
    const rowsById = new Map(rows.map((row) => [row.agent_id, row]));
    for (const row of rows) {
      if (
        !byId.has(
          ThreadId.make(row.backing_kind === "native" ? row.parent_thread_id! : row.thread_id!),
        )
      ) {
        yield* sql`
          DELETE
          FROM harness_agents
          WHERE agent_id = ${row.agent_id}
        `;
        yield* bump;
      }
    }
    const childRows = yield* sql<{
      thread_id: string;
    }>`
      SELECT
        thread_id
      FROM projection_threads
      WHERE thread_kind = 'provider-child'
    `;
    const childIds = new Set(childRows.map((row) => row.thread_id));
    const existing = new Set(rows.map((row) => row.thread_id));
    for (const thread of byId.values()) {
      if (existing.has(thread.id) || childIds.has(thread.id)) continue;
      const now = yield* nowIso;
      yield* sql`
        INSERT OR IGNORE INTO harness_agents (
          agent_id,
          thread_id,
          kind,
          role_definition_id,
          created_at,
          updated_at
        )
        VALUES (
          ${thread.id},
          ${thread.id},
          'root',
          'builtin:general',
          ${now},
          ${now}
        )
      `;
      yield* bump;
    }
    const activityRows = yield* sql<{
      thread_id: string;
      kind: string;
      payload_json: string;
      created_at: string;
    }>`
      SELECT
        thread_id,
        kind,
        payload_json,
        created_at
      FROM projection_thread_activities
      WHERE kind IN (
        'task.started',
        'task.progress',
        'task.updated',
        'task.completed'
      )
      OR json_extract(payload_json, '$.itemType') = 'collab_agent_tool_call'
      ORDER BY
        thread_id,
        sequence,
        created_at,
        activity_id
    `;
    const activities = new Map<
      string,
      Array<{ kind: string; payload: unknown; createdAt: string }>
    >();
    for (const row of activityRows) {
      let payload: unknown;
      try {
        payload = decodePayload(row.payload_json);
      } catch {
        continue;
      }
      const group = activities.get(row.thread_id) ?? [];
      group.push({ kind: row.kind, payload, createdAt: row.created_at });
      activities.set(row.thread_id, group);
    }
    const nativeObservations = new Map<string, HarnessNativeAgentObservation>();
    for (const [threadId, group] of activities) {
      const parent = byId.get(ThreadId.make(threadId));
      if (!parent) continue;
      const observations = foldHarnessNativeActivities(group);
      const ids = new Map(
        observations.map((o) => [o.providerAgentId, `native:${threadId}:${o.providerAgentId}`]),
      );
      // Insert all children before assigning nested creation origins.
      for (const o of observations) {
        const id = ids.get(o.providerAgentId)!;
        nativeObservations.set(id, o);
        if (rowsById.has(id)) continue;
        yield* sql`
          INSERT OR IGNORE INTO harness_agents (
            agent_id,
            kind,
            role_definition_id,
            created_at,
            updated_at,
            backing_kind,
            provider_name,
            provider_instance_id,
            provider_agent_id,
            parent_thread_id
          )
          VALUES (
            ${id},
            'delegated',
            'builtin:general',
            ${o.observedAt},
            ${o.observedAt},
            'native',
            ${parent.session?.providerName ?? "native"},
            ${parent.session?.providerInstanceId ?? null},
            ${o.providerAgentId},
            ${threadId}
          )
        `;
        yield* bump;
      }
      for (const o of observations) {
        const id = ids.get(o.providerAgentId)!;
        const creator =
          (o.parentProviderAgentId === null ? undefined : ids.get(o.parentProviderAgentId)) ??
          threadId;
        if (creator === id) continue;
        yield* sql`
          UPDATE harness_agents
          SET
            spawned_by_agent_id = ${creator}
          WHERE agent_id = ${id}
          AND spawned_by_agent_id IS NULL
        `;
        yield* sql`
          INSERT OR IGNORE INTO harness_relationships (
            relationship_id,
            source_agent_id,
            target_agent_id,
            relationship_definition_id,
            topic,
            created_at
          )
          VALUES (
            ${`native-delegation:${id}`},
            ${creator},
            ${id},
            'builtin:delegation',
            'Provider native subagent',
            ${o.observedAt}
          )
        `;
      }
    }
    return { byId, nativeObservations };
  });
  const agents = Effect.gen(function* () {
    const { byId, nativeObservations } = yield* sync;
    const rows = yield* sql<AgentMetadataRow>`
      SELECT
        *
      FROM harness_agents
      ORDER BY
        created_at,
        agent_id
    `;
    return rows.flatMap((row) => {
      const thread = byId.get(
        ThreadId.make(row.backing_kind === "native" ? row.parent_thread_id! : row.thread_id!),
      );
      if (!thread) return [];
      const metadata = toAgentMetadata(row);
      const native = nativeObservations.get(row.agent_id);
      if (metadata.backing.kind === "native" && native === undefined) return [];
      const status =
        thread.session?.status === "error"
          ? ("failed" as const)
          : thread.settledOverride === "settled" || thread.archivedAt !== null
            ? ("completed" as const)
            : thread.session?.status === "stopped"
              ? ("paused" as const)
              : ("active" as const);
      return [
        {
          ...metadata,
          backing:
            metadata.backing.kind === "native"
              ? {
                  ...metadata.backing,
                  threadId: providerChildThreadId(metadata.backing.parentThreadId, metadata.backing.providerAgentId),
                  capabilities: ["inspect" as const],
                }
              : metadata.backing,

          projectId: thread.projectId,
          displayName: native?.title ?? thread.title,
          status: native?.status ?? status,
          updatedAt: native?.observedAt ?? thread.updatedAt,
        },
      ];
    });
  });
  const requireAgent = Effect.fnUntraced(function* (id: HarnessAgentId) {
    const agent = (yield* agents).find((agent) => agent.agentId === id);
    if (!agent) return yield* invalid("The agent does not have an existing backing thread.");
    return agent;
  });
  const relationships = Effect.gen(function* () {
    const rows = yield* sql<RelationshipRow>`
      SELECT
        *
      FROM harness_relationships
      ORDER BY
        created_at,
        relationship_id
    `;
    return rows.map((row) => ({
      relationshipId: HarnessRelationshipId.make(row.relationship_id),
      sourceAgentId: HarnessAgentId.make(row.source_agent_id),
      targetAgentId: HarnessAgentId.make(row.target_agent_id),
      relationshipDefinitionId: HarnessRelationshipDefinitionId.make(
        row.relationship_definition_id,
      ),
      ...(row.topic === null ? {} : { topic: row.topic }),
      ...(row.forked_from_turn_id === null
        ? {}
        : { forkedFromTurnId: TurnId.make(row.forked_from_turn_id) }),
      createdAt: row.created_at,
    }));
  });
  const channelRows = sql<ChannelRow>`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM harness_coordination_messages m WHERE m.channel_id = c.channel_id) AS message_count,
      (SELECT COALESCE(MAX(sequence), 0) FROM harness_coordination_messages m WHERE m.channel_id = c.channel_id) AS last_sequence
    FROM harness_channels c
    ORDER BY
      c.created_at,
      c.channel_id
  `;
  const channelSummary = (row: ChannelRow) => ({
    channelId: HarnessChannelId.make(row.channel_id),
    relationshipId: HarnessRelationshipId.make(row.relationship_id),
    topic: row.topic,
    messageCount: row.message_count,
    lastSequence: row.last_sequence,
    createdAt: row.created_at,
  });
  const read = Effect.fnUntraced(function* (input: HarnessGraphReadInput = {}) {
    const allAgents = yield* agents;
    const visibleAgents = allAgents.filter(
      (agent) => input.projectId === undefined || agent.projectId === input.projectId,
    );
    const ids = new Set(visibleAgents.map((agent) => agent.agentId));
    const visibleRelationships = (yield* relationships).filter(
      (r) => ids.has(r.sourceAgentId) && ids.has(r.targetAgentId),
    );
    const relationshipIds = new Set(visibleRelationships.map((r) => r.relationshipId));
    const roleRows = yield* sql<{
      role_definition_id: string;
      name: string;
      instructions: string;
      created_at: string;
      updated_at: string;
    }>`
      SELECT
        *
      FROM harness_role_definitions
      ORDER BY
        name
    `;
    const definitionRows = yield* sql<{
      relationship_definition_id: string;
      name: string;
      request_instructions: string;
      response_instructions: string;
      created_at: string;
      updated_at: string;
    }>`
      SELECT
        *
      FROM harness_relationship_definitions
      ORDER BY
        name
    `;
    const revision = yield* sql<{
      value: string;
    }>`
      SELECT
        value
      FROM harness_graph_meta
      WHERE key = 'revision'
    `;
    return {
      revision: Number(revision[0]?.value ?? 0),
      agents: visibleAgents,
      relationships: visibleRelationships,
      roleDefinitions: roleRows.map((row) => ({
        roleDefinitionId: HarnessRoleDefinitionId.make(row.role_definition_id),
        name: row.name,
        instructions: row.instructions,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      relationshipDefinitions: definitionRows.map((row) => ({
        relationshipDefinitionId: HarnessRelationshipDefinitionId.make(
          row.relationship_definition_id,
        ),
        name: row.name,
        requestInstructions: row.request_instructions,
        responseInstructions: row.response_instructions,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      channels: (yield* channelRows)
        .filter((row) => relationshipIds.has(HarnessRelationshipId.make(row.relationship_id)))
        .map(channelSummary),
    };
  });
  const getChannel = Effect.fnUntraced(function* (id: HarnessChannelId) {
    yield* sync;
    const row = (yield* channelRows).find((row) => row.channel_id === id);
    if (!row) return yield* invalid("The channel does not exist.");
    const messages = yield* sql<MessageRow>`
      SELECT
        *
      FROM harness_coordination_messages
      WHERE channel_id = ${id}
      ORDER BY
        sequence
    `;
    return {
      ...channelSummary(row),
      messages: messages.map((m) => ({
        messageId: HarnessCoordinationMessageId.make(m.message_id),
        channelId: id,
        senderAgentId: HarnessAgentId.make(m.sender_agent_id),
        recipientAgentId: HarnessAgentId.make(m.recipient_agent_id),
        authorKind: m.author_kind,
        body: m.body,
        sequence: m.sequence,
        deduplicationKey: m.deduplication_key,
        createdAt: m.created_at,
      })),
    };
  });
  const createRole = Effect.fnUntraced(function* (input: HarnessCreateRoleDefinitionInput) {
    yield* builtins;
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_role_definitions
      VALUES (
        ${input.roleDefinitionId},
        ${input.name},
        ${input.instructions},
        ${now},
        ${now}
      )
    `;
    yield* bump;
    yield* publish;
    return { ...input, createdAt: now, updatedAt: now };
  });
  const createDefinition = Effect.fnUntraced(function* (
    input: HarnessCreateRelationshipDefinitionInput,
  ) {
    yield* builtins;
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_relationship_definitions
      VALUES (
        ${input.relationshipDefinitionId},
        ${input.name},
        ${input.requestInstructions},
        ${input.responseInstructions},
        ${now},
        ${now}
      )
    `;
    yield* bump;
    yield* publish;
    return { ...input, createdAt: now, updatedAt: now };
  });
  const registerAgent = Effect.fnUntraced(function* (input: HarnessRegisterAgentInput) {
    return yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* builtins;
        const byId = yield* threads;
        if (!byId.has(input.threadId))
          return yield* invalid("Create the backing thread before registering an agent.");
        const roles = yield* sql`
          SELECT
            role_definition_id
          FROM harness_role_definitions
          WHERE role_definition_id = ${input.roleDefinitionId}
        `;
        if (roles.length === 0) return yield* invalid("The role definition does not exist.");
        const existing = (yield* sql<AgentMetadataRow>`
          SELECT
            *
          FROM harness_agents
          WHERE agent_id = ${input.agentId}
        `)[0];

        if (
          existing &&
          (existing.thread_id !== input.threadId ||
            ((existing.spawned_by_agent_id !== null || existing.kind !== "root") &&
              (existing.kind !== input.kind ||
                existing.spawned_by_agent_id !== (input.spawnedByAgentId ?? null))))
        )
          return yield* invalid("An agent's backing and creation origin cannot be changed.");
        if (input.spawnedByAgentId !== undefined) {
          if (existing === undefined && input.spawnedByAgentId === input.agentId)
            return yield* invalid("An agent cannot create itself.");
          let ancestor: string | null = input.spawnedByAgentId;
          const visited = new Set<string>();
          while (ancestor !== null) {
            if (ancestor === input.agentId || visited.has(ancestor))
              return yield* invalid("Creation origin cannot contain a cycle.");
            visited.add(ancestor);
            const row: AgentMetadataRow | undefined = (yield* sql<AgentMetadataRow>`
              SELECT
                *
              FROM harness_agents
              WHERE agent_id = ${ancestor}
            `)[0];

            ancestor = row?.spawned_by_agent_id ?? null;
          }
          const creator = yield* requireAgent(input.spawnedByAgentId);
          if (creator.projectId !== byId.get(input.threadId)?.projectId)
            return yield* invalid("The creator must belong to the same project.");
        }
        const now = yield* nowIso;
        yield* sql`
          INSERT INTO harness_agents (
            agent_id,
            thread_id,
            kind,
            role_definition_id,
            spawned_by_agent_id,
            created_at,
            updated_at
          )
          VALUES (
            ${input.agentId},
            ${input.threadId},
            ${input.kind},
            ${input.roleDefinitionId},
            ${input.spawnedByAgentId ?? null},
            ${now},
            ${now}
          )
          ON CONFLICT (agent_id)
          DO UPDATE
          SET
            role_definition_id = excluded.role_definition_id,
            kind = excluded.kind,
            spawned_by_agent_id = excluded.spawned_by_agent_id,
            updated_at = excluded.updated_at
        `;
        yield* bump;
        yield* publish;
        return yield* requireAgent(input.agentId);
      }),
    );
  });
  const upsertRelationship = Effect.fnUntraced(function* (input: HarnessUpsertRelationshipInput) {
    if (input.sourceAgentId === input.targetAgentId)
      return yield* invalid("An agent cannot connect to itself.");
    const source = yield* requireAgent(input.sourceAgentId);
    const target = yield* requireAgent(input.targetAgentId);
    if (source.projectId !== target.projectId)
      return yield* invalid("Relationship endpoints must belong to the same project.");
    const definitions = yield* sql`
      SELECT
        relationship_definition_id
      FROM harness_relationship_definitions
      WHERE relationship_definition_id = ${input.relationshipDefinitionId}
    `;
    if (definitions.length === 0)
      return yield* invalid("The relationship definition does not exist.");
    const id = input.relationshipId ?? HarnessRelationshipId.make(yield* crypto.randomUUIDv4);
    const existing = (yield* sql<RelationshipRow>`
      SELECT
        *
      FROM harness_relationships
      WHERE relationship_id = ${id}
    `)[0];
    if (
      existing &&
      (existing.source_agent_id !== source.agentId || existing.target_agent_id !== target.agentId)
    )
      return yield* invalid("Relationship endpoints cannot be changed.");
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_relationships (
        relationship_id,
        source_agent_id,
        target_agent_id,
        relationship_definition_id,
        topic,
        forked_from_turn_id,
        created_at
      )
      VALUES (
        ${id},
        ${source.agentId},
        ${target.agentId},
        ${input.relationshipDefinitionId},
        ${input.topic ?? null},
        ${input.forkedFromTurnId ?? null},
        ${now}
      )
      ON CONFLICT (relationship_id)
      DO UPDATE
      SET
        relationship_definition_id = excluded.relationship_definition_id,
        topic = excluded.topic
    `;
    yield* bump;
    yield* publish;
    return yield* read();
  });
  const openChannel = Effect.fnUntraced(function* (input: HarnessOpenChannelInput) {
    yield* sync;
    if (!(yield* relationships).some((r) => r.relationshipId === input.relationshipId))
      return yield* invalid("The relationship does not exist.");
    const id = input.channelId ?? HarnessChannelId.make(yield* crypto.randomUUIDv4);
    const now = yield* nowIso;
    yield* sql`
      INSERT INTO harness_channels
      VALUES (
        ${id},
        ${input.relationshipId},
        ${input.topic},
        ${now}
      )
      ON CONFLICT (relationship_id) DO NOTHING
    `;
    yield* bump;
    yield* publish;
    return yield* read();
  });
  const send = Effect.fnUntraced(function* (input: HarnessSendCoordinationMessageInput) {
    yield* sync;
    const row = (yield* sql<RelationshipRow>`
      SELECT
        r.*
      FROM harness_channels c
      JOIN harness_relationships r
      ON r.relationship_id = c.relationship_id
      WHERE c.channel_id = ${input.channelId}
    `)[0];
    if (!row) return yield* invalid("The channel does not exist.");
    const isSource = row.source_agent_id === input.senderAgentId;
    if (!isSource && row.target_agent_id !== input.senderAgentId)
      return yield* invalid("The sender is not a channel participant.");
    const id = yield* crypto.randomUUIDv4;
    const now = yield* nowIso;
    // One INSERT allocates ordering and deduplicates atomically, even across concurrent senders.
    yield* sql`
      INSERT INTO harness_coordination_messages
      SELECT
        ${id},
        ${input.channelId},
        ${input.senderAgentId},
        ${isSource ? row.target_agent_id : row.source_agent_id},
        ${input.authorKind},
        ${input.body},
        COALESCE(MAX(sequence), 0) + 1,
        ${input.deduplicationKey},
        ${now}
      FROM harness_coordination_messages
      WHERE channel_id = ${input.channelId}
      ON CONFLICT (
        channel_id,
        sender_agent_id,
        deduplication_key
      ) DO NOTHING
    `;
    yield* bump;
    yield* publish;
    return yield* read();
  });
  return {
    read,
    getChannel,
    createRole,
    createDefinition,
    registerAgent,
    upsertRelationship,
    openChannel,
    send,
  };
});
