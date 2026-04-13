# 全量回归测试报告 — 2026-04-10

> **测试类型**: AI 浏览器端到端全流程回归测试
> **测试员**: Claude Sonnet (claude-sonnet-4-6)
> **目的**: 验证"有人声称已修复"的历史 QA 问题，同时发现新 bug
> **测试环境**: localhost:3000（Next.js 15 + Turbopack 开发模式）
> **登录账号**: test@test.com
> **测试时间**: 2026-04-10

---

## 一、历史 Bug 验证结果

| # | 问题描述 | 原级别 | 验证结果 | 证据 |
|---|---------|--------|---------|------|
| 1 | 浏览器标签 "Create Next App" | P0 | ✅ **已修复** | document.title = "认知飞轮 Cognitive Flywheel" |
| 2 | HTML lang="en" | P0 | ✅ **已修复** | document.documentElement.lang = "zh-CN" |
| 3 | 登录错误为英文 | P1 | ✅ **已修复** | 错误密码 → "邮箱或密码错误，请重试" |
| 4 | Me 近7天成长曲线无补零 | P1 | ✅ **已修复** | 04-04~04-10 全 7 根柱子，无数据日显示 0 |
| 5 | Me 最近成就硬编码 | P1 | ✅ **已修复** | 动态显示"知识条目突破 500""已建立 67 个跨域关联" |
| 6 | Evals 入口对普通用户可见 | P1 | ✅ **已修复** | 侧栏和移动底栏均无 Evals（devOnly 机制生效） |
| 7 | Knowledge API ilike 搜索未转义（route.ts 路径） | P2 | ⚠️ **部分修复** | route.ts 的 fallback ILIKE 已转义，但主路径（searchKnowledge → fallbackLexicalSearch）仍存在漏洞（见新 Bug #2） |
| 8 | Feed URL 框非 URL 文本导致 label 切换 | P2 | ✅ **已修复** | 标签 label 使用 isValidUrl，非 URL 文本不触发切换 |
| 9 | Think 模式卡片无视觉区分 | P3 | ✅ **已修复** | 4 个模式图标已着色（蓝/橙/青/橙） |
| 10 | Coach 盲区 emoji 语义反了 | P3 | ✅ **已修复** | 代码确认 high → 🔸（橙）、非 high → 🔹（蓝） |
| 11 | Geist 字体仅 latin | P3 | ❌ **未修复** | layout.tsx 中 subsets 仍为 ["latin"] |

---

## 二、新发现的 Bug

### Bug #1 — P0 CRITICAL（测试中已即时修复）

**位置**: `src/app/(app)/evals/page.tsx:1418`

**现象**: JSX 中使用 `pass >= 90%`，`>=` 在 JSX 上下文中是非法字符，导致整个应用 build 失败。访问 `/memory` 时浏览器直接显示 Next.js Build Error 界面，所有 app 路由不可用。

**触发条件**: 访问任何 app 路由（如 /memory、/feed）时均触发此 build 错误。

**根因**: JSX 中 `<` 和 `>` 必须转义为 `&lt;` 和 `&gt;`，或用 `{'>'}` 表达。

**修复**: 已在测试中将 `pass >= 90%` 改为 `pass &gt;= 90%`（已提交）。

---

### Bug #2 — P2（搜索输入特殊字符仍引发 500）

**位置**: `src/lib/retrieval.ts`（`buildFallbackSearchTokens` + `fallbackLexicalSearch`）

**现象**: 在 Memory 搜索框输入 `%`，浏览器控制台报 500 错误，每隔约 2 秒重试并再次 500。

**复现步骤**:
1. 登录后进入 /memory
2. 在搜索框输入 `%`
3. 控制台出现 `Failed to load resource: 500 (Internal Server Error)`

**根因**:
- `buildFallbackSearchTokens` 在 line 81 将 `exactQueryToken` 设为原始 `normalized`（含 `%`）
- `fallbackLexicalSearch` 在 line 213-221 直接用 token 插值构建 ILIKE query
- 结果: `title.ilike.%%%` — 这是无效的 PostgREST 语法
- 已修复的 `route.ts` 中的 escape 逻辑只覆盖不走 `searchKnowledge` 的 fallback 路径

**修复建议**:
```ts
// retrieval.ts: buildFallbackSearchTokens line 81
// 改为用 sanitized 而非 normalized 作为 exactQueryToken
const exactQueryToken = sanitized.trim().length >= 2 && normalized.length <= 80
  ? [sanitized.trim()]
  : [];
```

---

### Bug #3 — P3（Feed 文本区 placeholder 切换条件错误）

**位置**: `src/app/(app)/feed/page.tsx:234-237`

