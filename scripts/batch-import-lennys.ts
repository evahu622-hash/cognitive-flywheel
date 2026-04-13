/**
 * 批量导入 Lenny's 播客和 newsletter 数据到认知飞轮
 *
 * 用法: npx tsx scripts/batch-import-lennys.ts [--podcasts] [--newsletters] [--limit N]
 *       npx tsx scripts/batch-import-lennys.ts --only-indices <file>   # 只处理指定 1-based 索引
 *
 * 直接通过 AI API + Supabase 插入，跳过 HTTP 层，更高效
 */

import { createClient } from "@supabase/supabase-js";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText } from "ai";
import * as fs from "fs";
import * as path from "path";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const TEST_USER_ID = process.env.TEST_USER_ID || "a6878442-0a0b-4df8-9bbc-aca802fb5510";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 使用 minimax-fast
const minimax = createOpenAICompatible({
  baseURL: "https://api.minimaxi.com/v1",
  apiKey: process.env.MINIMAX_API_KEY!,
  name: "minimax",
});
const model = minimax("MiniMax-M2.7-highspeed");

const BASE_DIR = path.resolve(__dirname, "../lenny\u2018s/lennys-newsletterpodcastdata-all");

interface ParsedFile {
  filePath: string;
  title: string;
  date: string;
  type: string;
  guest?: string;
  tags: string[];
  content: string;
  wordCount: number;
}

