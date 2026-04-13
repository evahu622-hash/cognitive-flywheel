// ============================================================
// 多平台内容提取器
// 根据 URL 自动检测平台，路由到对应提取器
// ============================================================

export interface ExtractedContent {
  title: string;
  content: string;
  platform: "twitter" | "youtube" | "wechat" | "web";
  metadata?: Record<string, string>;
}

/** 内容提取失败时的错误，带用户友好提示 */
export class ExtractionError extends Error {
  constructor(
    message: string,
    public readonly userHint: string,
    public readonly platform: string,
  ) {
    super(message);
    this.name = "ExtractionError";
  }
}

// 微信/网页反爬、空内容的常见特征
const GARBAGE_INDICATORS = [
  "请在微信客户端打开",
  "环境异常",
  "网页由mp.weixin.qq.com提供",
  "访问过于频繁",
  "参数错误",
  "page not found",
  "404",
  "403 forbidden",
  "请输入验证码",
  "系统繁忙",
];

const MIN_CONTENT_LENGTH = 80;

/** 校验提取内容是否有效 */
function validateContent(content: string, platform: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length < MIN_CONTENT_LENGTH) {
    return `提取到的内容过短（${trimmed.length} 字），可能是反爬限制或页面异常`;
  }
  const lower = trimmed.toLowerCase();
  for (const indicator of GARBAGE_INDICATORS) {
    if (lower.includes(indicator.toLowerCase())) {
      return `检测到异常内容特征「${indicator}」，${platform === "wechat" ? "微信公众号" : "该网页"}可能阻止了内容抓取`;
    }
  }
  return null;
}

/** 检测 URL 平台并提取内容，含质量校验 */
export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  const platform = detectPlatform(url);

  let extracted: ExtractedContent;
  switch (platform) {
    case "twitter":
      extracted = await extractFromTwitter(url);
      break;
    case "youtube":
      extracted = await extractFromYouTube(url);
      break;
    case "wechat":
      extracted = await extractFromWechat(url);
      break;
    case "web":
    default:
      extracted = await extractFromWeb(url, platform);
      break;
  }

  // 质量校验：阻止空内容或垃圾内容进入管道
  const validationError = validateContent(extracted.content, platform);
  if (validationError) {
    const platformLabel =
      platform === "wechat" ? "微信公众号" : platform === "twitter" ? "X/Twitter" : "网页";
    throw new ExtractionError(
      validationError,
      `无法自动提取${platformLabel}内容。请复制文章原文粘贴到「想法」输入框中手动录入。`,
      platform,
    );
  }

  return extracted;
}

/** 检测 URL 所属平台 */
function detectPlatform(
  url: string
): "twitter" | "youtube" | "wechat" | "web" {
  const u = url.toLowerCase();
  if (u.includes("x.com/") || u.includes("twitter.com/")) return "twitter";
  if (
    u.includes("youtube.com/") ||
    u.includes("youtu.be/") ||
    u.includes("youtube.com/watch")
  )
    return "youtube";
  if (u.includes("mp.weixin.qq.com/")) return "wechat";
  return "web";
}

// ============================================================
// Twitter/X 提取器
// 使用 react-tweet 的 syndication API（无需 API Key）
// ============================================================

