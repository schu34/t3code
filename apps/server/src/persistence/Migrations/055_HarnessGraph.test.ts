import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("055_HarnessGraph", (it) => {
  it.effect("shares role definitions across project-local agents", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });
      const timestamp = "2026-10-04T00:00:00.000Z";
      yield* sql`
        INSERT INTO harness_role_definitions (
          role_definition_id,
          name,
          instructions,
          created_at,
          updated_at
        )
        VALUES (
          'shared-role',
          'Implementor',
          'Implement changes.',
          ${timestamp},
          ${timestamp}
        )
      `;
      for (const projectId of ["project-a", "project-b"]) {
        yield* sql`
          INSERT INTO harness_agents (
            agent_id,
            thread_id,
            kind,
            role_definition_id,
            created_at,
            updated_at
          )
          VALUES (
            ${projectId},
            ${projectId},
            'root',
            'shared-role',
            ${timestamp},
            ${timestamp}
          )
        `;
      }
      const agents = yield* sql<{
        readonly thread_id: string;
        readonly role_definition_id: string;
      }>`
        SELECT
          thread_id,
          role_definition_id
        FROM harness_agents
        ORDER BY
          thread_id
      `;
      assert.deepStrictEqual(agents, [
        { thread_id: "project-a", role_definition_id: "shared-role" },
        { thread_id: "project-b", role_definition_id: "shared-role" },
      ]);
      for (const table of ["harness_role_definitions", "harness_relationship_definitions"]) {
        const columns = yield* sql<{
          readonly name: string;
        }>`
          SELECT
            name
          FROM pragma_table_info (${table})
        `;
        assert.isFalse(columns.some((column) => column.name === "thread_id"));
      }
    }),
  );

  it.effect("creates durable graph, coordination, and delivery tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT
          name
        FROM sqlite_master
        WHERE type = 'table'
        AND name LIKE 'harness_%'
        ORDER BY
          name
      `;
      const migration = yield* sql<{ readonly migration_id: number }>`
        SELECT
          migration_id
        FROM effect_sql_migrations
        WHERE migration_id = 55
      `;

      assert.deepStrictEqual(
        tables.map((table) => table.name),
        [
          "harness_agents",
          "harness_channels",
          "harness_coordination_messages",
          "harness_graph_meta",
          "harness_relationship_definitions",
          "harness_relationships",
          "harness_role_definitions",
        ],
      );
      assert.equal(migration.length, 1);
      const columns = yield* sql<{ readonly name: string }>`
        SELECT
          name
        FROM pragma_table_info ('harness_relationships')
      `;
      assert.isFalse(columns.some((column) => column.name === "structure"));
    }),
  );
});
