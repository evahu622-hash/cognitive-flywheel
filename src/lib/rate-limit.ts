import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

type AppSupabase = SupabaseClient<Database>;
type EntryPoint = NonNullable<
  Database["public"]["Tables"]["eval_traces"]["Row"]["entry_point"]
>;

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export interface RateLimitResult {
  allowed: boolean;
  currentCount: number;
  maxRequests: number;
  retryAfterSeconds: number;
}

/**
 * 基于 eval_traces 表的用户级限流
 * 通过查询最近 windowMs 内该 user/entryPoint 的请求数来判断
 */
export async function checkRateLimit(
  supabase: AppSupabase,
  userId: string,
  entryPoint: EntryPoint,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - config.windowMs).toISOString();

  const { count, error } = await supabase
    .from("eval_traces")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("entry_point", entryPoint)
    .gte("created_at", windowStart);

  if (error) {
    console.warn("Rate limit check failed, allowing request:", error);
    return {
      allowed: true,
      currentCount: 0,
      maxRequests: config.maxRequests,
      retryAfterSeconds: 0,
    };
  }

  const currentCount = count ?? 0;
  const allowed = currentCount < config.maxRequests;

  return {
    allowed,
    currentCount,
    maxRequests: config.maxRequests,
    retryAfterSeconds: allowed ? 0 : Math.ceil(config.windowMs / 1000),
  };
}
