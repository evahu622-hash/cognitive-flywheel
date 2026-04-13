#!/bin/bash

set -euo pipefail

INPUT=$(cat)
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty')
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // "unknown"')
STATE_DIR="/tmp/claude-code-health"

EDITS_FILE="$STATE_DIR/$SESSION_ID.edits"
EDIT_TS_FILE="$STATE_DIR/$SESSION_ID.edit-ts"
VERIFY_TS_FILE="$STATE_DIR/$SESSION_ID.verify-ts"
VERIFY_CMD_FILE="$STATE_DIR/$SESSION_ID.verify-cmd"
WARNED_FILE="$STATE_DIR/$SESSION_ID.verify-warned-for"

mkdir -p "$STATE_DIR"

is_skip_path() {
  # 白名单：这些路径不触发验证提醒
  # 文档、脚本、配置、Claude hooks 自身、evals 报告等
  local path="$1"
  case "$path" in
    docs/*|*/docs/*) return 0 ;;
    scripts/*|*/scripts/*) return 0 ;;
    *.md|*.MD) return 0 ;;
    .claude/*|*/.claude/*) return 0 ;;
    CLAUDE.md|*/CLAUDE.md) return 0 ;;
    *.json|*.yaml|*.yml|*.toml) return 0 ;;
    evals/*|*/evals/*) return 0 ;;
    supabase/migrations/*) return 0 ;;
  esac
  return 1
}

record_edit() {
  local file_path="$1"
  [ -z "$file_path" ] && return 0

  # 白名单内的文件不进入待验证清单
  local rel_path="${file_path#$CLAUDE_PROJECT_DIR/}"
  if is_skip_path "$rel_path"; then
    return 0
  fi

  touch "$EDITS_FILE"
  if ! grep -Fxq -- "$file_path" "$EDITS_FILE"; then
    printf '%s\n' "$file_path" >> "$EDITS_FILE"
  fi

  date +%s > "$EDIT_TS_FILE"
}

record_verification() {
  local command="$1"
  date +%s > "$VERIFY_TS_FILE"
  printf '%s\n' "$command" > "$VERIFY_CMD_FILE"
  rm -f "$WARNED_FILE"
}

is_verification_command() {
  local command="$1"
  echo "$command" | grep -Eiq '(^|[[:space:]])((npm|pnpm|yarn|bun)[[:space:]]+(run[[:space:]]+)?(test|lint|build|typecheck|check|e2e:user-flow|evals:gate|evals:retrieval|embeddings:test)\b|next[[:space:]]+build\b|eslint\b|tsc\b|vitest\b|jest\b|playwright\b|node[[:space:]]+scripts/(e2e-user-flow|eval-gate|eval-retrieval|test-embedding-providers)\.mjs\b)'
}

collect_file_hints() {
  local edit_count=0

  if [ -f "$EDITS_FILE" ]; then
    edit_count=$(sed '/^[[:space:]]*$/d' "$EDITS_FILE" | wc -l | tr -d ' ')
  fi

  if [ "$edit_count" -eq 0 ]; then
    return 0
  fi

  # 简短提醒：只给出数量 + 一条建议，不列出所有文件
  printf '验证提醒：本轮修改了 %s 个 src/ 文件但未运行验证命令。回复前请跑 npm run lint 或真实交互验证；若无法验证请说明原因与风险。\n' "$edit_count"
}

case "$EVENT" in
  PostToolUse)
    TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
    if [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "Write" ]; then
      FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
      record_edit "$FILE_PATH"
    elif [ "$TOOL_NAME" = "Bash" ]; then
      COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
      if [ -n "$COMMAND" ] && is_verification_command "$COMMAND"; then
        record_verification "$COMMAND"
      fi
    fi
    exit 0
    ;;
  UserPromptSubmit)
    EDIT_TS=0
    VERIFY_TS=0
    WARNED_FOR=0

    [ -f "$EDIT_TS_FILE" ] && EDIT_TS=$(cat "$EDIT_TS_FILE")
    [ -f "$VERIFY_TS_FILE" ] && VERIFY_TS=$(cat "$VERIFY_TS_FILE")
    [ -f "$WARNED_FILE" ] && WARNED_FOR=$(cat "$WARNED_FILE")

    if [ "$EDIT_TS" -eq 0 ] || [ "$EDIT_TS" -le "$VERIFY_TS" ]; then
      exit 0
    fi

    if [ "$WARNED_FOR" -eq "$EDIT_TS" ]; then
      exit 0
    fi

    REMINDER=$(collect_file_hints)
    if [ -z "$REMINDER" ]; then
      exit 0
    fi

    printf '%s\n' "$EDIT_TS" > "$WARNED_FILE"

    jq -n --arg context "$REMINDER" '{
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
