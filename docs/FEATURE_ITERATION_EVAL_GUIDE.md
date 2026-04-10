# 功能迭代效果评估操作手册

适用对象：第一次参与功能迭代评估的实习生  
目标：当产品功能、prompt、模型、路由逻辑、检索逻辑发生变化时，能独立完成“改前基线 -> 改后验证 -> 回归定位 -> 结论汇报”整套流程

## 1. 这份文档解决什么问题

功能改完以后，不能只回答“能不能跑”，还要回答：

1. 改后是否真的更好？
2. 有没有引入副作用？
3. 退化是产品能力退化，还是评测覆盖断了？
4. 先修哪个点最值？

你要用当前评测系统，把一次功能迭代变成可比较、可复盘、可回滚的过程。

## 2. 先理解评估分两层

### 2.1 线上观察

看真实用户使用后的趋势和问题簇。  
核心工具是 `/evals`。

### 2.2 离线门禁

看这次迭代对固定样本集的影响。  
核心工具是：

- `npm run e2e:user-flow`
- `npm run evals:export`
- `npm run evals:split`
- `npm run evals:dataset-report`
- `npm run evals:gate`
- `npm run evals:judge-metrics`

两层都要做。  
只做线上观察，容易受流量和样本波动影响。  
只做离线门禁，容易漏掉真实用户路径里的问题。

## 3. 先判断这次迭代影响哪条链路

开始评估前，先填一张影响面表。

```md
## 本次迭代影响面
- 迭代名称：
- 改动内容：
- 主要入口：feed / think / save_insight / compile / lint
- 可能影响的 evaluator：
- 可能影响的 judge：
- 风险类型：质量 / 覆盖 / 延迟 / 护栏 / 回流
```

### 3.1 常见映射关系

#### 如果改的是 Feed 抽取 / 摘要

重点看：

- `feed_summary_faithful`
- `feed_title_specific`
- `feed_tags_relevant`
- `feed_relationship_accurate`
- `feed_spark_surprising`
- `guardrail_fabricated_fact`

#### 如果改的是 Think prompt / mode

重点看：

- `think_mode_fit`
- `think_grounded_in_context`
- `think_specific_not_generic`
- `think_actionable`
- `think_save_worthy`
- `guardrail_overconfidence`

#### 如果改的是 Compile

重点看：

- `compile_faithful`
- `compile_coherent`
- `compile_incremental_correct`
- `guardrail_fabricated_fact`

#### 如果改的是 Lint

重点看：

- `lint_contradiction_valid`
- `lint_report_structured`
- `lint_all_checks_ran`

## 4. 标准评估流程

每次迭代都按这 8 步做，不要跳步。

### 第 1 步：记录改前基线

改代码前，先记录当前状态。

#### 4.1.1 看线上基线

打开 `/evals`，记录：

- `High-Value Turns`
- `Reuse Rate`
- `Auto Eval Coverage`
- `Review Coverage`
- `Guardrail Fail Rate`
- 受影响入口的 `Entry Point Health`
- `Regression Watch` 当前是否已有问题

建议截图或写入文档。

#### 4.1.2 看离线基线

如果已有评测数据集，先跑：

```bash
npm run evals:dataset-report -- --input=evals/datasets/splits/dev.jsonl
npm run evals:gate -- --input=evals/datasets/splits/dev.jsonl
```

记录：

- 相关入口样本数
- gate 是否通过
- 哪个 evaluator 已经偏危险

### 第 2 步：确认数据集覆盖到这次改动

这是最容易被忽略的一步。

你需要先回答：

- 这次迭代影响的入口，在 dev 集里有没有样本？
- 这些样本上，对应 evaluator 有没有结果？
- 样本数够不够比较？

先跑：

```bash
npm run evals:dataset-report -- --input=evals/datasets/splits/dev.jsonl
```

如果报告显示以下任意情况，先不要跑质量结论：

- 没有相关 `entry_point` 的成功样本
- 某个关键 evaluator 的 `missing results` 很多
- `evaluated samples` 小于 `min samples`

这时先补数据集，不要继续往下。

## 5. 如果需要补数据集，怎么补

### 5.1 从真实 trace 导出

例如只导出 `think`：

```bash
npm run evals:export -- --entry-point=think --limit=100 --out=evals/datasets/think-traces.jsonl
```

例如导出 `compile`：

```bash
npm run evals:export -- --entry-point=compile --limit=100 --out=evals/datasets/compile-traces.jsonl
```

### 5.2 切分 train / dev / test

```bash
npm run evals:split -- --input=evals/datasets/think-traces.jsonl --out-dir=evals/datasets/splits
```

### 5.3 如果需要 judge 准确率核对

前提：数据集里已经有人工 `label.pass_fail`

```bash
npm run evals:judge-metrics -- --input=evals/datasets/splits/dev.jsonl --dataset-name=think_mode_gold_dev --evaluator=think_mode_fit
```

## 6. 第 3 步：产出改后新样本

功能改完以后，不能只看代码。必须让系统真正跑一遍。

### 6.1 跑 smoke

```bash
npm run e2e:user-flow
```

这一步至少会覆盖：

- `/feed`
- `/think`
- `/evals`
- `/api/feed`
- `/api/think`
- `/api/think/save`
- `/api/knowledge/compile`
- `/api/knowledge/lint`

### 6.2 手工补关键路径

如果这次改动非常集中，例如只改了 `compile` 的摘要逻辑，还需要手工跑几条代表性样本，确保线上也产生新 trace。

## 7. 第 4 步：先看线上结果，再看离线门禁

