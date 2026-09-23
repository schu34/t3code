import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Add provider-owned backing metadata without changing the T3-thread rows. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN backing_kind TEXT NOT NULL DEFAULT 'thread'
      CHECK (backing_kind IN ('thread', 'native'))
  `;
  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN provider_name TEXT
  `;
  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN provider_instance_id TEXT
  `;
  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN provider_agent_id TEXT
  `;
  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN parent_thread_id TEXT
  `;
  yield* sql`
    ALTER TABLE harness_agents
    ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]'
  `;
  yield* sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_harness_agents_native_provider_ref
    ON harness_agents(provider_instance_id, provider_agent_id)
    WHERE backing_kind = 'native'
      AND provider_instance_id IS NOT NULL
      AND provider_agent_id IS NOT NULL
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_harness_agents_native_parent_thread
    ON harness_agents(parent_thread_id, backing_kind, created_at, agent_id)
    WHERE backing_kind = 'native'
  `;
});
