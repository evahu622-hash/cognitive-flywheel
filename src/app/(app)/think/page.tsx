"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Lightbulb,
  Users,
  GraduationCap,
  Shuffle,
  History,
  ArrowLeft,
  Send,
  Loader2,
  BookmarkPlus,
  RotateCcw,
} from "lucide-react";

type ThinkMode = "roundtable" | "coach" | "crossdomain" | "mirror" | null;

interface ModeConfig {
  id: ThinkMode;
  title: string;
  subtitle: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  placeholder: string;
}

const modes: ModeConfig[] = [
  {
    id: "roundtable",
    title: "圆桌会议",
    subtitle: "Roundtable",
    description: "召集多位专家从不同视角挑战和完善你的想法",
    icon: Users,
    color: "text-blue-500",
    bgColor: "bg-blue-50 dark:bg-blue-950",
    placeholder: "输入你想讨论的问题或想法，专家团会从不同角度分析...",
  },
  {
    id: "coach",
    title: "认知教练",
    subtitle: "Cognitive Coach",
    description: "发现你的知识盲区，生成个性化学习路径",
    icon: GraduationCap,
    color: "text-green-500",
    bgColor: "bg-green-50 dark:bg-green-950",
    placeholder: "描述你想深入了解的领域或最近的困惑...",
  },
  {
    id: "crossdomain",
    title: "跨域连接",
    subtitle: "Cross-Domain",
    description: "从其他领域借鉴灵感，发现意想不到的类比",
    icon: Shuffle,
    color: "text-purple-500",
    bgColor: "bg-purple-50 dark:bg-purple-950",
    placeholder: "输入一个概念或问题，看看其他领域怎么看...",
  },
  {
    id: "mirror",
    title: "历史镜鉴",
    subtitle: "History Mirror",
    description: "先驱们遇到过同样的问题，看看他们怎么做的",
    icon: History,
    color: "text-amber-500",
    bgColor: "bg-amber-50 dark:bg-amber-950",
    placeholder: "描述你当前面临的困境或决策...",
  },
];