function parseMarkdownFile(filePath: string): ParsedFile | null {
  const raw = fs.readFileSync(filePath, "utf-8");

  // Parse YAML frontmatter
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;

  const frontmatter = fmMatch[1];
  const content = fmMatch[2].trim();

  const getField = (name: string): string => {
    const m = frontmatter.match(new RegExp(`^${name}:\\s*"?([^"\\n]*)"?`, "m"));
    return m ? m[1].trim() : "";
  };

  const tagsMatch = frontmatter.match(/tags:\s*\[(.*?)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(",").map((t) => t.trim().replace(/"/g, ""))
    : [];

  const wordCountMatch = frontmatter.match(/word_count:\s*(\d+)/);
  const wordCount = wordCountMatch ? parseInt(wordCountMatch[1]) : content.split(/\s+/).length;

  return {
    filePath,
    title: getField("title"),
    date: getField("date"),
    type: getField("type"),
    guest: getField("guest") || undefined,
    tags,
    content,
    wordCount,
  };
}

interface AnalysisResult {
  type: "article" | "thought" | "insight";
  title: string;
  summary: string;
  keyPoints: string[];
  tags: string[];
  domain: string;
}

async function analyzeContent(
  content: string,
  originalTitle: string,
  contentType: string,
): Promise<AnalysisResult> {
  const contentForAnalysis = content.slice(0, 30000);

  const { text } = await generateText({
    model,
    system: `你是认知飞轮的内容分析引擎。分析用户输入的内容，返回 JSON 格式结果。
这是一篇来自 Lenny Rachitsky 的${contentType === "podcast" ? "播客逐字稿" : "newsletter 文章"}。

领域必须是以下之一：投资、Agent Building、健康、一人公司、跨领域

## 标题要求
- 用中文重新拟标题，必须包含核心论点、关键人名或方法论
- 禁止使用"关于XX的讨论"这类套话
- 好的标题示例："Nir Eyal: 90%的分心源于内心不适感，而非技术干扰——四步掌控注意力"

## 摘要要求
- 3-5句话，必须覆盖内容的核心论点和关键结论
- 提及具体方法论、数据、案例名称
- 不要只说"讨论了XX"，要说"提出了XX"

## 核心观点要求（keyPoints）
- 提取 4-8 个有洞察力的核心观点
- 每个观点必须具体、可操作，包含方法论或数据
- 禁止空泛的概括（如"产品很重要"）
- 好的要点："用户留存的关键指标是 D7 留存率超过 25%，低于这个阈值说明产品-市场匹配度不足"

## 标签要求
- 3-5个标签，优先使用具体人名、方法论名称、核心概念
- 不要用"AI""技术""产品"等过于宽泛的标签

只返回合法 JSON，不要包含 markdown 代码块。`,
    prompt: `原标题: ${originalTitle}

内容:
${contentForAnalysis}

返回格式：
{"type":"article","title":"具体中文标题","summary":"3-5句话的完整摘要","keyPoints":["要点1","要点2","要点3","要点4"],"tags":["标签1","标签2","标签3"],"domain":"跨领域"}`,
  });

  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // fallthrough
      }
    }
    return {
      type: "article",
      title: originalTitle,
      summary: content.slice(0, 200),
      keyPoints: [],
      tags: [],
      domain: "跨领域",
    };
  }
}

async function importFile(parsed: ParsedFile, index: number, total: number): Promise<boolean> {
  const label = `[${index + 1}/${total}]`;
  try {
    console.log(`${label} Analyzing: ${parsed.title.slice(0, 60)}...`);

    const analysis = await analyzeContent(parsed.content, parsed.title, parsed.type);

    // 兜底：确保关键字段不为 null
    const VALID_DOMAINS = ["投资", "Agent Building", "健康", "一人公司", "跨领域"];
    const domain = VALID_DOMAINS.includes(analysis.domain) ? analysis.domain : "跨领域";
    const keyPoints = Array.isArray(analysis.keyPoints) ? analysis.keyPoints : [];
    const title = analysis.title || parsed.title;

    const { error } = await supabase.from("knowledge_items").insert({
      user_id: TEST_USER_ID,
      type: analysis.type || "article",
      title,
      summary: analysis.summary || parsed.content.slice(0, 200),
      tags: analysis.tags || [],
      domain,
      source_type: "text",
      raw_content: parsed.content.slice(0, 50000),
      key_points: keyPoints,
    });

    if (error) {
      console.error(`${label} DB insert error:`, error.message);
      return false;
    }

    console.log(
      `${label} OK: "${title.slice(0, 50)}" | ${keyPoints.length} points | ${domain}`,
    );
    return true;
  } catch (err) {
    console.error(`${label} Failed: ${parsed.title.slice(0, 40)}`, err instanceof Error ? err.message : err);
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const doPodcasts = args.includes("--podcasts") || (!args.includes("--newsletters"));
  const doNewsletters = args.includes("--newsletters") || (!args.includes("--podcasts"));
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]) : Infinity;

  const onlyIdx = args.indexOf("--only-indices");
  let onlySet: Set<number> | null = null;
  if (onlyIdx >= 0) {
    const file = args[onlyIdx + 1];
    const raw = fs.readFileSync(file, "utf-8");
    onlySet = new Set(
      raw
        .split(/\s+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n) && n > 0),
    );
    console.log(`--only-indices: ${onlySet.size} unique 1-based indices loaded from ${file}`);
  }

  const files: ParsedFile[] = [];

  if (doPodcasts) {
    const podDir = path.join(BASE_DIR, "03-podcasts");
    if (fs.existsSync(podDir)) {
      const podFiles = fs.readdirSync(podDir).filter((f) => f.endsWith(".md")).sort();
      for (const f of podFiles) {
        const parsed = parseMarkdownFile(path.join(podDir, f));
        if (parsed) files.push(parsed);
      }
      console.log(`Found ${podFiles.length} podcast files`);
    }
  }

  if (doNewsletters) {
    const nlDir = path.join(BASE_DIR, "02-newsletters");
    if (fs.existsSync(nlDir)) {
      const nlFiles = fs.readdirSync(nlDir).filter((f) => f.endsWith(".md")).sort();
      for (const f of nlFiles) {
        const parsed = parseMarkdownFile(path.join(nlDir, f));
        if (parsed) files.push(parsed);
      }
      console.log(`Found ${nlFiles.length} newsletter files`);
    }
  }

  const toProcess = files.slice(0, limit);

  const indicesToRun: number[] = onlySet
    ? Array.from({ length: toProcess.length }, (_, i) => i).filter((i) => onlySet!.has(i + 1))
    : Array.from({ length: toProcess.length }, (_, i) => i);

  if (onlySet) {
    console.log(
      `Retry mode: processing ${indicesToRun.length} / ${toProcess.length} files (${onlySet.size} requested)`,
    );
  } else {
    console.log(`Processing ${toProcess.length} files...\n`);
  }

  let success = 0;
  let failed = 0;

  for (const i of indicesToRun) {
    const ok = await importFile(toProcess[i], i, toProcess.length);
    if (ok) success++;
    else failed++;

    // Rate limit: 100ms between requests
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Success: ${success} | Failed: ${failed} | Attempted: ${indicesToRun.length}`);
}

main().catch(console.error);
