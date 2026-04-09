#!/usr/bin/env node
/**
 * 通过 Supabase service role 执行 schema SQL
 * 使用 Supabase HTTP API 的 SQL 执行能力
 */
import fs from "node:fs";
import path from "node:path";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const PROJECT_REF = new URL(SUPABASE_URL).hostname.split(".")[0];

// Read the SQL file
const sqlPath = path.join(process.cwd(), "supabase", "full-schema.sql");
const fullSql = fs.readFileSync(sqlPath, "utf-8");

// Split SQL into individual statements (by semicolons not inside functions)
// We'll execute each CREATE/ALTER/DROP statement separately
function splitStatements(sql) {
  const statements = [];
  let current = "";
  let inDollarQuote = false;

  const lines = sql.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("--")) {
      continue; // skip comments
    }

    if (trimmed.includes("$$")) {
      const count = (trimmed.match(/\$\$/g) || []).length;
      if (count === 1) {
        inDollarQuote = !inDollarQuote;
      }
      // count === 2 means open and close on same line
    }

    current += line + "\n";

    if (!inDollarQuote && trimmed.endsWith(";")) {
      const stmt = current.trim();
      if (stmt.length > 1) {
        statements.push(stmt);
      }
      current = "";
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

async function executeSQL(sql) {
  // Use Supabase's postgREST-compatible SQL execution
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql_text: sql }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SQL execution failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function createExecFunction() {
  // First, try to create a helper function that executes arbitrary SQL
  // This uses the service role which bypasses RLS
  const createFn = `
    CREATE OR REPLACE FUNCTION exec_sql(sql_text text)
    RETURNS json
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $func$
    BEGIN
      EXECUTE sql_text;
      RETURN json_build_object('status', 'ok');
    EXCEPTION WHEN OTHERS THEN
      RETURN json_build_object('status', 'error', 'message', SQLERRM);
    END;
    $func$;
  `;

  // Execute via the raw SQL endpoint
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql_text: createFn }),
  });

  // If exec_sql doesn't exist yet, we need another way to bootstrap
  if (!res.ok) {
    console.log("exec_sql function doesn't exist yet. Trying alternative approach...");
    return false;
  }
  return true;
}

async function executeViaSupabaseAPI(sql) {
  // Try the Supabase v1 database query API
  const res = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/`, {
    method: "POST",
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      "X-Client-Info": "setup-db-script",
    },
  });
  return res;
}

async function main() {
  console.log(`Connecting to Supabase project: ${PROJECT_REF}`);
  console.log(`SQL file: ${sqlPath}`);

  // Try creating the exec_sql function first
  const hasExecFn = await createExecFunction();

  if (hasExecFn) {
    console.log("exec_sql function available. Executing schema...");
    const statements = splitStatements(fullSql);
    console.log(`Found ${statements.length} SQL statements`);

    let success = 0;
    let errors = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      const preview = stmt.slice(0, 80).replace(/\n/g, " ");
      try {
        const result = await executeSQL(stmt);
        if (result?.status === "error") {
          // Check if it's a "already exists" error (acceptable)
          if (result.message?.includes("already exists")) {
            console.log(`  [${i + 1}/${statements.length}] SKIP (exists): ${preview}`);
            success++;
          } else {
            console.error(`  [${i + 1}/${statements.length}] ERROR: ${result.message}`);
            console.error(`    Statement: ${preview}`);
            errors++;
          }
        } else {
          console.log(`  [${i + 1}/${statements.length}] OK: ${preview}`);
          success++;
        }
      } catch (err) {
        console.error(`  [${i + 1}/${statements.length}] FAILED: ${err.message}`);
        errors++;
      }
    }

    console.log(`\nDone: ${success} succeeded, ${errors} failed out of ${statements.length}`);

    // Clean up exec_sql function
    try {
      await executeSQL("DROP FUNCTION IF EXISTS exec_sql(text);");
      console.log("Cleaned up exec_sql helper function");
    } catch {
      // ignore
    }
  } else {
    console.error("\nCannot execute SQL remotely without exec_sql function.");
    console.error("Please execute the SQL manually in Supabase Dashboard:");
    console.error(`  ${SUPABASE_URL.replace('.supabase.co', '.supabase.co').replace('https://', 'https://supabase.com/dashboard/project/')}/sql/new`);
    console.error("\nOr provide a DATABASE_URL in .env.local for direct psql connection.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
