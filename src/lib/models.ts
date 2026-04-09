import { type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

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
  | "minimax";

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
  "minimax": () => {
    const minimax = createOpenAICompatible({
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: process.env.MINIMAX_API_KEY,
      name: "minimax",
    });
    return minimax("MiniMax-M2.7") as LanguageModel;
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

/** 各用途的默认模型 */
const PURPOSE_DEFAULTS: Record<ModelPurpose, ModelName> = {
  light: "claude-haiku",
  heavy: "claude-sonnet",
  embed: "gpt-4o-mini", // embed 用途此处不返回 LanguageModel，仅做 fallback 标记
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
  return (
    (process.env[envKey] as ModelName | undefined) ??
    PURPOSE_DEFAULTS[purpose]
  );
}

/**
 * 按名称获取模型实例
 * 支持前端 API 参数 override
 */
export function getModelByName(name: string): LanguageModel {
  const factory = MODEL_REGISTRY[name];
  if (!factory) {
    console.warn(`Unknown model "${name}", falling back to claude-sonnet`);
    return MODEL_REGISTRY["claude-sonnet"]();
  }
  return factory();
}

/**
 * 获取嵌入模型
 * 支持环境变量 AI_EMBED_MODEL 切换
 */
export function getEmbeddingModel() {
  const modelName = getEmbeddingModelName();
  return openai.embedding(modelName);
}

export function getEmbeddingModelName() {
  return process.env.AI_EMBED_MODEL ?? "text-embedding-3-small";
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
    { name: "minimax", label: "MiniMax M2.7" },
  ];
}
