#!/bin/sh
# pixel-office: forward this Claude Code hook event to the office server.
#
# Rules (see DESIGN.md "Zero token cost"):
#   - print NOTHING: on SessionStart/UserPromptSubmit stdout would enter the model's context
#   - never fail: always exit 0, so a dead server can't disturb the agent
#   - registered with async: true, so the agent never waits for this
URL="${CLAUDE_PLUGIN_OPTION_SERVER_URL:-${PIXEL_OFFICE_URL:-}}"
TOKEN="${CLAUDE_PLUGIN_OPTION_TOKEN:-${PIXEL_OFFICE_TOKEN:-}}"

if [ -z "$URL" ] || ! command -v curl >/dev/null 2>&1; then
  cat >/dev/null 2>&1
  exit 0
fi

curl -s -m 3 -X POST \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${TOKEN}" \
  --data-binary @- \
  "${URL%/}/ingest/claude" >/dev/null 2>&1

exit 0
