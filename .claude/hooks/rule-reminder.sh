#!/bin/bash

set -euo pipefail

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')

if [ "$EVENT" != "SessionStart" ]; then
  exit 0
fi

REMINDER=$(cat <<'EOF'
项目执行纪律：
1. 一次会话只推进一个明确子任务，不要边探索边实现边验收。
2. 没有证据不要说“完成”：必须给出测试、截图、命令输出或可复现结果。
3. 测试的目标是发现问题，不是证明没问题；优先真实路径，避免伪验证。
4. 如果同类问题被纠正两次以上，停止继续堆上下文，改为 /clear 或新开会话。
5. 长会话优先做收尾，不要扩 scope；如发生 compact，保留任务目标、已改文件、验证命令、未解风险。
EOF
)

jq -n --arg reminder "$REMINDER" '{
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $reminder
  }
}'
