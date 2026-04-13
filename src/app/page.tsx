import { Playfair_Display } from "next/font/google";
import Link from "next/link";
import { Brain, ArrowRight, Users, GraduationCap, Shuffle, History } from "lucide-react";

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  weight: ["400", "500", "700"],
  style: ["normal", "italic"],
});

/* ─── flywheel node positions ───
   Container 280×280, center (140,140), orbit radius 100
   Nodes 52×52 (offset -26 to center)

   angle   label   left   top    center-x  center-y
    -90°   输入    114     14      140        40
    -18°   记忆    209     83      235       109
     54°   思考    173    195      199       221
    126°   洞察     55    195       81       221
    198°   回流     19     83       45       109
──────────────────────────────────────────── */

const nodes = [
  { label: "输入", left: 114, top: 14, cx: 140, cy: 40, delay: "0s" },
  { label: "记忆", left: 209, top: 83, cx: 235, cy: 109, delay: "0.6s" },
  { label: "思考", left: 173, top: 195, cx: 199, cy: 221, delay: "1.2s" },
  { label: "洞察", left: 55, top: 195, cx: 81, cy: 221, delay: "1.8s" },
  { label: "回流", left: 19, top: 83, cx: 45, cy: 109, delay: "2.4s" },
];

const capabilities = [
  {
    icon: Users,
    zh: "圆桌会议",
    en: "Roundtable",
    desc: "好的决策不诞生于确认，而诞生于被高质量地反对。召集思想家与你辩论，而不是取悦你。",
  },
  {
    icon: GraduationCap,
    zh: "认知教练",
    en: "Cognitive Coach",
    desc: "真正限制你的，从来不是答不出的问题，而是你从未想过要问的问题。AI 替你画出那张盲区地图。",
  },
  {
    icon: Shuffle,
    zh: "跨域连接",
    en: "Cross-Domain",
    desc: "历史上最重要的突破，答案几乎都不在问题所在的领域。AI 在生物学、历史、建筑学之间替你找到结构同构。",
  },
  {
    icon: History,
    zh: "历史镜鉴",
    en: "History Mirror",
    desc: "太阳底下并无新事。你正在纠结的困境，先驱早已交过答卷——AI 替你在人类几千年的经验里检索。",
  },
];

