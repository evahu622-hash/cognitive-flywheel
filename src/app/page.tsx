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
    desc: "你只有一个脑子。它帮你开一桌。",
  },
  {
    icon: GraduationCap,
    zh: "认知教练",
    en: "Cognitive Coach",
    desc: "你不知道自己不知道什么。它知道。",
  },
  {
    icon: Shuffle,
    zh: "跨域连接",
    en: "Cross-Domain",
    desc: "人的知识是孤岛。AI 的知识是网络。",
  },
  {
    icon: History,
    zh: "历史镜鉴",
    en: "History Mirror",
    desc: "你只活几十年。人类智慧积累了几千年。",
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
          你读过的一切
          <br />
          正在等待被<span className="lp2-ink">连接</span>
        </h1>

        <p className="lp2-subhead">
          不是更强的搜索，是真正会成长的外脑。
          <br />
          每一次输入，都让它更懂你。
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
              AI 帮你回答问题
              <br />
              但没有帮你积累智慧
            </h2>
            <p className="lp2-body">
              你和 ChatGPT 聊了一千次，它对你的了解依然为零。你读过的文章、做过的判断、产生的洞察——全部散落在聊天记录里，无法叠加，无法传承。
            </p>
          </div>

          <div className="lp2-compare">
            <div className="lp2-compare-card lp2-compare-dim">
              <p className="lp2-card-eyebrow">传统 AI</p>
              <h3 className="lp2-card-heading">每次从零开始</h3>
              <ul className="lp2-card-list">
                <li>对话结束，记忆清零</li>
                <li>无法积累你的知识偏好</li>
                <li>每次都在重新发现</li>
              </ul>
            </div>
            <div className="lp2-compare-card lp2-compare-bright">
              <p className="lp2-card-eyebrow lp2-eyebrow-accent">认知飞轮</p>
              <h3 className="lp2-card-heading">知识持续积累</h3>
              <ul className="lp2-card-list lp2-list-accent">
                <li>每次输入都沉淀为记忆</li>
                <li>越用越懂你的思维方式</li>
                <li>洞察在时间中自我叠加</li>
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
              知识不是存储的问题
              <br />
              是「<span className="lp2-ink">连接</span>」的问题
            </h2>
            <p className="lp2-body">
              你的大脑不缺信息，缺的是把孤立信息编织成网络的能力。认知飞轮做的，是替你完成这个编织的过程。
            </p>
          </div>

          <div className="lp2-steps">
            <div className="lp2-step">
              <span className="lp2-step-num">01</span>
              <h3 className="lp2-step-title">喂入</h3>
              <p className="lp2-step-desc">文章、链接、想法、对话——任何形式的知识</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">02</span>
              <h3 className="lp2-step-title">记忆</h3>
              <p className="lp2-step-desc">提炼要点，打标签，关联已有知识，建立连接</p>
            </div>
            <div className="lp2-step-arrow" aria-hidden="true">→</div>
            <div className="lp2-step">
              <span className="lp2-step-num">03</span>
              <h3 className="lp2-step-title">思考</h3>
              <p className="lp2-step-desc">从积累的知识出发，深度加工，生成洞察</p>
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
          <p className="lp2-final-sub">越早开始，飞轮转得越快。</p>
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
