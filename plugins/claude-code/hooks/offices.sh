# pixel-office: the offices this machine reports to. Sourced by po-hook.sh and po-status.sh.
#
# The server URL and token settings are lists (commas or spaces), paired in order, so one
# Claude Code can show its agents in several offices (e.g. home and work):
#   server_url: https://office.home.example, https://office.work.example
#   token:      po_u_home…, po_u_work…
# A single token is used for every office.
OFFICE_URLS="${CLAUDE_PLUGIN_OPTION_SERVER_URL:-${PIXEL_OFFICE_URL:-}}"
OFFICE_TOKENS="${CLAUDE_PLUGIN_OPTION_TOKEN:-${PIXEL_OFFICE_TOKEN:-}}"

# Calls "$1 <url without trailing slash> <token> <position in the list, from 1>" once per office, in the background, then waits.
each_office() {
  set -f
  _tokens=$(printf '%s' "$OFFICE_TOKENS" | tr ',' ' ')
  _count=$(printf '%s\n' $_tokens | grep -c .)
  _i=0
  for _url in $(printf '%s' "$OFFICE_URLS" | tr ',' ' '); do
    _i=$((_i + 1))
    if [ "$_count" -le 1 ]; then _tok=$_tokens; else _tok=$(printf '%s\n' $_tokens | sed -n "${_i}p"); fi
    "$1" "${_url%/}" "$_tok" "$_i" &
  done
  set +f
  wait
  OFFICE_COUNT=$_i
}
