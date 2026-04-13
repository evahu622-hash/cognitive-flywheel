import { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { MOCK_KNOWLEDGE } from "@/lib/mock-data";
import { searchKnowledge, summarizeRetrievalSources } from "@/lib/retrieval";

// ============================================================
// DELETE /api/knowledge — 删除知识条目
// ============================================================

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) {
    return Response.json({ error: "缺少 id 参数" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 先删关联
  await supabase
    .from("knowledge_connections")
    .delete()
    .or(`from_id.eq.${id},to_id.eq.${id}`);

  const { error } = await supabase
    .from("knowledge_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ success: true });
}

// ============================================================
// PATCH /api/knowledge — 更新知识条目（补充用户观点等）
// ============================================================

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, user_note } = body;

  if (!id) {
    return Response.json({ error: "缺少 id 参数" }, { status: 400 });
  }

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const updates: Record<string, unknown> = {};
  if (user_note !== undefined) updates.user_note = user_note;

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "没有要更新的字段" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("knowledge_items")
    .update(updates)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ item: data });
}

// ============================================================
// GET /api/knowledge — 知识库查询
// 支持文本搜索 + 向量语义搜索（混合模式）
// ============================================================

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const domain = searchParams.get("domain") || "";
  const wantSummaries = searchParams.get("summaries") === "true";

  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  // 领域综述查询
  if (wantSummaries && user) {
    const { data: summaries } = await supabase
      .from("knowledge_summaries")
      .select("id, domain, compiled_content, source_ids, version, last_compiled_at")
      .eq("user_id", user.id)
      .order("last_compiled_at", { ascending: false });
    return Response.json({ summaries: summaries ?? [] });
  }

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
    .select("id, type, title, summary, tags, domain, source_url, raw_content, key_points, user_note, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (domain) query = query.eq("domain", domain);
  if (search) {
    const escaped = search.replace(/%/g, "\\%").replace(/_/g, "\\_").replace(/,/g, "");
    query = query.or(`title.ilike.%${escaped}%,summary.ilike.%${escaped}%`);
  }

  const { data: items, error } = await query;
  if (error) {
    console.error("Knowledge query error:", error);
    return Response.json({ mode: "demo", items: MOCK_KNOWLEDGE });
  }

  return Response.json({ mode: "live", items: items ?? [] });
}
