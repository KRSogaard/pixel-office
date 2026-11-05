#!/bin/sh
# pixel-office: forward this Claude Code hook event to the office server.
#
# Rules (see DESIGN.md "Zero token cost"):
#   - print NOTHING: on SessionStart/UserPromptSubmit stdout would enter the model's context
#   - never fail: always exit 0, so a dead server can't disturb the agent
#   - registered with async: true, so the agent never waits for this
#
# On PostToolUse / Stop / PreCompact it also reads how full the main session's
# context window is from the end of its transcript and sends it as a header.
# (Sub-agent events carry the main session's transcript_path too, so the number
# always belongs to the main agent.)
URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL:-${PIXEL_OFFICE_URL:-}}"
TOKEN="${CLAUDE_PLUGIN_OPTION_TOKEN:-${PIXEL_OFFICE_TOKEN:-}}"

if [ -z "$URL" ] || ! command -v curl >/dev/null 2>&1; then
  cat >/dev/null 2>&1
  exit 0
fi

BODY=$(mktemp 2>/dev/null) || { cat >/dev/null 2>&1; exit 0; }
trap 'rm -f "$BODY"' EXIT INT TERM
cat >"$BODY" 2>/dev/null

# The value of a top-level string field in the payload (paths have no escaped quotes in practice).
field() {
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$BODY" 2>/dev/null | head -n 1 | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'
}

# Sum of input + cache-creation + cache-read tokens in the transcript's last `usage` object.
context_tokens() {
  [ -r "$1" ] || return 0
  last=$(tail -c 400000 "$1" 2>/dev/null | grep -o '"usage"[[:space:]]*:[[:space:]]*{.*' | tail -n 1)
  [ -n "$last" ] || return 0
  sum=0
  for key in input_tokens cache_creation_input_tokens cache_read_input_tokens; do
    n=$(printf '%s' "$last" | grep -o "\"$key\"[[:space:]]*:[[:space:]]*[0-9]*" | head -n 1 | grep -o '[0-9]*$')
    [ -n "$n" ] && sum=$((sum + n))
  done
  [ "$sum" -gt 0 ] && printf '%s' "$sum"
}

CONTEXT=""
case "$(field hook_event_name)" in
  PostToolUse | Stop | PreCompact) CONTEXT=$(context_tokens "$(field transcript_path)") ;;
esac

if [ -n "$CONTEXT" ]; then
  curl -s -m 3 -X POST \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${TOKEN}" \
    -H "x-po-context-tokens: ${CONTEXT}" \
    --data-binary @"$BODY" \
    "${URL%/}/ingest/claude" >/dev/null 2>&1
else
  curl -s -m 3 -X POST \
    -H 'content-type: application/json' \
    -H "authorization: Bearer ${TOKEN}" \
    --data-binary @"$BODY" \
    "${URL%/}/ingest/claude" >/dev/null 2>&1
fi

exit 0
