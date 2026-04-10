# Dataset Coverage Rules

离线评测数据集现在默认要求覆盖以下入口：

- `feed`
- `think`
- `compile`
- `lint`

推荐做法不是把所有样本混成一包，而是维护分入口的 gold set，再按需要合并：

- `feed-gold.jsonl`
- `think-gold.jsonl`
- `compile-gold.jsonl`
- `lint-gold.jsonl`

每次功能迭代前后，至少保证：

- `feed` 有可审摘要、关系、spark 的样本
- `think` 有 mode fit / grounding / actionable 的样本
- `compile` 有 faithful / coherent / incremental 的样本
- `lint` 有 contradiction / orphan / stale / blind spot 的样本

在跑 `evals:gate` 前，先跑：

```bash
npm run evals:dataset-report -- --input=evals/datasets/splits/dev.jsonl
```

目标不是把门禁变严，而是先确认这份 dev 集真的覆盖到了这次改动的功能面。
