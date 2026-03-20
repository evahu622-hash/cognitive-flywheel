import { streamText, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

// Model registry - easy to switch providers
function getModel(modelId: string): LanguageModel {
  switch (modelId) {
    case "gpt-4o":
      return openai("gpt-4o");
    case "gemini-pro":
      return google("gemini-2.0-flash");
    case "claude-sonnet":
    default:
      return anthropic("claude-sonnet-4-20250514");
  }
}

export async function POST(req: Request) {
  const { messages, model = "claude-sonnet" } = await req.json();

  const selectedModel = getModel(model);

  const result = streamText({
    model: selectedModel,
    system: `你是 Cognitive Flywheel（认知飞轮）的 AI 外脑。
你的角色是帮助用户深度思考，而不是简单回答问题。

你有四种思考模式：
1. 圆桌会议：以多位专家的视角分析问题
2. 认知教练：发现用户的知识盲区，推荐学习路径
3. 跨域连接：从其他领域寻找灵感和类比
4. 历史镜鉴：找到历史上遇到类似问题的先驱

核心原则：
- 帮用户思考，而非替用户思考
- 挑战用户的假设，而非一味赞同
- 建立知识关联，而非孤立分析
- 每次思考后，总结可以回流到记忆层的关键洞察`,
    messages,
  });

  return result.toTextStreamResponse();
}
