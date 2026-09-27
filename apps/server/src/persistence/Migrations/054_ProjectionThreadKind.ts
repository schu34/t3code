import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/** Keep provider child transcripts durable while hiding them from the shell. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN thread_kind TEXT NOT NULL DEFAULT 'user'
      CHECK (thread_kind IN ('user', 'provider-child'))
  `;
  yield* sql`
    ALTER TABLE projection_threads
    ADD COLUMN parent_thread_id TEXT
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_parent_thread
    ON projection_threads(parent_thread_id, created_at, thread_id)
  `;
});
