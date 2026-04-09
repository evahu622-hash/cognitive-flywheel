#!/usr/bin/env node
/**
 * Execute SQL on Supabase via Management API
 * Usage: node scripts/execute-sql.mjs [sql-file]
 * Requires SUPABASE_ACCESS_TOKEN env var (get from https://supabase.com/dashboard/account/tokens)
 */
import fs from "node:fs";
import path from "node:path";

const PROJECT_REF = "lhkrcladufkancnboraq";
const sqlFile = process.argv[2] || path.join(process.cwd(), "supabase", "full-schema.sql");
const token = process.env.SUPABASE_ACCESS_TOKEN;

if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN.");
  console.error("Get one at: https://supabase.com/dashboard/account/tokens");
  console.error("Then: SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/execute-sql.mjs");
  process.exit(1);
}

const sql = fs.readFileSync(sqlFile, "utf-8");
console.log(`Executing ${sqlFile} (${sql.length} bytes) on project ${PROJECT_REF}...`);

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ query: sql }),
});

if (!res.ok) {
  const text = await res.text();
  console.error(`Failed (${res.status}): ${text}`);
  process.exit(1);
}

const result = await res.json();
console.log("Success:", JSON.stringify(result).slice(0, 200));
