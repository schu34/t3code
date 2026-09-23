import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("054_ProjectionThreadKind", (it) => {
  it.effect("adds provider-child metadata and its parent lookup index", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });

      const migration = yield* sql<{ readonly migrationId: number }>`
        SELECT migration_id AS "migrationId"
        FROM effect_sql_migrations
        WHERE migration_id = 54
      `;
      const columns = yield* sql<{
        readonly name: string;
        readonly notNull: number;
        readonly defaultValue: string | null;
      }>`
        SELECT
          name,
          "notnull" AS "notNull",
          dflt_value AS "defaultValue"
        FROM pragma_table_info('projection_threads')
        WHERE name IN ('thread_kind', 'parent_thread_id')
        ORDER BY name
      `;
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_projection_threads_parent_thread'
      `;

      assert.deepStrictEqual(migration, [{ migrationId: 54 }]);
      assert.deepStrictEqual(columns, [
        { name: "parent_thread_id", notNull: 0, defaultValue: null },
        { name: "thread_kind", notNull: 1, defaultValue: "'user'" },
      ]);
      assert.deepStrictEqual(indexes, [{ name: "idx_projection_threads_parent_thread" }]);
    }),
  );
});
