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

/** 检测 URL 平台并提取内容 */
export async function extractFromUrl(url: string): Promise<ExtractedContent> {
  const platform = detectPlatform(url);

  switch (platform) {
    case "twitter":
      return extractFromTwitter(url);
    case "youtube":
      return extractFromYouTube(url);
    case "wechat":
    case "web":
    default:
      return extractFromWeb(url, platform);
  }
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
// 通用网页 / 微信公众号提取器
// 使用 Jina Reader（支持 JS 渲染页面）
// ============================================================

async function extractFromWeb(
  url: string,
  platform: string
): Promise<ExtractedContent> {
  // 优先使用 Jina Reader
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
            content: data.content.slice(0, 8000),
            platform: platform as ExtractedContent["platform"],
          };
        }
      } else {
        const text = await res.text();
        if (text.length > 100) {
          // 从 markdown 中提取标题
          const titleMatch = text.match(/^#\s+(.+)$/m) || text.match(/^Title:\s*(.+)$/m);
          return {
            title: titleMatch?.[1] || url,
            content: text.slice(0, 8000),
            platform: platform as ExtractedContent["platform"],
          };
        }
      }
    }
  } catch {
    // Jina Reader 失败
  }

  // 回退：直接 fetch + HTML 清理
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

  // 尝试提取 title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);

  return {
    title: titleMatch?.[1]?.trim() || url,
    content: text.slice(0, 8000),
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
  return text.slice(0, 10000);
}

/** 从 DOCX 文件提取文本 */
export async function extractFromDocx(buffer: ArrayBuffer): Promise<string> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({
    buffer: Buffer.from(buffer),
  });
  return value.slice(0, 10000);
}
