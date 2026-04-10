# 线上质量监控操作手册

适用对象：第一次接触本项目的实习生  
适用范围：`feed`、`think`、`save_insight`、`compile`、`lint` 这几条主评测链路的日常线上质量监控

## 1. 你要完成什么

你的工作不是“盯日志”，而是每天用评测系统回答 4 个问题：

1. 今天产品整体质量有没有明显变差？
2. 如果变差，是哪个入口先出问题？
3. 是覆盖问题、质量问题，还是人工复核积压问题？
4. 哪几条 trace 最值得交给工程师排查？

你主要会用到两个地方：

- 产品页面 `/evals`
- 命令行脚本 `evals:dataset-report` 和 `evals:gate`

## 2. 先理解 5 个名词

### 2.1 trace

一次用户功能调用的总记录。  
例如用户发起一次 `think`，系统会创建一条 `eval_trace`。

### 2.2 span

trace 里的阶段记录。  
例如一次 `think` 里可能有：

- 检索上下文
- 生成回答
- 持久化 session

### 2.3 eval result

自动评测结果，分两类：

- `code evaluator`：结构校验、字段校验、硬规则
- `llm judge`：语义质量、忠实度、护栏

### 2.4 feedback

真实用户行为反馈。  
最重要的是：

- `save`
- `skip`

### 2.5 label

人工复核结果。  
你会在 `Review Queue` 里给 trace 打：

- `dataset_name`
- `failure_code`
- `pass/fail`
- `notes`

## 3. 每天的标准巡检流程

每天至少做 1 次完整巡检。建议上午做一次，如果当天有发布，发布后再做一次。

### 3.1 打开 `/evals`，先看 `Overview`

顺序不要乱，按下面看：

1. `High-Value Turns`
2. `Reuse Rate`
3. `Auto Eval Coverage`
4. `Review Coverage`
5. `Flywheel Funnel`
6. `Recent Trend`
7. `Entry Point Health`

### 3.2 看哪些信号说明“需要继续往下查”

满足任意一条，就进入 `Diagnosis`：

- `High-Value Turns` 明显下降
- `Auto Eval Coverage` 低于你最近几天的正常水平
- `Guardrail Fail` 在趋势里抬头
- `Entry Point Health` 中某个入口的 `Quality` 明显下降
- `Entry Point Health` 中某个入口的 `Judge` 或 `Review` 覆盖显著偏低

### 3.3 在 `Overview` 里每一块怎么读

#### North Star Cards

- `High-Value Turns`
  重点看价值链路是否变差。它主要反映 `feed / think / save_insight` 的有效质量。
- `Reuse Rate`
  重点看回流机制是否还在工作。
- `Auto Eval Coverage`
  如果低，先怀疑评测接线或后台任务没有跑到，不要立刻下结论说产品质量差。
- `Review Coverage`
  如果低，说明人工标注积压，后面的 failure cluster 可信度会下降。

#### Flywheel Funnel

看漏斗是不是突然卡在某一层：

- `feed` 成功轮次下降：通常是入口解析、抽取、写入出了问题
- `think` 成功轮次下降：通常是生成、检索或 session 持久化出了问题
- `saved_insights` 下降：通常是回答质量、可保存性下降
- `reused_turns` 下降：通常是回流质量或检索命中下降

#### Recent Trend

看最近 7 天趋势，不要只看单天绝对值。

重点观察：

- `HVFTR` 是否连续两天下降
- `Auto Eval Coverage` 是否突然断崖
- `Review Coverage` 是否持续走低
- `Guardrail Fail` 是否从低位抬升

#### Entry Point Health

每个入口都要看这 6 个字段：

- `Success`
- `Quality`
- `Auto Eval`
- `Judge`
- `Review`
- `Latency`

读法：

- `Success` 低：先看 trace 是否报错
- `Quality` 低但 `Success` 正常：说明功能能跑完，但内容质量退化
- `Auto Eval` 低：先查评测接线
- `Judge` 低：说明应跑 judge 的 trace 没有被完整评测
- `Review` 低：说明人工复核不够
- `Latency` 高：说明体验可能退化，后续要在 Trace Lab 看 span

## 4. 发现异常后，进入 `Diagnosis`

`Diagnosis` 的任务不是看单条 trace，而是先回答“主要问题在哪里”。

按这个顺序看：

1. `Guardrail Fail Rate`
2. `Judge Coverage Gap`
3. `Auto Eval Gap`
4. `High Priority Pending`
5. `Regression Watch`
6. `Human Failure Hotspots`
7. `Automated Failure Hotspots`
8. `Coverage By Entry Point`
9. `Evaluator Matrix`

### 4.1 如何区分“评测系统出问题”和“产品质量出问题”

#### 更像评测系统问题

- `Auto Eval Gap` 突然升高
- `Judge Coverage Gap` 突然升高
- `Coverage By Entry Point` 里某个入口待复核异常多
- `Overview` 里 `Success` 正常，但 `Auto Eval` 或 `Judge` 很低

这时先记录为“评测覆盖问题”，不要直接给出产品质量差的结论。

#### 更像产品质量问题

- `Auto Eval Coverage` 正常
- `Judge Coverage` 正常
- 但 `Quality`、`HVFTR`、`Guardrail Fail` 变差
- `Regression Watch` 指向具体入口和指标
- `Evaluator Matrix` 出现大片低通过率

### 4.2 Regression Watch 怎么用

它对比：

- 最近 7 天
- 前 7 天

如果这里显示：

- `think · Quality Rate` 下降
- `compile · Guardrail Fail Rate` 上升

