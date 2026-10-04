import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Graph configuration references threads; channels persist behavior-neutral messages. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE harness_graph_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO harness_graph_meta (
      key,
      value
    )
    VALUES (
      'revision',
      '0'
    )
  `;
  yield* sql`
    CREATE TABLE harness_role_definitions (
      role_definition_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      instructions TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE harness_relationship_definitions (
      relationship_definition_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      request_instructions TEXT NOT NULL,
      response_instructions TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE harness_agents (
      agent_id TEXT PRIMARY KEY,
      thread_id TEXT UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN (
        'root',
        'delegated',
        'sidechat'
      )),
      role_definition_id TEXT NOT NULL REFERENCES harness_role_definitions(role_definition_id),
      spawned_by_agent_id TEXT REFERENCES harness_agents(agent_id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (spawned_by_agent_id IS NULL OR spawned_by_agent_id != agent_id)
    )
  `;
  yield* sql`
    CREATE TABLE harness_relationships (
      relationship_id TEXT PRIMARY KEY,
      source_agent_id TEXT NOT NULL REFERENCES harness_agents (agent_id) ON DELETE CASCADE,
      target_agent_id TEXT NOT NULL REFERENCES harness_agents (agent_id) ON DELETE CASCADE,
      relationship_definition_id TEXT NOT NULL REFERENCES harness_relationship_definitions (relationship_definition_id),
      topic TEXT,
      forked_from_turn_id TEXT,
      created_at TEXT NOT NULL,
      CHECK (source_agent_id != target_agent_id)
    )
  `;
  yield* sql`
    CREATE INDEX idx_harness_relationships_source ON harness_relationships(source_agent_id)
  `;
  yield* sql`
    CREATE INDEX idx_harness_relationships_target ON harness_relationships(target_agent_id)
  `;
  yield* sql`
    CREATE TABLE harness_channels (
      channel_id TEXT PRIMARY KEY,
      relationship_id TEXT NOT NULL UNIQUE REFERENCES harness_relationships(relationship_id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE harness_coordination_messages (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES harness_channels(channel_id) ON DELETE CASCADE,
      sender_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      recipient_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      author_kind TEXT NOT NULL CHECK (author_kind IN (
        'user',
        'agent'
      )),
      body TEXT NOT NULL,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      deduplication_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (
        channel_id,
        sequence
      ),
      UNIQUE (
        channel_id,
        sender_agent_id,
        deduplication_key
      )
    )
  `;
});
