import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Durable Harness graph state. The graph is intentionally separate from the
 * orchestration event stream: a graph row points at a durable T3 thread while
 * channel delivery has its own retryable outbox/inbox lifecycle.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_graph_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO harness_graph_meta (key, value)
    VALUES ('revision', '0')
    ON CONFLICT (key) DO NOTHING
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_agents (
      agent_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL UNIQUE,
      project_id TEXT NOT NULL,
      display_name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('root', 'delegated', 'sidechat')),
      status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'failed')),
      parent_agent_id TEXT REFERENCES harness_agents(agent_id) ON DELETE SET NULL,
      canvas_x REAL NOT NULL DEFAULT 0,
      canvas_y REAL NOT NULL DEFAULT 0,
      canvas_collapsed INTEGER NOT NULL DEFAULT 0 CHECK (canvas_collapsed IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_agents_project
    ON harness_agents(project_id, created_at, agent_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_relationships (
      relationship_id TEXT PRIMARY KEY,
      source_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      target_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('delegation', 'sidechat')),
      topic TEXT,
      forked_from_turn_id TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (source_agent_id, target_agent_id, kind)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_relationships_source
    ON harness_relationships(source_agent_id, created_at, relationship_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_relationships_target
    ON harness_relationships(target_agent_id, created_at, relationship_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_channels (
      channel_id TEXT PRIMARY KEY,
      agent_a_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      agent_b_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('syncing', 'aligned', 'needs-attention', 'paused')),
      summary TEXT,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      revision_a INTEGER NOT NULL DEFAULT 0,
      revision_b INTEGER NOT NULL DEFAULT 0,
      acknowledged_revision_a INTEGER NOT NULL DEFAULT 0,
      acknowledged_revision_b INTEGER NOT NULL DEFAULT 0,
      convergence_round INTEGER NOT NULL DEFAULT 0 CHECK (convergence_round BETWEEN 0 AND 3),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (agent_a_id, agent_b_id, topic)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_channels_agent_a
    ON harness_channels(agent_a_id, updated_at, channel_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_channels_agent_b
    ON harness_channels(agent_b_id, updated_at, channel_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_coordination_messages (
      message_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES harness_channels(channel_id) ON DELETE CASCADE,
      sender_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      recipient_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      author_kind TEXT NOT NULL CHECK (author_kind IN ('user', 'agent')),
      message_kind TEXT NOT NULL CHECK (message_kind IN ('update', 'question', 'agreement', 'decision', 'test-result')),
      topic TEXT NOT NULL,
      body TEXT NOT NULL,
      summary TEXT,
      decisions_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL CHECK (revision >= 0),
      round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 3),
      deduplication_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE (channel_id, sender_agent_id, deduplication_key)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_messages_channel
    ON harness_coordination_messages(channel_id, created_at, message_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_messages_recipient
    ON harness_coordination_messages(recipient_agent_id, created_at, message_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS harness_deliveries (
      delivery_id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL REFERENCES harness_coordination_messages(message_id) ON DELETE CASCADE,
      channel_id TEXT NOT NULL REFERENCES harness_channels(channel_id) ON DELETE CASCADE,
      sender_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      recipient_agent_id TEXT NOT NULL REFERENCES harness_agents(agent_id) ON DELETE CASCADE,
      side TEXT NOT NULL CHECK (side IN ('outbox', 'inbox')),
      state TEXT NOT NULL CHECK (state IN ('pending', 'delivered', 'acknowledged', 'failed')),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (message_id, side)
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_deliveries_outbox
    ON harness_deliveries(side, state, updated_at, delivery_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_deliveries_recipient
    ON harness_deliveries(recipient_agent_id, side, state, updated_at, delivery_id)
  `;
});