### 7.1 看线上

打开 `/evals`：

#### Overview

看：

- 相关入口的 `Quality`
- `Auto Eval`
- `Judge`
- `Latency`
- `Recent Trend` 是否有异常

#### Diagnosis

看：

- `Regression Watch` 是否指向本次影响入口
- `Automated Failure Hotspots` 是否出现新的 evaluator 失败簇
- `Evaluator Matrix` 是否在相关入口变红

### 7.2 跑离线 gate

```bash
npm run evals:gate -- --input=evals/datasets/splits/dev.jsonl
```

现在 gate 默认很严格：

- 缺入口样本：失败
- 缺 evaluator 结果：失败
- 样本数不够：失败
- 通过率低于阈值：失败

如果你只是临时观察，不想让覆盖问题阻断，可以用：

```bash
npm run evals:gate -- --input=evals/datasets/splits/dev.jsonl --strict-coverage=false
```

但正式评估结论不要用这条宽松结果。

## 8. 第 5 步：如果发现退化，怎么定位

永远按这个顺序排查：

1. 覆盖是否正常
2. 入口是否正常
3. evaluator 是否集中失败
4. 代表 trace 的第一个错误阶段是什么

### 8.1 如果是覆盖问题

常见信号：

- `Auto Eval Coverage` 低
- `Judge Coverage Gap` 高
- gate 报 `FAIL COVERAGE`

这时结论应写成：

`当前无法判断功能质量是否退化，先要修评测覆盖。`

### 8.2 如果是质量问题

常见信号：

- gate 报 `FAIL QUALITY`
- `Overview` 里 `Success` 正常但 `Quality` 下降
- `Regression Watch` 指向相关入口
- `Evaluator Matrix` 在关键 evaluator 上变红

这时去 `Trace Lab` 看代表样本。

### 8.3 Trace Lab 定位法

选一个最有代表性的失败 trace，按下面顺序看：

1. `Trace Overview`
2. `Spans`
3. `Auto Eval Results`
4. `Trace Payload`
5. `Human Labels & Feedback`

你的目标是回答：

- 第一个错误发生在哪个阶段？
- 后面的失败是不是连带失败？
- 是 prompt、检索、持久化、还是评测证据不足？

## 9. 第 6 步：写出结论，不要只贴数字

每次迭代评估结束后，至少要交付下面这份总结：

```md
# 功能迭代评估结论

## 1. 迭代信息
- 名称：
- 影响入口：
- 风险点：

## 2. 改前基线
- 线上关键指标：
- dev gate 结果：

## 3. 改后结果
- 线上关键指标变化：
- Regression Watch：
- dev gate 结果：

## 4. 主要问题
- 是覆盖问题还是质量问题：
- 主要退化入口：
- 主要失败 evaluator：
- 代表 trace：

## 5. 建议
- 可以上线 / 继续观察 / 必须回修
- 优先修什么
- 是否需要补数据集
```

## 10. 一个完整例子

假设你改了 `compile` 的摘要逻辑。

### 改前

1. 打开 `/evals`
2. 记录 `compile` 的：
   - `Success`
   - `Quality`
   - `Latency`
3. 跑：

```bash
npm run evals:dataset-report -- --input=evals/datasets/splits/dev.jsonl
npm run evals:gate -- --input=evals/datasets/splits/dev.jsonl
```

4. 记录 `compile_faithful` 当前是否通过

### 改后

1. 跑：

```bash
npm run e2e:user-flow
```

2. 打开 `/evals`
3. 看 `Overview -> Entry Point Health -> compile`
4. 看 `Diagnosis -> Regression Watch`
5. 看 `Diagnosis -> Evaluator Matrix -> compile`
6. 如果 `compile_faithful` 变差，进入 `Trace Lab`
7. 找一条失败 trace，看：
   - source preview 是否充分
   - compiled_content 是否跑偏
   - 是否是 `compile_incremental_correct` 同时失败

### 结论写法示例

`本次 compile 重写后，入口成功率未下降，但 compile_faithful 在 dev 集从通过变为失败，/evals 中 compile 的 Quality 也下降。Regression Watch 显示 compile Quality 最近 7 天低于前 7 天。代表 trace 显示 sourcePreview 信息足够，但 compiled_content 丢失了新增 source 的关键事实，属于真实质量回归，不是覆盖问题。建议先回修 compile prompt，再补 3 条 compile gold 样本复测。`

## 11. 最常见的 6 个错误

### 错误 1：只跑 smoke，不看 `/evals`

smoke 只能说明链路大致可用，不能说明内容质量没退化。

### 错误 2：只看 `/evals`，不跑 gate

线上样本会漂移。  
没有固定 dev 集，你无法证明改动本身更好。

### 错误 3：gate 失败就直接判功能差

先看是不是 `FAIL COVERAGE`。  
覆盖失败和质量失败不是一回事。

### 错误 4：样本太少也下结论

如果 `evaluated samples` 不够，结论不稳。

### 错误 5：只看最后一个失败 judge

最后一个失败 judge 很可能只是连带失败，不是根因。

### 错误 6：不写“改前基线”

没有基线，就无法比较改动效果。

## 12. 实习生的最低完成标准

一次完整功能评估，必须做到：

1. 明确本次影响入口和关键 evaluator
2. 记录改前基线
3. 产生改后真实 trace
4. 跑 dataset-report
5. 跑 gate
6. 看 `/evals` 的 Overview 和 Diagnosis
7. 对至少 1 条失败 trace 做根因定位
8. 输出结论和建议