// Simulated responses for each mode
const MOCK_RESPONSES: Record<string, () => React.ReactNode> = {
  roundtable: () => (
    <div className="space-y-4">
      {[
        {
          avatar: "🎲",
          name: "纳西姆·塔勒布",
          tag: "风险学者",
          content:
            "你在问错误的问题。不要问'这个AI产品能赚多少钱'，要问'如果我错了，最坏的情况是什么？'用杠铃策略——90%的时间做安全的事，10%做极端冒险的实验。你的认知飞轮项目？它的下行风险几乎为零（只花时间），但上行空间是无限的。这就是好的赌注。",
        },
        {
          avatar: "🚀",
          name: "Paul Graham",
          tag: "YC创始人",
          content:
            "先做一个只给自己用的版本。如果你自己每天都在用它，说明你触及了真实需求。大多数创业者失败是因为他们在做自己不会用的东西。你的外脑概念很好，但不要想着做平台——先做一个让你自己思考效率提升10倍的工具。",
        },
        {
          avatar: "🧘",
          name: "Naval Ravikant",
          tag: "投资人",
          content:
            "认知飞轮的核心价值在于：它把你的思考过程资产化了。每一次思考都变成了可复用、可积累的资产。这和代码的杠杆是一样的——写一次，永远产生回报。关键问题是：你的飞轮有没有网络效应？一个人的外脑 vs 一群人的共同外脑，价值天差地别。",
        },
      ].map((expert, i) => (
        <Card key={i} className="border-blue-100 dark:border-blue-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{expert.avatar}</span>
              <div>
                <div className="font-semibold">{expert.name}</div>
                <div className="text-xs text-muted-foreground">{expert.tag}</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed">{expert.content}</p>
          </CardContent>
        </Card>
      ))}
      <InsightBox
        insights={[
          "杠铃策略适用于早期产品：低风险主业 + 高风险实验",
          "先做给自己用的工具，验证真实需求",
          "思考过程的资产化是核心价值主张",
          "探索网络效应的可能性",
        ]}
      />
    </div>
  ),
  coach: () => (
    <div className="space-y-4">
      <Card className="border-green-100 dark:border-green-900">
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-green-500" />
            <span className="font-semibold">认知诊断报告</span>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">✅ 你的认知优势</div>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>• 跨领域思考能力强（投资 × Agent × 一人公司）</li>
              <li>• 善于用类比理解新概念</li>
              <li>• 有系统思维倾向（认知飞轮本身就是系统思维的产物）</li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">⚠️ 发现的盲区</div>
            <ul className="text-sm space-y-1">
              <li className="flex items-start gap-2">
                <span className="text-amber-500">🔸</span>
                <span>
                  <strong>技术执行层</strong>
                  ：你的vision很清晰，但前端/后端具体实现经验不足。建议先读 Josh Comeau 的《The Joy of React》建立直觉。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-amber-500">🔸</span>
                <span>
                  <strong>用户研究方法</strong>
                  ：你知道要「先做给自己用」，但缺少从个人需求到市场验证的方法论。建议读《The Mom Test》。
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-500">🔹</span>
                <span>
                  <strong>向量数据库和 RAG</strong>
                  ：这是记忆层的技术核心。建议从 Pinecone 或 Supabase pgvector 教程入手。
                </span>
              </li>
            </ul>
          </div>

          <div>
            <div className="text-sm font-medium mb-2">📚 个性化学习路径</div>
            <div className="space-y-2">
              {[
                { week: "本周", task: "完成 RAG 基础教程（Supabase pgvector）", priority: "高" },
                { week: "下周", task: "读《The Mom Test》前3章，练习用户访谈", priority: "中" },
                { week: "第3周", task: "研究 LangChain Memory 模块源码", priority: "中" },
                { week: "第4周", task: "做一个最小可用的「喂脑→记忆→检索」闭环", priority: "高" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-3 text-sm bg-muted/50 rounded-lg p-2">
                  <Badge variant={item.priority === "高" ? "default" : "secondary"} className="text-xs">
                    {item.week}
                  </Badge>
                  <span>{item.task}</span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      <InsightBox
        insights={[
          "跨域思考是核心优势，要持续加强",
          "技术执行是最大瓶颈，但AI辅助编码可以弥补",
          "RAG是记忆层的关键技术，优先学习",
        ]}
      />
    </div>
  ),
  crossdomain: () => (
    <div className="space-y-4">
      {[
        {
          domain: "🧬 生物学",
          title: "记忆巩固 ≈ 认知飞轮的回流机制",
          content:
            "大脑在睡眠时会「重播」白天的经历，将短期记忆转化为长期记忆。这个过程叫记忆巩固。你的认知飞轮的「思考回流到记忆层」本质上就是人工版的记忆巩固——主动触发而非被动等待睡眠。",
        },
        {
          domain: "🏭 工业工程",
          title: "丰田生产系统 ≈ 知识的看板管理",
          content:
            "丰田的「看板」系统实现了生产流程的可视化和拉动式管理。你的Memory页其实可以借鉴——知识不应该被推送（push），而应该在你需要时被拉取（pull）。加入「知识看板」：待消化 → 已理解 → 已关联 → 已应用。",
        },
        {
          domain: "🎵 音乐理论",
          title: "即兴演奏 ≈ 圆桌会议的底层逻辑",
          content:
            "爵士乐即兴演奏的核心不是「随便弹」，而是在和弦框架内自由探索。你的圆桌会议也是这样——专家们不是漫无目的地讨论，而是围绕你的问题（和弦进行）各自即兴。框架约束反而催生创造力。",
        },
      ].map((item, i) => (
        <Card key={i} className="border-purple-100 dark:border-purple-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-1">
              <span>{item.domain}</span>
              <span className="font-semibold text-sm">{item.title}</span>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {item.content}
            </p>
          </CardContent>
        </Card>
      ))}
      <InsightBox
        insights={[
          "回流机制 = 主动触发的记忆巩固，比被动学习更高效",
          "知识管理可以借鉴丰田看板：待消化→已理解→已关联→已应用",
          "框架约束催生创造力——圆桌会议需要好问题作为「和弦进行」",
        ]}
      />
    </div>
  ),
  mirror: () => (
    <div className="space-y-4">
      {[
        {
          avatar: "📓",
          name: "达芬奇",
          period: "15世纪",
          story:
            "达芬奇一生记录了超过7000页笔记，涵盖解剖、工程、绘画、音乐。他是最早的「第二大脑」实践者。他的方法：随身携带小本子，看到任何有趣的东西立刻记录，定期回顾并建立跨领域关联。你的认知飞轮本质上是达芬奇笔记本的AI增强版。",
          lesson: "伟大的创造者首先是伟大的记录者。",
        },
        {
          avatar: "🃏",
          name: "查理·芒格",
          period: "当代",
          story:
            "芒格在做投资决策时会问：「谁曾经处理过类似的问题？」他收集了100多个思维模型，每个来自不同学科。他称之为「多元思维模型的格栅」。你的跨域连接器和认知教练，本质上是在自动化芒格的这个方法。",
          lesson: "你不需要自己发明所有思维模型，但你需要一个系统来检索和应用它们。",
        },
        {
          avatar: "🖥️",
          name: "Doug Engelbart",
          period: "1960年代",
          story:
            "Engelbart 发明了鼠标和超文本，但他真正的vision是「增强人类智力」(Augmenting Human Intellect)。他在1962年就提出：计算机不是替代人类思考，而是扩展人类的认知能力。你的「外脑」概念与他的vision一脉相承——60年后，AI终于让这个vision成为可能。",
          lesson: "最好的技术不是替代人，而是让人变得更强大。",
        },
      ].map((item, i) => (
        <Card key={i} className="border-amber-100 dark:border-amber-900">
          <CardContent className="pt-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">{item.avatar}</span>
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="text-xs text-muted-foreground">{item.period}</div>
              </div>
            </div>
            <p className="text-sm leading-relaxed mb-2">{item.story}</p>
            <div className="text-sm font-medium text-amber-700 dark:text-amber-400 italic">
              💡 {item.lesson}
            </div>
          </CardContent>
        </Card>
      ))}
      <InsightBox
        insights={[
          "你站在巨人的肩膀上：达芬奇的记录习惯 + 芒格的思维模型 + Engelbart的增强智力",
          "「增强人类智力」这个60年的vision终于可以通过AI实现了",
          "关键不是工具多先进，而是记录和关联的习惯有多持久",
        ]}
      />
    </div>
  ),
};

function InsightBox({ insights }: { insights: string[] }) {
  const [saved, setSaved] = useState(false);

  return (
    <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="pt-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <RotateCcw className="h-4 w-4 text-primary" />
            回流到记忆层的洞察
          </div>
          <Button
            size="sm"
            variant={saved ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setSaved(true)}
          >
            <BookmarkPlus className="h-3 w-3 mr-1" />
            {saved ? "已保存 ✓" : "存入记忆"}
          </Button>
        </div>
        <ul className="space-y-1">
          {insights.map((insight, i) => (
            <li key={i} className="text-sm flex items-start gap-2">
              <span className="text-primary">→</span>
              {insight}
            </li>
          ))}
        </ul>
        {saved && (
          <div className="mt-2 text-xs text-primary font-medium">
            🔄 飞轮 +1 转！这些洞察已回流到记忆层，下次思考时外脑会参考它们。
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ThinkPage() {
  const [activeMode, setActiveMode] = useState<ThinkMode>(null);
  const [question, setQuestion] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [thinkPhase, setThinkPhase] = useState("");

  async function handleThink() {
    if (!activeMode) return;
    setIsThinking(true);
    setShowResult(false);

    const phases: Record<string, string[]> = {
      roundtable: [
        "📋 分析你的问题...",
        "👥 召集专家团...",
        "🎤 塔勒布发言中...",
        "🎤 Paul Graham发言中...",
        "🎤 Naval发言中...",
        "💡 提炼关键洞察...",
      ],
      coach: [
        "🔍 分析你的知识库...",
        "📊 生成认知画像...",
        "🎯 识别盲区...",
        "📚 规划学习路径...",
      ],
      crossdomain: [
        "🌐 搜索跨领域知识...",
        "🧬 生物学视角...",
        "🏭 工程学视角...",
        "🎵 艺术视角...",
        "🔗 建立类比关联...",
      ],
      mirror: [
        "📜 搜索历史先驱...",
        "🔍 匹配相似困境...",
        "📖 达芬奇的故事...",
        "📖 芒格的方法...",
        "📖 Engelbart的vision...",
        "💡 提炼历史智慧...",
      ],
    };

    for (const phase of phases[activeMode] || []) {
      setThinkPhase(phase);
      await new Promise((r) => setTimeout(r, 700));
    }

    setIsThinking(false);
    setShowResult(true);
  }

  const currentMode = modes.find((m) => m.id === activeMode);

  // Mode selection view
  if (!activeMode) {
    return (
      <div className="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Lightbulb className="h-8 w-8" />
            Think · 思考室
          </h1>
          <p className="text-muted-foreground mt-2">
            选择一种思考模式，让外脑帮你深度思考
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modes.map((mode) => (
            <Card
              key={mode.id}
              className="hover:shadow-lg transition-all cursor-pointer hover:scale-[1.02]"
              onClick={() => setActiveMode(mode.id)}
            >
              <CardHeader>
                <div
                  className={`w-12 h-12 rounded-lg ${mode.bgColor} flex items-center justify-center mb-2`}
                >
                  <mode.icon className={`h-6 w-6 ${mode.color}`} />
                </div>
                <CardTitle>
                  {mode.title}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {mode.subtitle}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">{mode.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Active thinking view
  return (
    <div className="flex flex-col gap-6 p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => { setActiveMode(null); setShowResult(false); setQuestion(""); }}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          返回
        </Button>
        <div className={`w-8 h-8 rounded-lg ${currentMode?.bgColor} flex items-center justify-center`}>
          {currentMode && <currentMode.icon className={`h-4 w-4 ${currentMode.color}`} />}
        </div>
        <h1 className="text-2xl font-bold">{currentMode?.title}</h1>
      </div>

      {/* Input */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <Textarea
            placeholder={currentMode?.placeholder}
            rows={4}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={isThinking}
          />
          <div className="flex justify-end">
            <Button onClick={handleThink} disabled={isThinking}>
              {isThinking ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  思考中...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-1" />
                  开始思考
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Thinking Animation */}
      {isThinking && (
        <Card className="border-primary/50 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-lg font-medium">{thinkPhase}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {showResult && activeMode && MOCK_RESPONSES[activeMode] && (
        <div className="space-y-4">{MOCK_RESPONSES[activeMode]()}</div>
      )}
    </div>
  );
}
