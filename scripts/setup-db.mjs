/**
 * Applies EV CMS schema + RLS + seed to Supabase when DATABASE_URL is set.
 * Otherwise prints instructions for the SQL Editor.
 *
 * Usage:
 *   DATABASE_URL="postgresql://postgres.[ref]:[password]@..." node scripts/setup-db.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = ["supabase/schema.sql", "supabase/rls.sql", "supabase/policies_write.sql", "supabase/seed.sql"];

const dbUrl = process.env.DATABASE_URL;

if (!dbUrl) {
  console.log(`
EV CMS database setup

Your .env has VITE_SUPABASE_URL for the web app. To load tables and seed data:

1. Open Supabase Dashboard → SQL Editor
2. Run in order:
   - supabase/schema.sql
   - supabase/rls.sql
   - supabase/policies_write.sql
   - supabase/seed.sql

Demo login: any seeded @dfccil.gov.in email, password: dfccil123

Or set DATABASE_URL (direct Postgres connection) and run this script again.
`);
  process.exit(0);
}

const { default: pg } = await import("pg");
const client = new pg.Client({ connectionString: dbUrl });

try {
  await client.connect();
  for (const file of files) {
    const sql = readFileSync(join(root, file), "utf8");
    console.log(`Running ${file}...`);
    await client.query(sql);
  }
  console.log("Database setup complete.");
} catch (e) {
  console.error(e);
  process.exit(1);
} finally {
  await client.end();
}
