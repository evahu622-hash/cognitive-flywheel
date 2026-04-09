# Evals Workspace

这个目录用于存放离线评估相关的数据和导出结果。

## 目录约定

- `datasets/`
  - 存放导出的 trace JSONL、人工标注后的 gold set、切分后的 train/dev/test 数据

## 导出 trace

先确保环境变量可用：

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

然后运行：

```bash
npm run evals:export -- --entry-point=think --limit=100 --out=evals/datasets/think-traces.jsonl
```

可选参数：

- `--entry-point=feed|think|save_insight`
- `--status=success|error|running|partial`
- `--limit=100`
- `--out=evals/datasets/custom.jsonl`

每一行 JSONL 都包含：

- `trace`
- `spans`
- `results`
- `feedback`
- `labels`

这样可以直接用于开放编码、轴向编码、或后续人工标注。

## 切分 train / dev / test

```bash
npm run evals:split -- --input=evals/datasets/think-traces.jsonl --out-dir=evals/datasets/splits
```

默认按 `80 / 10 / 10` 做稳定切分，基于 `trace.id` 哈希，重复运行不会乱序漂移。

## Judge 指标核对

如果某个数据集已经有人工 `pass_fail` 标签，可以用它来衡量 judge 的准确率、TPR、TNR：

```bash
npm run evals:judge-metrics -- --input=evals/datasets/splits/dev.jsonl --dataset-name=think_mode_gold_dev --evaluator=think_mode_fit
```

这要求 JSONL 里的 `labels[].dataset_name` 与传入的 `dataset-name` 对齐。

## CI Gate

```bash
npm run evals:gate -- --input=evals/datasets/splits/dev.jsonl
```

默认门禁会检查：

- `feed_summary_faithful >= 0.85`
- `think_mode_fit >= 0.85`
- `guardrail_fabricated_fact == 1.0`

如果数据集中没有对应 evaluator 样本，会打印 `SKIP`，不会直接报错。

## Retrieval Eval

离线 retrieval eval 直接跑 gold set，不依赖 trace。

数据集默认路径：

- `evals/datasets/memory_retrieval_gold.jsonl`

可以先复制模板：

- `evals/datasets/memory_retrieval_gold.example.jsonl`

每行 JSONL 字段：

- `id`: 样本 ID，可选
- `user_id`: 该样本所属用户 ID；如果命令行传了 `--user-id`，可省略
- `query`: 检索问题
- `gold_item_ids`: 必填，真正相关的 item IDs
- `acceptable_item_ids`: 可选，允许命中的可接受结果集合；默认回退到 `gold_item_ids`
- `best_item_id`: 可选，理想第一结果；默认取 `gold_item_ids[0]`
- `domain`: 可选，按领域过滤
- `notes`: 可选，标注说明

运行：

```bash
npm run evals:retrieval -- --input=evals/datasets/memory_retrieval_gold.jsonl --strategies=lexical,hybrid --out=evals/results/retrieval-eval.json
```

常用参数：

- `--user-id=<uuid>`: 给整份数据集提供默认 user_id
- `--limit=5`: top-k，默认 `5`
- `--semantic-threshold=0.45`: hybrid 的语义阈值
- `--strategies=lexical,hybrid`: 比较 lexical-only 和 hybrid
- `--min-recall-at-5=0.8`: 低于阈值时返回非零退出码
- `--min-mrr=0.6`
- `--max-noise-rate=0.4`

输出 summary 指标：

- `retrieval_recall_at_5`
- `retrieval_mrr`
- `retrieval_noise_rate`

同时会把每条 query 的 top-k 结果、rank、命中来源、是否 gold、是否 acceptable 一并写到输出文件，便于分析是 lexical 漏召回还是 hybrid 引入噪音。
