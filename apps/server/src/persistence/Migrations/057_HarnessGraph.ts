import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Graph metadata keyed by thread id. Threads stay the only agent runtime, so
 * rows exist only for graph-owned facts: role, creation origin, and edges.
 *
 * Numbered 57 because pre-release Harness builds applied different 55/56
 * graph schemas to some development databases; those tables are dropped here.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DROP TABLE IF EXISTS harness_deliveries`;
  yield* sql`DROP TABLE IF EXISTS harness_coordination_messages`;
  yield* sql`DROP TABLE IF EXISTS harness_channels`;
  yield* sql`DROP TABLE IF EXISTS harness_relationships`;
  yield* sql`DROP TABLE IF EXISTS harness_agents`;
  yield* sql`DROP TABLE IF EXISTS harness_relationship_definitions`;
  yield* sql`DROP TABLE IF EXISTS harness_role_definitions`;
  yield* sql`DROP TABLE IF EXISTS harness_graph_meta`;
  yield* sql`
    CREATE TABLE harness_roles (
      role_id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      instructions TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE TABLE harness_agents (
      thread_id TEXT PRIMARY KEY,
      role_id TEXT REFERENCES harness_roles (role_id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      forked_from_turn_id TEXT,
      CHECK (parent_thread_id IS NULL OR parent_thread_id != thread_id)
    )
  `;
  yield* sql`
    CREATE TABLE harness_edges (
      edge_id TEXT PRIMARY KEY,
      source_thread_id TEXT NOT NULL,
      target_thread_id TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      CHECK (source_thread_id != target_thread_id)
    )
  `;
});
