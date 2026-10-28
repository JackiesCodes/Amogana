import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { SCHEMA_SQL } from "@/lib/trading/schema";

describe("database schema", () => {
  it("matches the Supabase migration file", () => {
    expect(SCHEMA_SQL).toBe(readFileSync("supabase/migrations/0001_amogana_autotrade.sql", "utf8"));
  });

  it("applies cleanly and is idempotent", async () => {
    const db = new PGlite();
    await db.exec(SCHEMA_SQL);
    await db.exec(SCHEMA_SQL);
    const { rows } = await db.query<{ n: number }>(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    expect(rows[0]!.n).toBe(8);
    await db.close();
  });
});