async function extractFromTwitter(url: string): Promise<ExtractedContent> {
  const tweetId = extractTweetId(url);
  if (!tweetId) {
    throw new Error("无法从 URL 中提取推文 ID");
  }

  try {
    const { getTweet } = await import("react-tweet/api");
    const tweet = await getTweet(tweetId);

    if (!tweet) {
      throw new Error("无法获取推文内容");
    }

    const userName = tweet.user?.name || "Unknown";
    const userHandle = tweet.user?.screen_name || "";
    const text = tweet.text || "";
    const createdAt = tweet.created_at || "";

    // 拼接完整内容
    const content = [
      `作者: ${userName} (@${userHandle})`,
      `时间: ${createdAt}`,
      "",
      text,
      // 如果有引用推文
      tweet.quoted_tweet ? `\n引用: ${tweet.quoted_tweet.text}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      title: `${userName}: ${text.slice(0, 60)}...`,
      content,
      platform: "twitter",
      metadata: { author: userName, handle: userHandle },
    };
  } catch (err) {
    // Syndication API 失败，尝试 oEmbed 回退
    try {
      return await extractTwitterViaOembed(url);
    } catch {
      throw new Error(
        `无法获取推文内容（${err instanceof Error ? err.message : "未知错误"}）。请复制推文文本粘贴到下方输入框`
      );
    }
  }
}

/** 从 URL 提取 Tweet ID */
function extractTweetId(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match ? match[1] : null;
}

/** oEmbed 回退方案 */
async function extractTwitterViaOembed(
  url: string
): Promise<ExtractedContent> {
  const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=true`;
  const res = await fetch(oembedUrl, {
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error("无法获取推文内容，请尝试粘贴推文文本");
  }

  const data = await res.json();
  // oEmbed 返回 HTML，清理成纯文本
  const text = (data.html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();

  return {
    title: `${data.author_name}: ${text.slice(0, 60)}...`,
    content: `作者: ${data.author_name}\n\n${text}`,
    platform: "twitter",
    metadata: { author: data.author_name },
  };
}

// ============================================================
// YouTube 提取器
// 提取视频字幕/文字稿
// ============================================================

async function extractFromYouTube(url: string): Promise<ExtractedContent> {
  const videoId = extractYouTubeId(url);
  if (!videoId) {
    throw new Error("无法从 URL 中提取 YouTube 视频 ID");
  }

  try {
    const { getSubtitles } = await import("youtube-caption-extractor");

    // 先尝试中文字幕，再英文
    let subtitles = await getSubtitles({ videoID: videoId, lang: "zh" }).catch(
      () => null
    );
    if (!subtitles || subtitles.length === 0) {
      subtitles = await getSubtitles({ videoID: videoId, lang: "en" }).catch(
        () => null
      );
    }

    if (!subtitles || subtitles.length === 0) {
      throw new Error("该视频没有可用的字幕");
    }

    const transcript = subtitles.map((s) => s.text).join(" ");

    // 尝试获取视频标题（通过 oEmbed）
    let title = `YouTube 视频 ${videoId}`;
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (oembedRes.ok) {
        const oembedData = await oembedRes.json();
        title = oembedData.title || title;
      }
    } catch {
      // 忽略
    }

    return {
      title,
      content: `视频标题: ${title}\n\n文字稿:\n${transcript}`,
      platform: "youtube",
      metadata: { videoId },
    };
  } catch {
    // 字幕提取失败，回退到 Jina Reader
    try {
      return await extractFromWeb(url, "youtube");
    } catch {
      throw new Error(
        "无法提取 YouTube 视频内容（该视频可能没有字幕）。请复制视频描述或字幕粘贴到下方输入框"
      );
    }
  }
}

/** 提取 YouTube 视频 ID */
function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ============================================================
// Playwright + Defuddle 提取器（用于微信、小红书、Jina 失败的回退）
// 本地用 playwright（devDep），Vercel 用 playwright-core + @sparticuz/chromium
// ============================================================

/** 根据环境启动 Chromium：Vercel 用 @sparticuz/chromium，本地用 playwright 内置 */
async function launchBrowser(extraArgs: string[] = []) {
  const commonArgs = [
    "--disable-blink-features=AutomationControlled",
    "--no-sandbox",
    "--disable-infobars",
    ...extraArgs,
  ];

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    // Serverless: playwright-core + @sparticuz/chromium
    const sparticuz = (await import("@sparticuz/chromium")).default;
    const { chromium } = await import("playwright-core");
    return chromium.launch({
      executablePath: await sparticuz.executablePath(),
      args: [...sparticuz.args, ...commonArgs],
      headless: true,
    });
  }

  // 本地开发: 优先用 playwright（devDep，自带浏览器管理）
  try {
    const { chromium } = await import("playwright");
    return chromium.launch({ headless: true, args: commonArgs });
  } catch {
    // playwright 不可用时，用 playwright-core + 系统 Chrome
    const { chromium } = await import("playwright-core");
    const executablePath =
      process.env.CHROMIUM_PATH ||
      (process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : "google-chrome");
    return chromium.launch({ headless: true, executablePath, args: commonArgs });
  }
}

/** 用 Playwright 加载页面并用 Defuddle 提取正文 */
async function extractWithPlaywright(
  url: string,
  options?: {
    waitSelector?: string;
    waitMs?: number;
    extraArgs?: string[];
  }
): Promise<{ title: string; content: string }> {
  const defuddleModule = await import("defuddle");
  const Defuddle = defuddleModule.default;
  const { parseHTML } = await import("linkedom");

  const browser = await launchBrowser(options?.extraArgs || []);

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "zh-CN",
      extraHTTPHeaders: { "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
    });

    // Stealth: remove webdriver detection flags
    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    const page = await context.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (options?.waitSelector) {
      await page.waitForSelector(options.waitSelector, { timeout: 15000 }).catch(() => {});
    }
    if (options?.waitMs) {
      await page.waitForTimeout(options.waitMs);
    }

    const html = await page.content();
    await browser.close();

    // 用 linkedom 解析 HTML，再用 Defuddle 提取正文
    const { document } = parseHTML(html);
    const result = new Defuddle(document, { url }).parse();

    // linkedom 不完全支持 Defuddle 的 markdown 转换，手动清理 HTML
    let content = result.content || "";
    content = content
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      title: result.title || "",
      content,
    };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

// ============================================================
// 微信公众号专用提取器（Playwright，Jina 已确认失效）
// ============================================================

async function extractFromWechat(url: string): Promise<ExtractedContent> {
  try {
    const result = await extractWithPlaywright(url, {
      waitSelector: "#js_content",
      waitMs: 2000,
    });

    return {
      title: result.title || url,
      content: result.content.slice(0, 50000),
      platform: "wechat",
      metadata: { source: "playwright" },
    };
  } catch (err) {
    throw new ExtractionError(
      `微信公众号内容提取失败: ${err instanceof Error ? err.message : "未知错误"}`,
      "无法自动提取微信公众号内容。请复制文章原文粘贴到「想法」输入框中手动录入。",
      "wechat",
    );
  }
}

// ============================================================
// 通用网页提取器
// 优先 Jina Reader → 失败则 Playwright + Defuddle 回退
// ============================================================

async function extractFromWeb(
  url: string,
  platform: string
): Promise<ExtractedContent> {
  // 优先使用 Jina Reader（快速路径）
  try {
    const readerUrl = `https://r.jina.ai/${url}`;
    const res = await fetch(readerUrl, {
      headers: {
        Accept: "application/json",
        ...(process.env.JINA_API_KEY
          ? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
          : {}),
      },
      signal: AbortSignal.timeout(30000),
    });

    if (res.ok) {
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const data = await res.json();
        if (data.content && data.content.length > 100) {
          return {
            title: data.title || url,
            content: data.content.slice(0, 50000),
            platform: platform as ExtractedContent["platform"],
          };
        }
      } else {
        const text = await res.text();
        if (text.length > 100) {
          const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/^Title:\s*(.+)$/m);
          return {
            title: titleMatch?.[1] || url,
            content: text.slice(0, 50000),
            platform: platform as ExtractedContent["platform"],
          };
        }
      }
    }
  } catch {
    // Jina Reader 失败，继续到 Playwright 回退
  }

  // 回退：Playwright + Defuddle（比纯 HTML strip 质量高得多）
  try {
    const result = await extractWithPlaywright(url, { waitMs: 2000 });
    return {
      title: result.title || url,
      content: result.content.slice(0, 50000),
      platform: platform as ExtractedContent["platform"],
      metadata: { source: "playwright" },
    };
  } catch {
    // Playwright 也失败，最终回退到简单 fetch
  }

  // 最终回退：直接 fetch + HTML 清理
  const res = await fetch(url, {
    headers: { "User-Agent": "CognitiveFlywheel/1.0" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    throw new Error(`无法获取内容: ${res.status}`);
  }

  const html = await res.text();
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    title: titleMatch?.[1]?.trim() || url,
    content: text.slice(0, 50000),
    platform: platform as ExtractedContent["platform"],
  };
}

// ============================================================
// 文件内容提取器
// ============================================================

/** 从 PDF 文件提取文本 */
export async function extractFromPdf(buffer: ArrayBuffer): Promise<string> {
  const { extractText } = await import("unpdf");
  const result = await extractText(new Uint8Array(buffer));
  const text = Array.isArray(result.text) ? result.text.join("\n") : result.text;
  return text.slice(0, 50000);
}

/** 从 DOCX 文件提取文本 */
export async function extractFromDocx(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(buffer),
  });
  return value.slice(0, 50000);
}
