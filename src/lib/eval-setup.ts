const EVAL_SETUP_HINT =
  "Run supabase/migrations/add-evals.sql on the remote database to enable eval tables.";

export function isMissingEvalTableMessage(message: string | undefined | null) {
  if (!message) return false;
  return (
    message.includes("Could not find the table 'public.eval_") ||
    message.includes('relation "public.eval_') ||
    message.includes("schema cache")
  );
}

export function buildEvalSetupRequiredPayload(message?: string | null) {
  return {
    setupRequired: true,
    error: message ?? "Eval tables are not available",
    hint: EVAL_SETUP_HINT,
    requiredSqlPath: "supabase/migrations/add-evals.sql",
  };
}
