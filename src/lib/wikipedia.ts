// Wikipedia API client — 为 mirror 模式提供事实锚点
// 返回纯文本 summary + canonical url，调用失败一律返回 null（永不抛）

const DEFAULT_TIMEOUT_MS = 8000;
const UA =
  "CognitiveFlywheel/1.0 (https://cognitive-flywheel.vercel.app; contact via GitHub)";

export type WikiLang = "zh" | "en";

export interface WikipediaFigure {
  /** 原始查询名（用户/LLM 给的名字，可能和实际页面 title 不同） */
  queryName: string;
  /** Wikipedia 页面实际 title（可能是重定向后的规范名） */
  title: string;
  /** 纯文本 summary（来自 REST v1 extract 字段，已去除标记） */
  extract: string;
  /** Canonical 页面 URL */
  url: string;
  /** 命中的语言 */
  lang: WikiLang;
  /** 缩略图 URL（可选） */
  thumbnail: string | null;
}

async function wikiFetch<T>(
  url: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 按关键词搜索 Wikipedia 页面标题，返回前 N 个候选。
 * 用于解决名字变体（如 "富兰克林" → "本杰明·富兰克林"）。
 */
export async function searchWikipedia(
  query: string,
  lang: WikiLang = "zh",
  limit: number = 3
): Promise<Array<{ title: string; snippet: string }>> {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
    query
  )}&format=json&utf8=1&srlimit=${limit}`;
  const data = await wikiFetch<{
    query?: { search?: Array<{ title: string; snippet: string }> };
  }>(url);
  if (!data?.query?.search) return [];
  return data.query.search.map((item) => ({
    title: item.title,
    snippet: item.snippet.replace(/<[^>]*>/g, ""),
  }));
}

/**
 * 按精确 title 获取 Wikipedia REST v1 summary。
 * 消歧义页（type=disambiguation）会被过滤掉。
 */
export async function getWikipediaSummary(
  title: string,
  lang: WikiLang = "zh"
): Promise<Omit<WikipediaFigure, "queryName"> | null> {
  const encodedTitle = encodeURIComponent(title.replace(/ /g, "_"));
  const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`;
  const data = await wikiFetch<{
    type?: string;
    title: string;
    extract?: string;
    content_urls?: { desktop?: { page?: string } };
    thumbnail?: { source?: string };
  }>(url);
  if (!data?.extract) return null;
  if (data.type === "disambiguation") return null;
  return {
    title: data.title,
    extract: data.extract,
    url:
      data.content_urls?.desktop?.page ??
      `https://${lang}.wikipedia.org/wiki/${encodedTitle}`,
    lang,
    thumbnail: data.thumbnail?.source ?? null,
  };
}

/**
 * 高级 API：按名字获取一位历史人物的 Wikipedia 事实摘录。
 *
 * 策略：
 * 1. 按 preferLang (默认 zh) 尝试直接 title 匹配
 * 2. 如果直接匹配失败或 extract 太短，改用 search 拿候选并逐个试
 * 3. 如果 preferLang 全部失败，切换到另一语言重复
 *
 * 所有网络错误静默吞掉，最终返回 null。
 */
export async function fetchWikipediaFigure(
  name: string,
  options: { preferLang?: WikiLang; minExtractLength?: number } = {}
): Promise<WikipediaFigure | null> {
  const { preferLang = "zh", minExtractLength = 80 } = options;
  const tryLangs: WikiLang[] =
    preferLang === "zh" ? ["zh", "en"] : ["en", "zh"];

  for (const lang of tryLangs) {
    // 1. 直接按给定 name 拉 summary
    const direct = await getWikipediaSummary(name, lang);
    if (direct && direct.extract.length >= minExtractLength) {
      return { queryName: name, ...direct };
    }

    // 2. search 回退
    const hits = await searchWikipedia(name, lang, 3);
    for (const hit of hits) {
      const summary = await getWikipediaSummary(hit.title, lang);
      if (summary && summary.extract.length >= minExtractLength) {
        return { queryName: name, ...summary };
      }
    }
  }

  return null;
}

/**
 * 批量并行拉取多位人物。
 * 结果里 figure 为 null 代表该名字在两种语言的 Wikipedia 都查不到。
 */
export async function fetchWikipediaFigures(
  names: string[],
  options?: { preferLang?: WikiLang; minExtractLength?: number }
): Promise<Array<{ queryName: string; figure: WikipediaFigure | null }>> {
  return Promise.all(
    names.map(async (name) => ({
      queryName: name,
      figure: await fetchWikipediaFigure(name, options),
    }))
  );
}
