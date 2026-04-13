# Temperature A/B Eval Summary (rejudged)

- Source: `scripts/temp-eval-results/2026-04-13T07-37-42-404Z/raw.json`
- Generation model: `minimax-fast`
- Judge model: `minimax-fast` (重新打分,原始判定已 merge)
- Questions per mode: 5
- Total generations: 80
- Rejudge: 36 ok / 0 still failed

## 分数对比表 (每项 0-5, avgTotal 满分 20)

| mode | temp | parseOk | judgedN | jsonValid | accuracy | insight | actionable | structure | **avgTotal** | latency |
|------|------|---------|---------|-----------|----------|---------|------------|-----------|--------------|---------|
| coach | 0.3 | 5/5 | 5/5 | 5/5 | 4.6 | 4.6 | 4.6 | 4.6 | **18.4** | 56792ms |
| coach | 0.5 | 5/5 | 5/5 | 5/5 | 4.4 | 4 | 4.6 | 4.4 | **17.4** | 48961ms |
| coach | 0.8 | 5/5 | 5/5 | 5/5 | 5 | 4.8 | 5 | 5 | **19.8 ★** | 53428ms |
| coach | 1 | 5/5 | 5/5 | 5/5 | 4.4 | 4 | 5 | 4.6 | **18** | 49718ms |
| crossdomain | 0.3 | 5/5 | 5/5 | 5/5 | 4.4 | 4 | 4 | 4 | **16.4** | 54550ms |
| crossdomain | 0.5 | 5/5 | 5/5 | 5/5 | 4.8 | 4.6 | 4.2 | 4.6 | **18.2 ★** | 62795ms |
| crossdomain | 0.8 | 5/5 | 5/5 | 5/5 | 3.6 | 3.8 | 4 | 4 | **15.4** | 56758ms |
| crossdomain | 1 | 5/5 | 5/5 | 5/5 | 4.4 | 4 | 4 | 4.4 | **16.8** | 59124ms |
| mirror | 0.3 | 5/5 | 5/5 | 5/5 | 4.2 | 4.2 | 3.2 | 4.4 | **16 ★** | 61431ms |
| mirror | 0.5 | 5/5 | 5/5 | 5/5 | 4 | 3.8 | 2.8 | 4.2 | **14.8** | 105208ms |
| mirror | 0.8 | 5/5 | 5/5 | 5/5 | 4 | 3.6 | 2.6 | 4 | **14.2** | 60278ms |
| mirror | 1 | 3/5 | 5/5 | 5/5 | 4.4 | 4 | 3.2 | 4.2 | **15.8** | 88101ms |
| roundtable | 0.3 | 4/5 | 5/5 | 4/5 | 4.4 | 4.4 | 3.8 | 4.2 | **16.8 ★** | 32718ms |
| roundtable | 0.5 | 5/5 | 5/5 | 5/5 | 4 | 3.8 | 3.8 | 4.2 | **15.8** | 31611ms |
| roundtable | 0.8 | 2/5 | 4/5 | 3/5 | 4 | 3.75 | 3.25 | 4 | **15** | 556236ms |
| roundtable | 1 | 5/5 | 5/5 | 5/5 | 4 | 4 | 4 | 4.2 | **16.2** | 49648ms |

## 推荐的 per-mode 温度

| mode | 推荐温度 | 得分 |
|------|----------|------|
| roundtable | 0.3 | 16.8 |
| coach | 0.8 | 19.8 |
| crossdomain | 0.5 | 18.2 |
| mirror | 0.3 | 16 |
