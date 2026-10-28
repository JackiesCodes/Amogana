import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { MIGRATIONS } from "@/lib/trading/schema";

describe("database schema", () => {
  it.each(MIGRATIONS.map((m) => [m.file, m.sql]))("%s matches supabase/migrations", (file, sql) => {
    expect(sql).toBe(readFileSync(`supabase/migrations/${file}`, "utf8"));
  });

  it("applies cleanly, twice, and leaves no paper mode behind", async () => {
    const db = new PGlite();
    for (let run = 0; run < 2; run++) for (const m of MIGRATIONS) await db.exec(m.sql);
    const tables = await db.query<{ n: number }>("select count(*)::int as n from information_schema.tables where table_schema = 'public'");
    expect(tables.rows[0]!.n).toBe(8);
    const book = await db.query("select 1 from information_schema.columns where table_name = 'bots' and column_name = 'book'");
    expect(book.rows).toHaveLength(0);
    await expect(db.exec("insert into equity (id, book, equity) values ('x', 'paper', 1)")).rejects.toThrow();
    await db.exec("insert into equity (id, book, equity) values ('y', 'demo', 1)");
    await db.close();
  });

  it("re-labels existing live trades by their account and drops paper ones", async () => {
    const db = new PGlite();
    await db.exec(MIGRATIONS[0].sql);
    await db.exec(`
      insert into brokers (id, kind, label, status, is_demo) values ('d', 'deriv', 'Deriv demo', 'connected', true);
      insert into trades (id, broker_account_id, book, symbol, side, size, size_unit, status)
        values ('t1', 'd', 'live', 'R_75', 'buy', 1, 'stake', 'closed'),
               ('t2', null, 'paper', 'R_75', 'buy', 1, 'units', 'closed');
    `);
    await db.exec(MIGRATIONS[1].sql);
    const { rows } = await db.query<{ id: string; book: string }>("select id, book from trades order by id");
    expect(rows).toEqual([{ id: "t1", book: "demo" }]);
    await db.close();
  });
});
