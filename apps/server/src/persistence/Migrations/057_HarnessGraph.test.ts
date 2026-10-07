import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("057_HarnessGraph", (it) => {
  it.effect("replaces pre-release graph tables and clears deleted roles", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      // A development database from an earlier Harness build.
      yield* sql`CREATE TABLE harness_agents (agent_id TEXT PRIMARY KEY, kind TEXT NOT NULL)`;
      yield* sql`CREATE TABLE harness_channels (channel_id TEXT PRIMARY KEY)`;
      yield* runMigrations({ toMigrationInclusive: 57 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'harness_%' ORDER BY name
      `;
      assert.deepStrictEqual(
        tables.map((table) => table.name),
        ["harness_agents", "harness_edges", "harness_roles"],
      );

      yield* sql`PRAGMA foreign_keys = ON`;
      yield* sql`
        INSERT INTO harness_roles (role_id, name, instructions, created_at)
        VALUES ('reviewer', 'Reviewer', 'Review it.', '2026-10-04T00:00:00.000Z')
      `;
      yield* sql`INSERT INTO harness_agents (thread_id, role_id) VALUES ('thread-1', 'reviewer')`;
      yield* sql`DELETE FROM harness_roles WHERE role_id = 'reviewer'`;
      const agents = yield* sql<{ readonly role_id: string | null }>`
        SELECT role_id FROM harness_agents
      `;
      assert.deepStrictEqual(agents, [{ role_id: null }]);
    }),
  );
});
