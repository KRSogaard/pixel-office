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
# On SessionStart / UserPromptSubmit it sends the git branch the session is on.
# On Stop it also sends the background commands that have finished (Claude Code
# notes each one in the transcript; no hook fires for it), so the office knows
# when a build or test run started in the background is done.
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

# The git branch of the session's folder (or the short commit when detached), safe characters only.
git_branch() {
  [ -d "$1" ] && command -v git >/dev/null 2>&1 || return 0
  b=$(git -C "$1" branch --show-current 2>/dev/null)
  [ -n "$b" ] || b=$(git -C "$1" rev-parse --short HEAD 2>/dev/null)
  printf '%s' "$b" | tr -cd 'A-Za-z0-9._/-' | cut -c1-100
}

# Background commands that finished, from the transcript's task notifications:
# "toolu_1:completed,toolu_2:failed" (the tool call that started each, and how it ended).
# Reads only what was added since the last Stop of this session (remembered in a
# small file in the temp folder), so a long turn can't push a notification out of
# reach; without that file, the last 400 KB.
finished_jobs() {
  [ -r "$1" ] || return 0
  size=$(wc -c <"$1" 2>/dev/null | tr -d ' ')
  [ -n "$size" ] || return 0
  mark="${TMPDIR:-/tmp}/pixel-office-jobs-$(printf '%s' "$2" | tr -cd 'A-Za-z0-9-')"
  from=$(cat "$mark" 2>/dev/null)
  case "$from" in '' | *[!0-9]*) from=$((size - 400000)) ;; esac
  [ "$from" -gt "$size" ] && from=0
  [ "$from" -lt 0 ] && from=0
  printf '%s' "$size" >"$mark" 2>/dev/null
  tail -c +"$((from + 1))" "$1" 2>/dev/null \
    | grep -oE '<tool-use-id>[A-Za-z0-9_-]+</tool-use-id>([^<]|<(task-id|output-file|summary)>[^<]*</(task-id|output-file|summary)>)*<status>[a-z_]+</status>' \
    | sed 's#<tool-use-id>\([^<]*\)</tool-use-id>.*<status>\([^<]*\)</status>#\1:\2#' \
    | sort -u | tail -n 50 | paste -sd, - 2>/dev/null
}

CONTEXT=""
BRANCH=""
JOBS=""
case "$(field hook_event_name)" in
  Stop)
    CONTEXT=$(context_tokens "$(field transcript_path)")
    JOBS=$(finished_jobs "$(field transcript_path)" "$(field session_id)")
    ;;
  PostToolUse | PreCompact) CONTEXT=$(context_tokens "$(field transcript_path)") ;;
  SessionStart | UserPromptSubmit) BRANCH=$(git_branch "$(field cwd)") ;;
esac

set -- -s -m 3 -X POST -H 'content-type: application/json' -H "authorization: Bearer ${TOKEN}"
[ -n "$CONTEXT" ] && set -- "$@" -H "x-po-context-tokens: ${CONTEXT}"
[ -n "$BRANCH" ] && set -- "$@" -H "x-po-git-branch: ${BRANCH}"
[ -n "$JOBS" ] && set -- "$@" -H "x-po-jobs: ${JOBS}"
curl "$@" --data-binary @"$BODY" "${URL%/}/ingest/claude" >/dev/null 2>&1

exit 0
