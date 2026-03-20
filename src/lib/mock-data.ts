// Mock data for the interactive demo

export interface KnowledgeItem {
  id: string;
  type: "article" | "thought" | "insight";
  title: string;
  summary: string;
  tags: string[];
  domain: string;
  createdAt: string;
  connections: string[];
}

export interface ThinkSession {
  id: string;
  mode: "roundtable" | "coach" | "crossdomain" | "mirror";
  question: string;
  responses: { role: string; avatar: string; content: string }[];
  createdAt: string;
  insights: string[];
}

export const MOCK_KNOWLEDGE: KnowledgeItem[] = [
  {
    id: "k1",
    type: "article",
    title: "Naval: How to Get Rich Without Getting Lucky",
    summary:
      "财富是睡觉时也能赚钱的资产。寻找特定知识——那种不能被训练出来的知识。杠杆来自资本、人力和零边际成本的产品（代码和媒体）。",
    tags: ["财富", "杠杆", "特定知识"],
    domain: "投资",
    createdAt: "2026-03-18",
    connections: ["k3", "k5"],
  },
  {
    id: "k2",
    type: "thought",
    title: "AI Agent 的本质是认知外包",
    summary:
      "Agent 不只是自动化工具，它是把人类的认知过程外包给AI。关键区别：工具需要你指挥，Agent 能自主思考和行动。",
    tags: ["Agent", "认知外包", "自主性"],
    domain: "Agent Building",
    createdAt: "2026-03-17",
    connections: ["k4"],
  },
  {
    id: "k3",
    type: "article",
    title: "Paul Graham: Do Things That Don't Scale",
    summary:
      "创业初期要做不可规模化的事情。手动服务前100个用户，深入理解需求。规模化是后来的事。",
    tags: ["创业", "规模化", "用户理解"],
    domain: "一人公司",
    createdAt: "2026-03-16",
    connections: ["k1", "k5"],
  },
  {
    id: "k4",
    type: "insight",
    title: "跨域洞察：免疫系统 ≈ Agent 架构",
    summary:
      "人体免疫系统是最完美的 Agent 系统——自主感知、判断、行动、记忆。T细胞 = 专家Agent，抗体 = 工具调用，免疫记忆 = RAG。",
    tags: ["跨域", "免疫系统", "Agent架构"],
    domain: "跨领域",
    createdAt: "2026-03-15",
    connections: ["k2"],
  },
  {
    id: "k5",
    type: "thought",
    title: "一人公司的杠杆公式",
    summary:
      "一人公司 = 特定知识 × AI杠杆 × 内容分发。AI让一个人可以做以前需要团队才能做的事。关键是找到你的特定知识。",
    tags: ["杠杆", "AI", "一人公司"],
    domain: "一人公司",
    createdAt: "2026-03-14",
    connections: ["k1", "k3"],
  },
  {
    id: "k6",
    type: "article",
    title: "间歇性断食对认知功能的影响",
    summary:
      "16:8断食模式可以提升BDNF（脑源性神经营养因子），改善认知清晰度。但需要注意个体差异和适应期。",
    tags: ["断食", "认知", "BDNF"],
    domain: "健康",
    createdAt: "2026-03-13",
    connections: [],
  },
];

export const MOCK_THINK_SESSIONS: ThinkSession[] = [
  {
    id: "t1",
    mode: "roundtable",
    question: "我应该辞职去做一人公司吗？",
    responses: [
      {
        role: "纳西姆·塔勒布（风险学者）",
        avatar: "🎲",
        content:
          "关键不是辞不辞职，而是你的下行风险是否可承受。你有多少个月的生活储备金？如果答案少于18个月，先别辞。用杠铃策略：保留工作但用20%时间做副业验证。",
      },
      {
        role: "Paul Graham（Y Combinator创始人）",
        avatar: "🚀",
        content:
          "大多数成功的创业者都是在全职投入后才真正起飞的。兼职创业会让你永远处于'还不错'的状态。但前提是你已经有了至少一个愿意付费的用户。",
      },
      {
        role: "Naval Ravikant（投资人）",
        avatar: "🧘",
        content:
          "问错了问题。不要问'我应该辞职吗'，要问'我有没有找到我的特定知识？'如果你还没找到，辞职也没用。特定知识 + 杠杆才是一人公司的基础。",
      },
    ],
    createdAt: "2026-03-18",
    insights: [
      "杠铃策略：保留安全基础的同时探索高风险高回报选项",
      "验证优先：至少有一个付费用户再考虑全职",
      "特定知识是前提条件，不是辞职后再去找的",
    ],
  },
];

export const COGNITIVE_PROFILE = {
  totalKnowledge: 42,
  totalThoughts: 18,
  totalConnections: 15,
  domains: [
    { name: "投资", count: 12, color: "#3B82F6" },
    { name: "Agent Building", count: 15, color: "#8B5CF6" },
    { name: "健康", count: 6, color: "#10B981" },
    { name: "一人公司", count: 9, color: "#F59E0B" },
  ],
  blindSpots: [
    "营销和获客策略知识较少",
    "法律和合规方面几乎空白",
    "产品定价策略缺乏系统思考",
  ],
  recentGrowth: [
    { date: "03-13", items: 2 },
    { date: "03-14", items: 3 },
    { date: "03-15", items: 1 },
    { date: "03-16", items: 4 },
    { date: "03-17", items: 2 },
    { date: "03-18", items: 5 },
    { date: "03-19", items: 3 },
  ],
  flywheelTurns: 7,
};

// Simulated AI digest responses
export const DIGEST_RESPONSES: Record<string, string[]> = {
  default: [
    "📖 提炼了 3 个核心观点",
    "🏷️ 自动标签：#思维模型 #决策",
    "🔗 发现与「Naval: How to Get Rich」有关联",
    "💡 建议归入领域：投资",
  ],
};

// Roundtable expert presets
export const ROUNDTABLE_EXPERTS: Record<
  string,
  { role: string; avatar: string; perspective: string }[]
> = {
  投资: [
    { role: "沃伦·巴菲特", avatar: "🤵", perspective: "价值投资、长期主义、护城河" },
    { role: "查理·芒格", avatar: "📚", perspective: "多元思维模型、逆向思考" },
    { role: "纳西姆·塔勒布", avatar: "🎲", perspective: "黑天鹅、反脆弱、尾部风险" },
  ],
  "Agent Building": [
    { role: "Andrej Karpathy", avatar: "🧠", perspective: "AI原生应用、LLM最佳实践" },
    { role: "Harrison Chase", avatar: "🔗", perspective: "LangChain、Agent架构、工具使用" },
    { role: "Yann LeCun", avatar: "🔬", perspective: "AI基础原理、世界模型" },
  ],
  一人公司: [
    { role: "Naval Ravikant", avatar: "🧘", perspective: "特定知识、杠杆、财富" },
    { role: "Paul Graham", avatar: "🚀", perspective: "创业、规模化、用户理解" },
    { role: "Tim Ferriss", avatar: "⚡", perspective: "效率、自动化、4小时工作" },
  ],
  健康: [
    { role: "Andrew Huberman", avatar: "🔬", perspective: "神经科学、睡眠、运动" },
    { role: "Peter Attia", avatar: "🏥", perspective: "长寿医学、代谢健康" },
    { role: "David Sinclair", avatar: "🧬", perspective: "衰老研究、生物黑客" },
  ],
};