**现象**: URL 输入框中输入任何文字（包括非 URL 文本），textarea 的 placeholder 就会从"粘贴文章内容、记录灵感..."切换为"记录你对这篇内容的想法、疑问或启发..."，即使输入的不是合法 URL。

**根因**:
```tsx
// 当前代码（错误）
placeholder={
  url ? "记录你对这篇内容的想法、疑问或启发..." : "粘贴文章内容、记录灵感、..."
}
// 应改为（正确）
placeholder={
  isValidUrl ? "记录你对这篇内容的想法、疑问或启发..." : "粘贴文章内容、记录灵感、..."
}
```

**影响**: label 修复了（用 isValidUrl），但 placeholder 遗漏，语义不一致。

---

### Bug #4 — P2（Feed 空状态文案冗余，历史遗留）

**位置**: `src/app/(app)/feed/page.tsx:418-425`

**现象**: 输入卡片上方已有"粘贴链接、输入想法..."引导语，下方空状态区又重复一遍相同文案。两处文案措辞几乎相同，视觉冗余。

---

## 三、核心功能全量验证结果

| 功能 | 状态 | 关键验证点 |
|------|------|-----------|
| 登录 / 登出 | ✅ | 登录跳转 /feed，登出跳回 /auth/login，错误提示中文化 |
| 未登录重定向 | ✅ | /feed /memory /think /me 均跳登录页 |
| Feed 文本提交 | ✅ | SSE 流式进度 → 消化结果含标题/关键点/标签 |
| Feed 知识关联分析 | ✅ | 支持/矛盾/扩展/不同视角 badge 正常渲染 |
| Feed 跨域闪念 | ✅ | amber 渐变卡片显示，含灵感来源字段 |
| Feed URL 检测 | ✅ | YouTube/Twitter 等平台 badge 正常显示 |
| Think 圆桌会议 | ✅ | 3位专家视角 + "本次思考已引用 4 条记忆层上下文" |
| Think 认知教练 | ✅ | 盲区发现 + 4周学习路径 + 记忆注入 |
| Think 跨域连接 | ✅ | 3个跨域类比（生物/音乐/建筑） |
| Think 历史镜鉴 | ✅ | 3位历史人物（苏格拉底/宫本武藏/富兰克林） |
| 飞轮回流（存入记忆） | ✅ | 点击后显示"飞轮 +1 转 — 已回流 4 条洞察"，按钮变"已保存 ✓" |
| Memory 搜索（正常字符） | ✅ | "巴菲特"搜索返回相关结果 |
| Memory 搜索（特殊字符 %） | ❌ | 500 错误（见 Bug #2） |
| Memory 域名筛选 | ✅ | 投资/Agent Building 等过滤正常 |
| Memory 展开详情 | ✅ | 点击卡片展开，显示"收起"指示 |
| Me 页面真实数据 | ✅ | 飞轮 686 转、674 条知识、23 次思考、67 跨域关联 |
| Me 成长曲线（7天补零） | ✅ | 04-04~04-10，无数据日显示 0 |
| Me 动态成就 | ✅ | 基于真实里程碑动态生成 |
| Me 盲区地图 | ✅ | 3条盲区，文字内容合理 |
| 移动端布局 | ✅ | 底栏 4 项（Feed/Memory/Think/Me），无 Evals |

---

## 四、产品价值评估（本次测试确认）

### 高价值
1. **Think + 记忆注入** — "本次思考已引用 4 条记忆层上下文"在每个模式均验证，个人化深度极强
2. **飞轮回流闭环** — 思考 → 存入记忆 → 飞轮+1 的完整闭环感，用户成就感明显
3. **Feed 知识关联** — 支持/矛盾/扩展/不同视角的关系分类让"存"变得有意义
4. **Me 真实统计** — 686 转数、674 条知识是真实积累，配合动态成就形成强留存钩子

### 仍需关注
1. **Memory 搜索特殊字符** — `%` 导致 500，用户无明显反馈，搜索框应该 gracefully degrade
2. **Feed 空状态冗余** — 影响首次使用的引导清晰度
3. **Geist 字体** — 中文仍回退系统字体，影响中英混排视觉一致性

---

## 五、检查清单（供下次 Agent 验证）

- [x] evals/page.tsx:1418 — JSX `>=` 语法错误（测试中已修复）
- [ ] `src/lib/retrieval.ts` — `buildFallbackSearchTokens` exactQueryToken 需用 sanitized 字符串
- [ ] `src/app/(app)/feed/page.tsx:234` — placeholder 使用 `isValidUrl` 而非 `url`
- [ ] `src/app/layout.tsx` — Geist 字体 subsets 加入中文或移除仅 latin 限制
- [ ] Feed 空状态文案 — 移除冗余引导文字

---

*测试员: Claude Sonnet (claude-sonnet-4-6) | 生成时间: 2026-04-10*
