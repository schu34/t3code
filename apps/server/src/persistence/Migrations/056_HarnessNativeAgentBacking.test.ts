import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layer({ filename: ":memory:" })));

layer("056_HarnessNativeAgentBacking", (it) => {
  it.effect("adds provider-native backing columns and indexes", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 56 });

      const migration = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM effect_sql_migrations WHERE migration_id = 56
      `;
      const nativeColumns = yield* sql<{ readonly name: string }>`
        SELECT name
        FROM pragma_table_info('harness_agents')
        WHERE name IN (
          'backing_kind', 'provider_name', 'provider_instance_id',
          'provider_agent_id', 'parent_thread_id', 'capabilities_json'
        )
        ORDER BY name
      `;
      const indexes = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_harness_agents_native_%'
        ORDER BY name
      `;

      assert.equal(migration.length, 1);
      assert.deepStrictEqual(
        nativeColumns.map((column) => column.name),
        [
          "backing_kind",
          "capabilities_json",
          "parent_thread_id",
          "provider_agent_id",
          "provider_instance_id",
          "provider_name",
        ],
      );
      assert.deepStrictEqual(
        indexes.map((index) => index.name),
        ["idx_harness_agents_native_parent_thread", "idx_harness_agents_native_provider_ref"],
      );
    }),
  );
});
