# Temperature A/B Eval — Claude judge

- Source: `scripts/temp-eval-results/2026-04-13T07-37-42-404Z-rejudged/raw.json`
- Generation model: `minimax-fast`
- Judge model: `claude-haiku-4-5` (via `claude -p` CLI, 订阅 OAuth, 不消耗 API key)
- Questions per mode: 5
- Total generations: 80
- Judged ok: 79 / failed: 0

这一版 judge 和 generation 完全跨供应商,消除了 MiniMax 自评偏见。

## 分数对比表 (每项 0-5, avgTotal 满分 20)

| mode | temp | parseOk | judgedN | jsonValid | accuracy | insight | actionable | structure | **avgTotal** | latency |
|------|------|---------|---------|-----------|----------|---------|------------|-----------|--------------|---------|
| coach | 0.3 | 5/5 | 5/5 | 5/5 | 3.8 | 3.8 | 4 | 3.8 | **15.4** | 56792ms |
| coach | 0.5 | 5/5 | 5/5 | 5/5 | 4.4 | 4 | 4.6 | 3.8 | **16.8** | 48961ms |
| coach | 0.8 | 5/5 | 5/5 | 5/5 | 4 | 4.2 | 4.4 | 4.4 | **17 ★** | 53428ms |
| coach | 1 | 5/5 | 5/5 | 5/5 | 3.8 | 3.8 | 4.2 | 4 | **15.8** | 49718ms |
| crossdomain | 0.3 | 5/5 | 5/5 | 5/5 | 4 | 4 | 3.4 | 3.8 | **15.2 ★** | 54550ms |
| crossdomain | 0.5 | 5/5 | 5/5 | 5/5 | 3.8 | 4.2 | 3.6 | 3.6 | **15.2** | 62795ms |
| crossdomain | 0.8 | 5/5 | 5/5 | 5/5 | 3.4 | 3.9 | 3 | 3.6 | **13.9** | 56758ms |
| crossdomain | 1 | 5/5 | 5/5 | 5/5 | 3.6 | 3.4 | 3 | 3.4 | **13.4** | 59124ms |
| mirror | 0.3 | 5/5 | 5/5 | 5/5 | 3.4 | 3.7 | 2.2 | 3.1 | **12.4** | 61431ms |
| mirror | 0.5 | 5/5 | 5/5 | 4/5 | 3.4 | 3 | 2.3 | 3.1 | **11.8** | 105208ms |
| mirror | 0.8 | 5/5 | 5/5 | 5/5 | 3.6 | 3.6 | 2.6 | 3.4 | **13.2 ★** | 60278ms |
| mirror | 1 | 3/5 | 5/5 | 3/5 | 3.6 | 3.6 | 2.8 | 3.2 | **13.2** | 88101ms |
| roundtable | 0.3 | 4/5 | 5/5 | 2/5 | 3.8 | 3.4 | 3.5 | 2.9 | **13.6** | 32718ms |
| roundtable | 0.5 | 5/5 | 5/5 | 5/5 | 4 | 3.8 | 3.8 | 4 | **15.6 ★** | 31611ms |
| roundtable | 0.8 | 2/5 | 4/5 | 3/5 | 3.25 | 3.25 | 3 | 3 | **12.5** | 556236ms |
| roundtable | 1 | 5/5 | 5/5 | 5/5 | 3.6 | 3.2 | 2.8 | 3 | **12.6** | 49648ms |

## 推荐的 per-mode 温度 (Claude judge)

| mode | 推荐温度 | 得分 |
|------|----------|------|
| roundtable | 0.5 | 15.6 |
| coach | 0.8 | 17 |
| crossdomain | 0.3 | 15.2 |
| mirror | 0.8 | 13.2 |
