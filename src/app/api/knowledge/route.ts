import { createServerSupabase } from "@/lib/supabase-server";
import { MOCK_KNOWLEDGE } from "@/lib/mock-data";
import { searchKnowledge, summarizeRetrievalSources } from "@/lib/retrieval";

// ============================================================
// GET /api/knowledge — 知识库查询
// 支持文本搜索 + 向量语义搜索（混合模式）
// ============================================================

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const domain = searchParams.get("domain") || "";

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // Demo 模式（未配置或未登录）
  if (!user) {
    let items = [...MOCK_KNOWLEDGE];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.summary.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (domain) items = items.filter((i) => i.domain === domain);
    return Response.json({ mode: "demo", items });
  }

  if (search) {
    try {
      const items = await searchKnowledge(search, {
        supabase,
        limit: 20,
        domain: domain || null,
        semanticThreshold: 0.5,
      });
      return Response.json({
        mode: "live",
        items,
        retrievalSources: summarizeRetrievalSources(items),
      });
    } catch (err) {
      console.error("Knowledge search error:", err);
    }
  }

  // 常规查询
  let query = supabase
    .from("knowledge_items")
    .select("id, type, title, summary, tags, domain, source_url, raw_content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (domain) query = query.eq("domain", domain);
  if (search) {
    query = query.or(`title.ilike.%${search}%,summary.ilike.%${search}%`);
  }

  const { data: items, error } = await query;
  if (error) {
    console.error("Knowledge query error:", error);
    return Response.json({ mode: "demo", items: MOCK_KNOWLEDGE });
  }

  return Response.json({ mode: "live", items: items ?? [] });
}
