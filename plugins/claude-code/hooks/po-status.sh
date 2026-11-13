#!/bin/sh
# pixel-office: when a session starts, show you whether each office accepts your token.
#
# Prints one JSON line, {"systemMessage": "..."}, which Claude Code shows under its banner.
# This is the only pixel-office output anywhere, and it still costs zero tokens: a
# synchronous SessionStart hook's systemMessage is shown to you and never sent to the
# model (unlike plain stdout, or an async hook's systemMessage, which both are).
# Registered without async, so it gives every office at most 2 seconds, all at once.
# Never fails: always exits 0, and prints nothing when no office is set up.
cat >/dev/null 2>&1
. "$(dirname "$0")/offices.sh" 2>/dev/null || exit 0
[ -n "$OFFICE_URLS" ] && command -v curl >/dev/null 2>&1 || exit 0

DIR=$(mktemp -d 2>/dev/null) || exit 0
trap 'rm -rf "$DIR"' EXIT INT TERM

# Writes "<host> <status>" for one office to a file named by its position (offices answer in any order).
check() {
  host=$(printf '%s' "$1" | sed 's#^[a-zA-Z]*://##; s#/.*##')
  answer=$(curl -s -m 2 -w '\n%{http_code}' -H "authorization: Bearer $2" "$1/ingest/check" 2>/dev/null)
  code=$(printf '%s' "$answer" | tail -n 1)
  # The "name" string (names may hold quotes or backslashes, so follow JSON's escapes, then undo them).
  who=$(printf '%s' "$answer" | grep -oE '"name"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*"' | head -n 1 \
    | sed -E 's/^"name"[[:space:]]*:[[:space:]]*"//; s/"$//; s/\\(.)/\1/g')
  case "$code" in
    2??) status="✓ connected${who:+ as $who}" ;;
    401) status="✗ token rejected" ;;
    404)
      # An older pixel-office has no check yet; anything else at this address is the wrong URL.
      if curl -s -m 2 "$1/health" 2>/dev/null | grep -q '"ok"[[:space:]]*:[[:space:]]*true'; then
        status="✓ reachable (older server: update it to check the token)"
      else
        status="✗ not a pixel-office server (check the URL)"
      fi
      ;;
    000 | '') status="✗ can't reach the server" ;;
    *) status="✗ server answered $code" ;;
  esac
  printf '%s %s' "$host" "$status" >"$DIR/$3"
}
each_office check

# One line per office, in the order they are configured, each made safe for a JSON string
# (backslashes and quotes escaped, control characters dropped), joined with \n.
msg="pixel-office"
i=0
while [ "$i" -lt "${OFFICE_COUNT:-0}" ]; do
  i=$((i + 1))
  line=$(cat "$DIR/$i" 2>/dev/null | tr -d '\000-\037' | sed 's/\\/\\\\/g; s/"/\\"/g')
  [ -n "$line" ] && msg="$msg\\n  $line"
done
printf '{"systemMessage":"%s"}\n' "$msg"
exit 0
