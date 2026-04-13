import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

// Note: embedding 向量检索已废弃，知识检索改为全文搜索 + LLM 精排（见 retrieval.ts）

// ============================================================
// 统一模型注册表
// 所有 AI 调用通过此模块获取模型实例，支持环境变量灵活切换
// ============================================================

/** 模型用途分类 */
export type ModelPurpose = "light" | "heavy" | "embed";

/** 支持的模型名称 */
export type ModelName =
  | "claude-haiku"
  | "claude-sonnet"
  | "claude-opus"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gemini-flash"
  | "gemini-pro"
  | "deepseek"
  | "minimax-fast";

/** 模型名称 → Vercel AI SDK 模型实例 */
const MODEL_REGISTRY: Record<string, () => LanguageModel> = {
  "claude-haiku": () => anthropic("claude-haiku-4-5-20251001"),
  "claude-sonnet": () => anthropic("claude-sonnet-4-6-20250620"),
  "claude-opus": () => anthropic("claude-opus-4-6-20250610"),
  "gpt-4o": () => openai("gpt-4o"),
  "gpt-4o-mini": () => openai("gpt-4o-mini"),
  "gemini-flash": () => google("gemini-2.0-flash"),
  "gemini-pro": () => google("gemini-2.5-pro"),
  "deepseek": () => {
    const deepseek = createOpenAI({ baseURL: "https://api.deepseek.com/v1", apiKey: process.env.DEEPSEEK_API_KEY });
    return deepseek("deepseek-chat") as LanguageModel;
  },
  "minimax-fast": () => {
    const minimax = createOpenAICompatible({
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: process.env.MINIMAX_API_KEY,
      name: "minimax",
    });
    return minimax("MiniMax-M2.7-highspeed") as LanguageModel;
  },
};

/** 各用途的默认模型（可被 env var AI_LIGHT_MODEL / AI_HEAVY_MODEL 覆盖） */
const PURPOSE_DEFAULTS: Record<ModelPurpose, ModelName> = {
  light: "minimax-fast",
  heavy: "minimax-fast",
  embed: "gpt-4o-mini", // 占位，embedding 已废弃
};

/**
 * 按用途获取模型实例
 * 优先读取环境变量 AI_LIGHT_MODEL / AI_HEAVY_MODEL
 */
export function getModel(purpose: ModelPurpose): LanguageModel {
  const modelName = getConfiguredModelName(purpose);
  return getModelByName(modelName);
}

/**
 * 按用途获取当前解析后的模型名称
 */
export function getConfiguredModelName(purpose: ModelPurpose): ModelName {
  const envKey = `AI_${purpose.toUpperCase()}_MODEL`;
  // trim() 兜底 Vercel env var 被粘贴成 "minimax-fast\n" 这种含尾随空白的值,
  // 否则 MODEL_REGISTRY 查不到会 fallback 到 Object.keys() 的第一个,
  // 也就是 claude-haiku → 没有 ANTHROPIC_API_KEY → 抛错
  const raw = process.env[envKey];
  const trimmed = typeof raw === "string" ? raw.trim() : undefined;
  return (
    (trimmed && trimmed.length > 0 ? (trimmed as ModelName) : undefined) ??
    PURPOSE_DEFAULTS[purpose]
  );
}

/**
 * 按名称获取模型实例
 * 支持前端 API 参数 override
 */
/** 兜底模型链：如果首选模型不可用，按顺序尝试 */
const FALLBACK_CHAINS: Record<string, string[]> = {
  "minimax-fast": ["gpt-4o-mini", "claude-haiku"],
  "claude-haiku": ["minimax-fast", "gpt-4o-mini"],
  "claude-sonnet": ["minimax-fast", "gpt-4o"],
  "gpt-4o": ["claude-sonnet", "minimax-fast"],
  "gpt-4o-mini": ["claude-haiku", "minimax-fast"],
};

export function getModelByName(name: string): LanguageModel {
  // Defensive trim: 同理于 getConfiguredModelName,防止被带空白的字符串绊倒
  const trimmedName = typeof name === "string" ? name.trim() : name;
  const factory = MODEL_REGISTRY[trimmedName];
  if (!factory) {
    console.warn(`Unknown model "${trimmedName}" (raw="${name}"), trying fallback chain`);
    // 默认 fallback 链把 minimax-fast 放最前面,避免无 API key 的 claude-haiku 被误选
    const fallbacks =
      FALLBACK_CHAINS[trimmedName] ?? ["minimax-fast", "gpt-4o-mini", "claude-haiku"];
    for (const fallbackName of fallbacks) {
      const fallbackFactory = MODEL_REGISTRY[fallbackName];
      if (fallbackFactory) {
        console.warn(`Using fallback model: ${fallbackName}`);
        return fallbackFactory();
      }
    }
    // 最后兜底：用注册表中第一个可用的模型
    const firstFactory = Object.values(MODEL_REGISTRY)[0];
    return firstFactory();
  }
  return factory();
}

/**
 * 获取所有可用模型名称列表（可用于前端下拉选择）
 */
export function getAvailableModels(): { name: string; label: string }[] {
  return [
    { name: "claude-haiku", label: "Claude Haiku (快速)" },
    { name: "claude-sonnet", label: "Claude Sonnet (均衡)" },
    { name: "claude-opus", label: "Claude Opus (最强)" },
    { name: "gpt-4o", label: "GPT-4o" },
    { name: "gpt-4o-mini", label: "GPT-4o Mini (快速)" },
    { name: "gemini-flash", label: "Gemini Flash (快速)" },
    { name: "gemini-pro", label: "Gemini Pro" },
    { name: "deepseek", label: "DeepSeek" },
    { name: "minimax-fast", label: "MiniMax M2.7 Highspeed" },
  ];
}
