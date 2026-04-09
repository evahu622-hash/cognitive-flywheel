export const LLM_JUDGE_OPTIONS = [
  {
    name: "feed_summary_faithful",
    label: "Feed 忠实度",
    entryPoints: ["feed"],
  },
  {
    name: "feed_title_specific",
    label: "Feed 标题具体性",
    entryPoints: ["feed"],
  },
  {
    name: "feed_tags_relevant",
    label: "Feed 标签相关性",
    entryPoints: ["feed"],
  },
  {
    name: "feed_store_worthy",
    label: "Feed 入库价值",
    entryPoints: ["feed"],
  },
  {
    name: "think_mode_fit",
    label: "Think 模式符合度",
    entryPoints: ["think"],
  },
  {
    name: "think_grounded_in_context",
    label: "Think 上下文 grounding",
    entryPoints: ["think"],
  },
  {
    name: "think_specific_not_generic",
    label: "Think 具体性",
    entryPoints: ["think"],
  },
  {
    name: "think_actionable",
    label: "Think 可执行性",
    entryPoints: ["think"],
  },
  {
    name: "think_save_worthy",
    label: "Think 保存价值",
    entryPoints: ["think"],
  },
  {
    name: "feed_relationship_accurate",
    label: "Feed 关系分类准确性",
    entryPoints: ["feed"],
  },
  {
    name: "feed_spark_surprising",
    label: "Feed 跨域闪念启发性",
    entryPoints: ["feed"],
  },
  {
    name: "compile_faithful",
    label: "编译 综述忠实度",
    entryPoints: ["compile"],
  },
  {
    name: "compile_coherent",
    label: "编译 综述连贯性",
    entryPoints: ["compile"],
  },
  {
    name: "compile_incremental_correct",
    label: "编译 增量更新正确性",
    entryPoints: ["compile"],
  },
  {
    name: "lint_contradiction_valid",
    label: "Lint 矛盾检测准确性",
    entryPoints: ["lint"],
  },
  {
    name: "guardrail_fabricated_fact",
    label: "护栏: 编造事实",
    entryPoints: ["feed", "think", "compile"],
  },
  {
    name: "guardrail_overconfidence",
    label: "护栏: 过度确定",
    entryPoints: ["feed", "think", "compile"],
  },
] as const;

export type LLMJudgeName = (typeof LLM_JUDGE_OPTIONS)[number]["name"];
