#!/bin/bash
# ============================================================
# Cognitive Flywheel - Supabase 一键配置
# 运行: bash scripts/setup-supabase.sh
# ============================================================

set -e

echo ""
echo "🧠 Cognitive Flywheel — Supabase 配置向导"
echo "=========================================="
echo ""
echo "请先完成以下步骤："
echo "1. 打开 https://supabase.com/dashboard"
echo "2. 登录你的账号"
echo "3. 点击 'New Project' 创建新项目"
echo "   - 项目名: cognitive-flywheel"
echo "   - 数据库密码: 随便设一个（记住它）"
echo "   - Region: 选最近的（如 Northeast Asia - Tokyo）"
echo "4. 等待项目创建完成（约1-2分钟）"
echo ""
read -p "完成了吗？按 Enter 继续..."

echo ""
echo "现在去项目的 Settings → API 页面"
echo "（或直接打开: https://supabase.com/dashboard/project/YOUR_PROJECT/settings/api）"
echo ""

read -p "请粘贴 Project URL: " SUPABASE_URL
read -p "请粘贴 anon/public key: " SUPABASE_ANON_KEY

echo ""
echo "现在去 Settings → API → Service Role key（点击 Reveal 查看）"
read -p "请粘贴 service_role key: " SUPABASE_SERVICE_KEY

echo ""
echo "请输入你的 AI API Keys（没有的留空按 Enter 跳过）"
read -p "Anthropic API Key: " ANTHROPIC_KEY
read -p "OpenAI API Key: " OPENAI_KEY
read -p "Google AI API Key: " GOOGLE_KEY

# 写入 .env.local
ENV_FILE="$(dirname "$0")/../.env.local"

cat > "$ENV_FILE" << EOF
# ============================================================
# AI Model API Keys
# ============================================================
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
OPENAI_API_KEY=${OPENAI_KEY}
GOOGLE_GENERATIVE_AI_API_KEY=${GOOGLE_KEY}

# ============================================================
# Model Configuration
# ============================================================
AI_LIGHT_MODEL=claude-haiku
AI_HEAVY_MODEL=claude-sonnet
AI_EMBED_MODEL=text-embedding-3-small

# ============================================================
# Supabase
# ============================================================
NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}
NEXT_PUBLIC_SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_KEY}
EOF

echo ""
echo "✅ .env.local 已创建！"
echo ""

# 执行 SQL Schema
echo "现在需要执行数据库 Schema..."
echo "请打开 Supabase Dashboard → SQL Editor"
echo "（或直接打开: ${SUPABASE_URL}/project/default/sql/new）"
echo ""
echo "将以下文件的内容粘贴进去并执行："
echo "  📄 supabase/schema.sql"
echo ""
echo "或者复制这个命令在 SQL Editor 中执行："
echo "------"
head -5 "$(dirname "$0")/../supabase/schema.sql"
echo "... (完整内容见 supabase/schema.sql)"
echo "------"
echo ""
read -p "SQL 执行完成了吗？按 Enter 继续..."

echo ""
echo "🎉 配置完成！运行以下命令启动开发服务器："
echo ""
echo "  npm run dev"
echo ""
echo "然后打开 http://localhost:3000/feed 试试喂脑功能！"
