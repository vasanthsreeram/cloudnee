import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { SqlDb } from "./types.ts";

export function sqliteDb(raw: DatabaseSync): SqlDb {
  return {
    exec(sql) {
      raw.exec(sql);
    },
    all(sql, params = []) {
      return raw.prepare(sql).all(...(params as (string | number | null | bigint)[])) as Record<
        string,
        unknown
      >[];
    },
    run(sql, params = []) {
      raw.prepare(sql).run(...(params as (string | number | null | bigint)[]));
    },
    batch(statements) {
      raw.exec("BEGIN");
      try {
        for (const statement of statements) {
          raw
            .prepare(statement.sql)
            .run(...((statement.params ?? []) as (string | number | null | bigint)[]));
        }
        raw.exec("COMMIT");
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

export function openSqlite(path = ":memory:"): { db: SqlDb; close: () => void } {
  const raw = new DatabaseSync(path);
  const migration = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../migrations/0001_init.sql"),
    "utf8",
  );
  raw.exec(migration);
  return {
    db: sqliteDb(raw),
    close() {
      raw.close();
    },
  };
}
