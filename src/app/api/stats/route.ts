import { createServerSupabase } from "@/lib/supabase-server";
import { COGNITIVE_PROFILE } from "@/lib/mock-data";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return Response.json({ mode: "demo", stats: COGNITIVE_PROFILE });
  }

  try {
    const { data, error } = await supabase.rpc("get_cognitive_stats");
    if (error) throw error;

    const DOMAIN_COLORS: Record<string, string> = {
      投资: "#3B82F6",
      "Agent Building": "#8B5CF6",
      健康: "#10B981",
      一人公司: "#F59E0B",
      跨领域: "#EC4899",
    };

    const stats = {
      ...data,
      domains: (data.domains ?? []).map(
        (d: { name: string; count: number }) => ({
          ...d,
          color: DOMAIN_COLORS[d.name] || "#6B7280",
        })
      ),
      blindSpots: COGNITIVE_PROFILE.blindSpots,
    };

    return Response.json({ mode: "live", stats });
  } catch (err) {
    console.error("Stats error:", err);
    return Response.json({ mode: "demo", stats: COGNITIVE_PROFILE });
  }
}
