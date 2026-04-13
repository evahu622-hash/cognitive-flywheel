#!/bin/bash

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

if [ -z "$COMMAND" ]; then
  exit 0
fi

BLOCK_REASON=""

if echo "$COMMAND" | grep -Eq '(^|[[:space:]])rm[[:space:]]+(-[[:alnum:]]*[[:space:]]*)*-([[:alnum:]]*r[[:alnum:]]*f|[[:alnum:]]*f[[:alnum:]]*r)'; then
  BLOCK_REASON="禁止执行 rm -rf 类破坏性删除命令。"
elif echo "$COMMAND" | grep -Eq 'git[[:space:]]+reset[[:space:]]+--hard([[:space:]]|$)'; then
  BLOCK_REASON="禁止执行 git reset --hard。"
elif echo "$COMMAND" | grep -Eq 'git[[:space:]]+clean[[:space:]]+-[[:alnum:]]*f[[:alnum:]]*d|git[[:space:]]+clean[[:space:]]+-[[:alnum:]]*d[[:alnum:]]*f'; then
  BLOCK_REASON="禁止执行 git clean 删除未跟踪文件。"
elif echo "$COMMAND" | grep -Eq 'git[[:space:]]+push([^#\n]|#[^\n]*)*--force([[:space:]]|$)|git[[:space:]]+push([^#\n]|#[^\n]*)*--force-with-lease([[:space:]]|$)'; then
  BLOCK_REASON="禁止执行 git push --force 或 --force-with-lease。"
fi

if [ -n "$BLOCK_REASON" ]; then
  jq -n --arg reason "$BLOCK_REASON 如确需执行，请由用户手动完成，或显式调整项目 hook 配置后重试。" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

exit 0