说明这不是一条偶发 trace，而是窗口级别的退化。

你要把以下信息记下来：

- 哪个入口
- 哪个指标
- 当前值
- 上一窗口值
- 两边样本数

### 4.3 Human Failure Hotspots 怎么用

这里看人工标注后的问题簇。  
如果某个 `failure_code` 重复出现，说明问题已经稳定，不是偶发。

你需要记录：

- `failure_code`
- 主要影响的 `entry_point`
- 最近一次出现时间

### 4.4 Automated Failure Hotspots 怎么用

这里看自动评测失败最多的 evaluator。

你需要记录：

- `evaluatorName`
- `evaluatorType`
- 影响入口
- 示例 trace

### 4.5 Evaluator Matrix 怎么用

这是最重要的定位面板之一。

读法：

- 绿色：通过率高，通常健康
- 黄色：需要关注
- 红色：明显有问题

如果看到某个入口下多个 evaluator 一起偏红，优先级很高。  
如果只有一个 evaluator 偏红，要先确认是不是 judge 证据不足，而不是业务真的退化。

## 5. 需要看单条证据时，进入 `Trace Lab`

### 5.1 什么时候要钻单条 trace

只有在以下情况才进入：

- `Diagnosis` 已经发现明确异常入口
- 你需要给工程师具体案例
- 你需要人工判断自动评测是否误判

### 5.2 在 `Trace Lab` 里按什么顺序看

1. 选中问题入口的 trace
2. 先看 `Trace Overview`
3. 再看 `Spans`
4. 再看 `Auto Eval Results`
5. 最后才看 `Trace Payload`

### 5.3 Trace Overview 怎么看

先看：

- `entry_point`
- `trace_status`
- `model`
- `latency`
- `prompt_version`

这一步是在判断问题大概属于：

- 运行失败
- 质量退化
- 模型变更
- prompt 版本变更

### 5.4 Spans 怎么看

目标是找“第一个出错阶段”。

例如：

- 检索阶段失败：后续 grounding judge 失败可能只是连锁反应
- 生成阶段正常但持久化失败：这是写入问题，不是回答质量问题
- compile 触发慢：这是性能问题，不是内容质量问题

### 5.5 Auto Eval Results 怎么看

看失败项时，不要只盯最后一个 judge，要判断它是：

- 根因
- 连带失败
- 证据不足导致的误判

### 5.6 什么时候用页面上的“运行代码评估”和“运行 LLM Judge”

仅在这些场景使用：

- 这条 trace 还没有自动结果
- 你怀疑这条 trace 的结果不是最新的
- 工程师修了某个问题，想手动复跑验证单条样本

## 6. 需要补人工复核时，进入 `Review Queue`

### 6.1 你的目标

把“系统已经感觉有问题，但还没有人工确认”的 trace 变成可用于后续判断的数据。

### 6.2 每条 trace 至少填什么

- `Dataset Name`
- `Failure Code`
- `Pass / Fail`
- `Notes`

### 6.3 推荐填写规则

#### Dataset Name

日常巡检统一用：

- `manual-review`

专项排查可用：

- `feed_quality_apr10`
- `think_grounding_apr10`

#### Failure Code

只选最上游、最本质的那个。  
不要一条 trace 填多个 failure code。

#### Pass / Fail

- 明确通过：`pass`
- 明确失败：`fail`
- 证据不足：`unknown`

#### Notes

推荐格式：

1. 第一个出错阶段
2. 根因判断
3. 给工程师的建议

示例：

`retrieve_knowledge_context 正常，generate_think_response 输出泛化。怀疑 roundtable prompt 没真实引用 context。建议先看 prompt 版本和 contextPreviewItems。`

## 7. 每日输出模板

每天巡检后，用下面的模板交付：

```md
# 每日评测巡检

日期：

## 1. 总体结论
- 正常 / 轻微波动 / 明显退化

## 2. 核心指标
- HVFTR:
- Reuse Rate:
- Auto Eval Coverage:
- Review Coverage:
- Guardrail Fail Rate:

## 3. 重点异常
- 入口：
- 指标：
- 现象：
- 影响样本数：

## 4. 代表 trace
- traceId:
- entry_point:
- 主要问题:

## 5. 建议动作
- 先修什么
- 需要谁看
- 是否需要补 review
```

## 8. 常见异常与处理

### 8.1 `/evals` 提示 setup required

说明评测相关表没有准备好，立刻通知工程师，不要继续做质量结论。

### 8.2 某个入口没有 trace

先确认今天有没有真实用户触发这个入口。  
如果应该有但没有，记录为“观测缺失”。

### 8.3 Auto Eval Coverage 很低

优先判断为“评测接线或后台执行问题”，不是内容质量结论。

### 8.4 Review Coverage 很低

说明人工样本不足。  
当天要优先清理 `Review Queue`，否则第二天的 hotspot 不稳定。

### 8.5 Guardrail Fail 抬头

优先级最高。  
无论用户反馈是否明显，都要把相关 trace 提交给工程师。

## 9. 你不该做的事

- 不要看到单条失败 trace 就宣布产品退化
- 不要在 `Trace Lab` 里从 JSON 开始看
- 不要把“没有自动评测结果”当成“自动评测通过”
- 不要在 `Review Queue` 给一条 trace 填多个根因
- 不要只看 pass rate，不看样本数

## 10. 你做完后，算是完成任务的标准

满足以下 5 条才算完成当天巡检：

1. `/evals` 四个视角都看过
2. 异常入口已经记录
3. 至少补完当天最重要的一批人工复核
4. 给出代表 trace
5. 给出明确建议动作
