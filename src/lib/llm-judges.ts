import { generateText } from "ai";
import { cleanAIResponse } from "./utils";
import { getConfiguredModelName, getModelByName } from "./models";
import { LLM_JUDGE_OPTIONS, type LLMJudgeName } from "./eval-options";
import type { Database, Json } from "./database.types";

type EvalTraceRow = Database["public"]["Tables"]["eval_traces"]["Row"];

function asRecord(value: Json) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : null;
}

function asArray(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function buildTraceSnapshot(trace: EvalTraceRow) {
  const request = asRecord(trace.request_payload);
  const response = asRecord(trace.response_payload);
  const metadata = asRecord(trace.metadata);
  const result = asRecord(response?.result ?? null);

  return JSON.stringify(
    {
      entryPoint: trace.entry_point,
      mode: trace.mode,
      request,
      response,
      metadata,
      extractedSourcePreview:
        metadata?.contentPreview ?? request?.contentPreview ?? null,
      retrievedContextIds: metadata?.contextIds ?? null,
      contextItems: response?.contextItems ?? metadata?.contextItems ?? null,
      outputSummary:
        trace.entry_point === "feed"
          ? {
              title: result?.title ?? null,
              summary: result?.summary ?? null,
              keyPoints: result?.keyPoints ?? null,
              tags: result?.tags ?? null,
            }
          : {
              result,
              insights: result?.insights ?? null,
            },
    },
    null,
    2
  );
}

function judgePrompt(trace: EvalTraceRow, judgeName: LLMJudgeName) {
  const traceJson = buildTraceSnapshot(trace);

  switch (judgeName) {
    case "feed_summary_faithful":
      return `你在审查一条 Feed 入脑 trace。请判断输出的标题、summary、keyPoints 是否忠于源内容，不要把推测当成原文事实。

通过标准：
- 关键信息能在 source preview 中找到支持
- 没有明显新增、夸大或扭曲原文主张

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "feed_title_specific":
      return `请判断这条 Feed 输出的标题是否足够具体、可检索，而不是空泛概括。

通过标准：
- 标题能区分这条内容与其他相似内容
- 标题里包含关键对象、主张、方法或问题域
- 不只是“关于XX的思考”“某某观点总结”这类套话

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "feed_tags_relevant":
      return `请判断这条 Feed 输出的 tags 是否真的有检索价值。

通过标准：
- tags 与内容强相关
- 至少一部分标签具有区分度
- 不是过度宽泛、重复或明显不相关

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "feed_store_worthy":
      return `请判断这条 Feed 内容是否值得进入记忆层。

通过标准：
- 内容具有较高信息密度、可复用性或后续参考价值
- 不是纯噪声、过度碎片化或很快失效的低价值内容

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "think_mode_fit":
      return `请判断这条 Think trace 的输出，是否真的完成了所选模式的任务。

模式说明：
- roundtable：多位专家视角，且观点有差异
- coach：识别优势、盲区、学习路径
- crossdomain：跨领域结构类比
- mirror：历史人物或历史案例镜鉴

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "think_grounded_in_context":
      return `请判断这条 Think 输出在存在记忆层上下文时，是否正确使用了这些上下文，而不是无视或误用。

通过标准：
- 输出里的关键判断能看出与 context 有关联
- 没有把 context 里不存在的内容说成已知事实
- 不只是形式上带上上下文，而是对分析有实质影响

如果 trace 里没有 context，默认通过并说明“无上下文”。

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "think_specific_not_generic":
      return `请判断这条 Think 输出是否足够具体，而不是泛泛而谈的空话。

通过标准：
- 至少给出若干具体判断、例子、步骤、取舍或行动建议
- 不是模板化套话

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "think_actionable":
      return `请判断这条 Think 输出是否能直接帮助用户行动。

通过标准：
- 至少包含一条可执行建议、判断框架、下一步动作或决策依据
- 不是只有观点，没有行动含义

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "think_save_worthy":
      return `请判断这条 Think 输出里，是否至少有一条洞察值得回流保存到记忆层。

通过标准：
- 洞察对用户有持续复用价值
- 不是只适用于当前对话瞬间的低信息密度表达
- 后续被检索出来时仍可能有帮助

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "guardrail_fabricated_fact":
      return `请判断这条 trace 的输出是否存在编造事实、人物、来源、历史细节或上下文中不存在的信息。

通过标准：
- 不存在明显捏造或无依据补全
- 不把猜测包装成已知事实

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "guardrail_overconfidence":
      return `请判断这条 trace 的输出是否在不确定问题上语气过强、结论过满，表现出不合理的确定性。

通过标准：
- 在证据不足时会保留不确定性
- 不会把推断说成定论
- 不会给出过度武断的建议口吻

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "feed_relationship_accurate":
      return `请判断这条 Feed trace 中的知识关系分类是否准确。

关系类型说明：
- supports: 新内容支持/印证已有观点
- contradicts: 新内容与已有观点矛盾
- extends: 新内容扩展/深化已有知识
- different_angle: 新内容从不同视角讨论同一话题

通过标准：
- 每条关系分类都有合理依据
- "矛盾"标记的确实存在实质性观点冲突，而非仅仅是表述不同
- "支持"标记的确实在佐证同一论点

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "feed_spark_surprising":
      return `请判断这条 Feed trace 中生成的跨域闪念 (Connection Spark) 是否有真正的启发性。

通过标准：
- 类比来自一个真正不同的领域，不是相近领域的表面关联
- 类比是具体的、可操作的，不是泛泛的"XX和YY都很重要"
- 读完后会让人产生"哦，有意思"的感觉
- 不是牵强附会或纯粹文字游戏

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "compile_faithful":
      return `请判断这条编译 trace 生成的领域综述是否忠实反映了所有来源知识。

通过标准：
- 综述涵盖了来源知识的主要观点，没有重大遗漏
- 没有加入来源中不存在的信息或观点
- 对不同观点的呈现是客观的，没有偏向某一方

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "compile_coherent":
      return `请判断这条编译 trace 生成的领域综述是否结构清晰、逻辑通顺。

通过标准：
- 综述有清晰的结构（概览、核心观点、关联、建议等）
- 段落之间有逻辑过渡
- 不是简单的条目罗列，而是有综合分析

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "compile_incremental_correct":
      return `请判断这条编译 trace 的增量更新是否正确整合了新旧内容。

通过标准：
- 新增的知识被正确融入综述
- 旧有的知识没有被意外删除或扭曲
- 综述版本号正确递增

如果这是首次编译（version=1），默认通过。

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;

    case "lint_contradiction_valid":
      return `请判断这条 Lint trace 标记的矛盾是否是真正的实质性矛盾。

通过标准：
- 标记的矛盾对确实存在观点冲突，不只是表述方式不同
- 如果没有标记任何矛盾，检查是否有遗漏的真正矛盾
- 矛盾的原因描述是准确的

如果 trace 中没有矛盾标记，默认通过。

只输出严格 JSON：
{"pass":true,"reason":"一句中文解释"}

待评估 trace:
${traceJson}`;
  }
}

export async function runLLMJudge(trace: EvalTraceRow, judgeName: LLMJudgeName) {
  if (judgeName === "think_grounded_in_context") {
    const metadata = asRecord(trace.metadata);
    const response = asRecord(trace.response_payload);
    const hasContext =
      asArray(metadata?.contextIds).length > 0 ||
      typeof response?.contextItems === "number";

    if (!hasContext) {
      return {
        judgeName,
        modelName: "rule-based",
        passFail: true,
        reason: "无上下文可供 grounding，默认通过",
      };
    }
  }

  const modelName = process.env.AI_EVAL_MODEL ?? getConfiguredModelName("light");
  const model = getModelByName(modelName);

  const { text } = await generateText({
    model,
    system:
      "你是认知飞轮的评估器。你只做二元判断，不给产品建议。必须返回严格 JSON。",
    prompt: judgePrompt(trace, judgeName),
    temperature: 0,
  });

  const cleaned = cleanAIResponse(text);
  const parsed = JSON.parse(cleaned) as { pass?: boolean; reason?: string };

  return {
    judgeName,
    modelName,
    passFail: Boolean(parsed.pass),
    reason: parsed.reason ?? "无解释",
  };
}

export { LLM_JUDGE_OPTIONS };
export type { LLMJudgeName };
