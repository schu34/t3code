import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("055_HarnessGraph", (it) => {
  it.effect("creates durable graph, coordination, and delivery tables", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 55 });

      const tables = yield* sql<{ readonly name: string }>`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name LIKE 'harness_%'
        ORDER BY name
      `;
      const migration = yield* sql<{ readonly migration_id: number }>`
        SELECT migration_id FROM effect_sql_migrations WHERE migration_id = 55
      `;

      assert.deepStrictEqual(
        tables.map((table) => table.name),
        [
          "harness_agents",
          "harness_channels",
          "harness_coordination_messages",
          "harness_deliveries",
          "harness_graph_meta",
          "harness_relationships",
        ],
      );
      assert.equal(migration.length, 1);
    }),
  );
});