export default function Home() {
  return (
    <main className={`${playfair.variable} lp2-root`}>
      {/* ── NAV ── */}
      <nav className="lp2-nav">
        <div className="lp2-nav-inner">
          <div className="lp2-logo">
            <Brain size={17} color="#4F46E5" />
            <span>认知飞轮</span>
          </div>
          <Link href="/auth/login" className="lp2-btn lp2-btn-dark lp2-btn-sm">
            立即体验 <ArrowRight size={12} />
          </Link>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section className="lp2-hero">
        <p className="lp2-mono-label">COGNITIVE FLYWHEEL</p>

        <h1 className="lp2-h1">
          What if AI 能<span className="lp2-ink">替你学习</span>？
        </h1>

        <p className="lp2-subhead">
          不是知识库，不是搜索，而是真正会成长的外脑
        </p>

        <div className="lp2-btn-row">
          <Link href="/auth/login" className="lp2-btn lp2-btn-indigo lp2-btn-md">
            立即体验 <ArrowRight size={14} />
          </Link>
          <a href="#problem" className="lp2-btn lp2-btn-ghost lp2-btn-md">
            了解更多
          </a>
        </div>

        {/* Flywheel */}
        <div className="lp2-fw-wrap">
          <div className="lp2-fw-container">
            <svg
              width="280"
              height="280"
              viewBox="0 0 280 280"
              className="lp2-fw-svg"
              aria-hidden="true"
            >
              {/* orbit ring */}
              <circle
                cx="140"
                cy="140"
                r="100"
                fill="none"
                stroke="#4F46E5"
                strokeOpacity="0.18"
                strokeWidth="1"
                strokeDasharray="5 4"
                className="lp2-fw-ring"
              />
              {/* lines: node to adjacent node */}
              {nodes.map((n, i) => {
                const next = nodes[(i + 1) % nodes.length];
                return (
                  <line
                    key={i}
                    x1={n.cx}
                    y1={n.cy}
                    x2={next.cx}
                    y2={next.cy}
                    stroke="#4F46E5"
                    strokeOpacity="0.1"
                    strokeWidth="1"
                  />
                );
              })}
              {/* center dot */}
              <circle cx="140" cy="140" r="24" fill="white" stroke="#4F46E5" strokeOpacity="0.2" strokeWidth="1.5" />
            </svg>

            {/* nodes */}
            {nodes.map(({ label, left, top, delay }) => (
              <div
                key={label}
                className="lp2-fw-node"
                style={
                  {
                    left,
                    top,
                    "--delay": delay,
                  } as React.CSSProperties
                }
              >
                {label}
              </div>
            ))}

            {/* center brain icon */}
            <div className="lp2-fw-center">
              <Brain size={18} color="#4F46E5" />
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PROBLEM ── */}
      <section id="problem" className="lp2-section lp2-section-alt">
        <div className="lp2-container">
          <div className="lp2-section-top">
            <p className="lp2-mono-label">THE PROBLEM</p>
            <h2 className="lp2-h2">
              人脑有 5 个先天局限
              <br />
              AI 恰好<span className="lp2-ink">全部补齐</span>
            </h2>
            <p className="lp2-body">
              学习是一件反人性的事——对人脑而言。人生有限，知识无限，我们注定学不完。幸运的是，AI 不怕这些。
            </p>
          </div>

          <div className="lp2-compare">
            <div className="lp2-compare-card lp2-compare-dim">
              <p className="lp2-card-eyebrow">人脑 · Human Brain</p>
              <h3 className="lp2-card-heading">5 个先天局限</h3>
              <ul className="lp2-card-list">
                <li>记忆衰减 — 一篇文章，3 天后只剩 10%</li>
                <li>算力有限 — 几千年智慧，几十年人生学不完</li>
                <li>带宽有限 — 学多了就过载，无法并行</li>
                <li>连接有限 — 各领域知识是孤岛</li>
                <li>盲区不自知 — 不知道自己不知道什么</li>
              </ul>
            </div>
            <div className="lp2-compare-card lp2-compare-bright">
              <p className="lp2-card-eyebrow lp2-eyebrow-accent">LLM · 大语言模型</p>
              <h3 className="lp2-card-heading">5 个天生优势</h3>
              <ul className="lp2-card-list lp2-list-accent">
                <li>持久记忆 — 读过的永不遗忘，精准召回</li>
                <li>超强算力 — 同时推理上万条信息</li>
                <li>带宽无限 — 一次消化一整本书不过载</li>
                <li>跨域连接 — 天然在领域间找关联</li>
                <li>海量知识 — 看见你看不见的盲区</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE INSIGHT ── */}
      <section className="lp2-section">
        <div className="lp2-container">
          <div className="lp2-section-top">
            <p className="lp2-mono-label">THE INSIGHT</p>
            <h2 className="lp2-h2">
              知识不仅要存储
              <br />
              更需要更好地「<span className="lp2-ink">连接和调用</span>」
            </h2>
            <p className="lp2-body">
              你的大脑不缺信息，缺的是把孤立信息编织成网络、并在需要的时候精准调用的能力。认知飞轮替你跑完这整条流水线。
            </p>
          </div>

          <div className="lp2-steps">
            <div className="lp2-step">
              <span className="lp2-step-num">01</span>
              <h3 className="lp2-step-title">喂入</h3>
              <p className="lp2-step-desc">文章、链接、PDF、对话——任何形式的原始知识</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">02</span>
              <h3 className="lp2-step-title">消化</h3>
              <p className="lp2-step-desc">AI 提炼核心观点，识别矛盾，标注疑问</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">03</span>
              <h3 className="lp2-step-title">连接</h3>
              <p className="lp2-step-desc">自动挂接到你已有的知识网络，找到关联与类比</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">04</span>
              <h3 className="lp2-step-title">记忆</h3>
              <p className="lp2-step-desc">沉淀为长期记忆，按领域归档，永不遗忘</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">05</span>
              <h3 className="lp2-step-title">思考</h3>
              <p className="lp2-step-desc">决策时自动调用上下文，生成个性化洞察</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CAPABILITIES ── */}
      <section className="lp2-section lp2-section-alt">
        <div className="lp2-container">
          <div className="lp2-section-top">
            <p className="lp2-mono-label">CAPABILITIES</p>
            <h2 className="lp2-h2">
              四种思考方式
              <br />
              你的大脑独自做不到
            </h2>
          </div>

          <div className="lp2-cap-grid">
            {capabilities.map(({ icon: Icon, zh, en, desc }) => (
              <div key={zh} className="lp2-cap-card">
                <div className="lp2-cap-icon">
                  <Icon size={19} />
                </div>
                <div>
                  <h3 className="lp2-cap-zh">{zh}</h3>
                  <p className="lp2-cap-en">{en}</p>
                </div>
                <p className="lp2-cap-desc">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="lp2-section lp2-final">
        <div className="lp2-container lp2-final-inner">
          <h2 className="lp2-h-final">
            开始构建
            <br />
            你的外脑
          </h2>
          <Link href="/auth/login" className="lp2-btn lp2-btn-indigo lp2-btn-lg">
            立即体验 <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp2-footer">
        <div className="lp2-logo">
          <Brain size={14} color="#4F46E5" />
          <span>认知飞轮 Cognitive Flywheel</span>
        </div>
        <p className="lp2-footer-tagline">AI 不是替代人，是扩展人的认知能力。</p>
      </footer>
    </main>
  );
}
