#!/bin/bash

set -euo pipefail

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')

STATE_DIR="/tmp/claude-code-health"
COUNT_FILE="$STATE_DIR/$SESSION_ID.count"
WARN_FILE="$STATE_DIR/$SESSION_ID.lastwarn"

mkdir -p "$STATE_DIR"

# 阈值设计（基于 1M context 窗口，Opus 4.6）：
# - 经验性质量拐点约在 40% 窗口消耗，对应 ~800 次工具调用
# - 首次警告提前到 500 次（给足收尾时间）
# - 之后每 300 次再警告一次，最多 3 次，避免反身性开销
FIRST_WARN_AT=500
WARN_INTERVAL=300
MAX_WARNS=3

case "$EVENT" in
  PostToolUse)
    COUNT=0
    if [ -f "$COUNT_FILE" ]; then
      COUNT=$(cat "$COUNT_FILE")
    fi
    COUNT=$((COUNT + 1))
    printf '%s\n' "$COUNT" > "$COUNT_FILE"
    exit 0
    ;;
  UserPromptSubmit)
    COUNT=0
    LAST_WARN=0
    WARN_COUNT=0

    if [ -f "$COUNT_FILE" ]; then
      COUNT=$(cat "$COUNT_FILE")
    fi

    if [ -f "$WARN_FILE" ]; then
      LAST_WARN=$(cat "$WARN_FILE")
    fi

    if [ -f "${WARN_FILE}.count" ]; then
      WARN_COUNT=$(cat "${WARN_FILE}.count")
    fi

    if [ "$COUNT" -lt "$FIRST_WARN_AT" ]; then
      exit 0
    fi

    if [ $((COUNT - LAST_WARN)) -lt "$WARN_INTERVAL" ]; then
      exit 0
    fi

    if [ "$WARN_COUNT" -ge "$MAX_WARNS" ]; then
      exit 0
    fi

    printf '%s\n' "$COUNT" > "$WARN_FILE"
    printf '%s\n' "$((WARN_COUNT + 1))" > "${WARN_FILE}.count"

    # 极简消息：~50 tokens vs 原来的 ~180 tokens
    CONTEXT="会话长度提醒：${COUNT} 次工具调用。优先收尾，不扩 scope；同类纠正 2 次以上考虑 /clear。"

    jq -n --arg context "$CONTEXT" '{
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: $context
      }
    }'
    ;;
  *)
    exit 0
    ;;
esac
