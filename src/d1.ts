import type { SqlDb } from "./types.ts";

/**
 * Structural D1 binding. The Worker runtime supplies the real class; this shape
 * keeps the adapter testable without importing Cloudflare types.
 */
export interface D1Like {
  exec(sql: string): Promise<unknown>;
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
      run(): Promise<unknown>;
    };
  };
}

export function d1Db(d1: D1Like): SqlDb {
  return {
    async exec(sql: string): Promise<void> {
      await d1.exec(sql);
    },
    async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await d1.prepare(sql).bind(...params).all<T>();
      return result.results ?? [];
    },
    async run(sql: string, params: unknown[] = []): Promise<void> {
      await d1.prepare(sql).bind(...params).run();
    },
  };
}
