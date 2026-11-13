# pixel-office — design

A local web app that draws a small pixel-art office. Every coding agent running on your
machine (Claude Code, OpenCode, anything else that can send an HTTP request) becomes a
little person in that office. They walk to the right place for what they're doing, sit and
type when they edit code, raise a hand when they need your permission, and walk over to each
other with speech bubbles when one agent hands work to another.

Reference: [foreman-vision](https://github.com/ilkemerol/foreman-vision-pub) does a similar
thing for Claude Code only. What pixel-office does differently is listed at the end.

---

## 1. What you see

### The office

One open-plan floor, built from a tile map, with these areas:

| Area | Who goes there |
|---|---|
| **Team areas** | One per session, on a rug in the session's colour, labelled `project · Manager`. The main agent sits at a big manager's desk at the head; its sub-agents sit at worker desks in front of it. Sessions of the same project sit next to each other. An area grows a row of desks when its sub-agents run out of free ones. |
| **Library** (bookshelves) | Agents reading or searching code. |
| **Server room** (racks, blinking lights) | Agents running shell commands, builds, tests. |
| **Window / globe desk** | Agents fetching web pages or searching the web. |
| **Mailroom** | Agents calling MCP tools (Slack, Drive, databases, …). |
| **Test lab** | Agents running tests. The sign over the door shows the latest result in the office: ⏳ running, ✓ pass, ✗ fail. |
| **Front desk** | Where agents stand when they're waiting for *you* — permission prompts, questions. |
| **Lounge** (coffee machine, sofa) | Agents that are idle — they finished their turn and are waiting for your next prompt. |
| **Front door** | New sessions walk in; ended sessions walk out. |

### Each agent

- **Body**: a small character generated from layered sprite parts (skin, hair, shirt, trousers),
  picked from a hash of the agent id, so the same agent always looks the same.
- **Session colour**: every session gets its own colour, handed out in order of appearance and
  spaced around the colour wheel. It's the ring under the agent's feet and the stripe on its
  name tag. A main agent and all its sub-agents share it, so you can see who belongs to whom.
- **Name tag**:
  - line 1: tool badge (`C` Claude, `O` OpenCode), a first name (unique among agents in the
    office), and for sub-agents a `sub · <type>` chip in the session colour;
  - line 2, the *why*: for a main agent, the prompt it's working on; for a sub-agent,
    `↳ <parent>: <task>`; when it needs you, `needs you: <what>`. Hidden in privacy mode.
  - Hovering shows the current tool call and the full prompt or brief.
  - When agents crowd together, tags move up out of each other's way, and a thin line in the
    session colour points from a moved tag back to its agent.
- **Activity animation**: a small animated icon beside the head (`src/art/fx.ts`): a thought
  cloud filling with dots, a page being written, a book flipping pages, a terminal printing
  lines, a globe turning, a bouncing envelope, two people passing a task, a blinking `!`,
  floating `z`s. It pops in on every new tool call. Agents thinking at their desk also sit
  still and now and then scratch their head; agents typing make their monitor scroll code.
- **Click** an agent to open a side panel (project, doing now, the prompt or the brief from its
  parent, parent/sub-agent links, last ~20 tool calls) and to draw dotted lines to its parent
  and sub-agents.

### Activity → place → animation

| Agent is… | Goes to | Animation |
|---|---|---|
| Thinking (prompt received, no tool yet) | Own desk | Sitting, `…` bubble |
| Editing / writing files | Own desk | Typing |
| Reading / grepping / globbing | Library | Browsing a shelf |
| Running a shell command | Server room | Standing at a rack terminal |
| Web fetch / search | Window desk | Looking at the globe |
| Calling an MCP tool | Mailroom | Sorting envelopes |
| Running tests (`npm test`, `vitest`, `pytest`, `dotnet test`, …) | Test lab | Standing at a bench; the lab's sign shows ⏳ running / ✓ pass / ✗ fail |
| Spawning a sub-agent | Own desk | See section 3 |
| Waiting for permission / a question | Front desk | Hand raised, red `!` |
| Compacting its context | Filing cabinet | Stuffing papers into a drawer |
| A tool failed | Wherever it is | Small smoke puff, then carries on |
| Idle (turn finished) | Lounge | Coffee / sofa |
| Session ended | Front door | Walks out, despawns |

**Debouncing.** Agents fire tools fast — a Grep, a Read, an Edit, a Read again, inside two
seconds. If characters walked to the library for every 50 ms Grep, the office would be chaos.
Rule: an agent only *changes location* when a new activity category has lasted at least
~1.5 s, or when it's been at the current spot for at least ~3 s. Rapid calls inside the same
category keep the agent where it is and just update the bubble. This lives in the client,
because it's purely about how things look.

---

### Extras

| Feature | What it shows | Where |
|---|---|---|
| **Whiteboard** | The manager's todo list (Claude `TodoWrite` and task tools / `TaskCreated` / `TaskCompleted`, OpenCode `todo.updated`): `☑ 3/7`, a progress bar, the item in progress; click it for the whole list. | `ui/overlay.ts` (`whiteboard`), tile `W` |
| **Context bin** | A bin beside each desk filling green → amber → red as the context window fills; stomped flat (with paper scraps) while the agent compacts at its desk. The Claude hook reads the last `usage` from the transcript and sends it as a header; OpenCode sends assistant message token counts. 200k window assumed, 1M once exceeded. | `scene/bins.ts` |
| **Reactions** | A passing test run (`npm test`, `vitest`, `pytest`, `dotnet test`, …): arms up, confetti, "Tests pass! 🎉". A failed tool call: smoke. A rate limit / overload: a walk to the coffee machine. | `scene/effects.ts`, `isTestRun` in protocol |
| **Git room + rocket silo** | Git work (commit, push, pull, rebase, `gh pr`) is its own activity; every push / PR / release launches a rocket Factorio-style: doors open, the rocket rises, countdown, liftoff with flame, smoke and screen shake. | `scene/silo.ts`, `isGitCommand` / `isShipCommand` in protocol |
| **Antics** | Gags driven by real events: lab fire after two failed test runs, sweat and gasps on scary commands, couriers for MCP calls, the team printer for documents, medics for a failed sub-agent, high fives on success, a dance when every todo is done, a rubber duck after 20 s of thinking, yawns after two hours, pizza when five agents work at once, Byte on a keyboard. | `scene/antics.ts`, `scene/extras.ts` |
| **Git branch** | The hook sends the session folder's branch on session start and every prompt; it shows on the team label. | `po-hook.sh`, `branch` event |
| **Stuck flame** | A flame over the head when an agent has been on one tool call for 10+ minutes. | `Character.setStuck` |
| **List view** | ☰: everyone as a table, grouped by session, sessions that need you first. | `ui/listview.ts` |
| **Windows and clock** | Windows show a skyline following the time of day; a wall clock with real hands. | `scene/decor.ts` |
| **Logistic robots** | Every `git commit` sends a little flying robot from the agent's desk to the silo with a crate; it fills the cargo gauge (commits not yet pushed). A launch empties it. (Replaced conveyor belts, which took a whole row of floor.) | `scene/drones.ts`, gauge in `scene/silo.ts` |
| **Bugs** | Each failed tool call lets a bug loose; it wanders. A passing test run squashes that session's bugs; 9+ bugs swarm the server room; bugs leave after 20 min. | `scene/bugs.ts` |
| **Production sidebar** | 📊 a sidebar beside the office (not over it): today's launches, commits, tests and pass rate, edits, bugs, fires, prompts, tool calls per hour, all-time numbers and the trophy cabinet. Counters are kept and saved by the server (`/api/stats`, `stats` message). | `ui/board.ts`, `server/src/stats.ts` |
| **Achievements** | 12 trophies (Liftoff, Space Program, Pyromaniac, Green Wall, Crunch Time, Delegator, Night Owl, Marathon, Thousand Cuts, Big Brain, Living Dangerously, Bug Squasher), unlocked by the server, announced with a toast and a fanfare. | `ACHIEVEMENTS` in protocol |
| **Gossip** | Idle agents in the lounge chat about recent happenings (launches, fires, scary commands, medics, ducks, pizza, squashed bugs), or small talk. | `scene/antics.ts` |
| **Seasons** | Christmas tree and snowy windows in winter, pumpkins at Halloween, confetti at New Year, balloons and party hats on the office's birthday. `?date=YYYY-MM-DD` previews. | `office/season.ts`, `scene/seasonal.ts` |
| **Sound effects** | 🔊 synthesized: rocket rumble, lab alarm, meow, bug squash, achievement fanfare, soft keyboard clicks. | `ui/sounds.ts` |
| **Visitors** | Familiar faces and office characters who drop by every 3–8 minutes, tour a few stops and leave: Elon Musk (on a scooter), Donald Trump, the Consultant, the Lost Intern, the Investor (comments on today's real numbers), Grandpa Cobol (naps on the sofa); the Auditor comes after a scary command. The lounge gossips about them afterwards. `?visitors=fast` previews. | `scene/visitors.ts` |
| **Day and night** | Tint from your local clock (`?hour=22` to preview); light pools on manager lamps and occupied desks after dark. | `scene/lighting.ts` |
| **Byte the cat** | Wanders, sits by agents, naps; click for a purr. | `scene/pet.ts` |
| **Notifications** | 🔔 a synthesized bell when an agent needs you, a chime when a main agent finishes; 🖥 desktop notifications while the tab is in the background. Opt-in, per browser. | `ui/notify.ts` |
| **Replay** | ⏪ a timeline over the server's last 2 hours (`/api/history`): scrub or play at 1–64×; "Live" returns. | `ui/replay.ts`, `hub.ts` |
| **Office settings** | ⚙ room order along the top, each room's minimum size, teams per row, rugs, plants — saved on the server (`/api/settings`) and pushed to every browser. This is the layout editor for a generated office. | `ui/settings.ts`, `server/src/settings.ts` |

Sub-agents pop up beside their parent with a puff of sparkles and get their brief in a quick
huddle right there. A manager whose sub-agents are still working waits at its desk instead of
going to the lounge. When tags crowd together they drop their "why" line for a moment.

### Several people, one office

- **People**: each person gets their own ingest token (`po_u_…`, created in 👥 or with
  `pixel-office user add <name>`). The server stamps every event from that token with the
  person's name (`user` on the event and the agent) and ignores any `user` a client sends.
  The shared ingest token still works, with no name.
- **Who's who on screen**: name tags start with a chip in the person's own colour, then the
  agent's name; the second line starts with the project. Team labels read
  `project · manager · person · ⎇ branch`. The list view and the detail panel show the person.
- **Login and roles**: people log in with their **name and their own token** (the one in
  their Claude plugin). Each person is a *member* (watch, renew their own token) or an
  *admin* (also ⚙ settings and 👥 people / screens). The role is looked up on every
  request, so promoting, demoting or removing someone takes effect at once. The **admin
  token** (`po_a_…`, printed on first start; `/admin?token=…`) is the setup and emergency
  key: use it to add yourself as an admin. The old shared password (older installs, or
  `PIXEL_OFFICE_PASSWORD`) only logs in until someone has the admin role.
  A **TV code** (6 letters, `abc-def`, created in 👥 or with `pixel-office display add <name>`),
  typed into the login page's "TV code" box or opened as `/tv/abc-def`, logs a screen in as a
  *viewer* for a year: it can watch, not change anything. Removing the screen logs it out.
  "New token" / "New code" replace a person's token or a screen's code.
- **TV mode** (viewers, or `?tv`): no buttons, bigger tags, the office always fitted to the
  screen, the mouse hidden when idle, and a screen wake lock.
- **Auto-update**: the server sends the web build's id (a hash of `index.html`) on connect and
  re-checks it every 10 s; a browser that sees a different id than it started with shows
  "New version" and reloads — so a TV picks up updates on its own.
- Tokens and keys are stored only as SHA-256 hashes (`DATA_DIR/users.json`, `secrets.json`).

## 2. How agents connect

pixel-office is a **self-hosted website**: one server (Docker or `pnpm start`) that every agent
on every machine sends events to. The connectors are thin senders; they don't run a server.

All agents use **one HTTP ingest endpoint**. Each tool's connector forwards its native events
as-is, and the server translates them into one common format (section 4). That keeps the
connectors to a few lines each, and puts all parsing in TypeScript where it's unit-tested
against real payloads.

```
Claude Code ──async hook (curl)──┐
OpenCode    ──plugin (fetch)─────┼──► POST /ingest/:source ──► adapter ──► reducer ──► WebSocket ──► browser
anything    ──POST JSON──────────┘    (bearer token)         (per source)  (office state)
```

### Zero token cost — the rule

The office never costs the model a token. The LLM does nothing to keep it updated and doesn't
know it exists.

- **Hooks only.** Hooks are run by the Claude Code harness, outside the model.
- **Hooks print nothing.** On `SessionStart` and `UserPromptSubmit`, hook stdout is *added to
  the model's context*. `po-hook.sh` sends all output to `/dev/null` and always exits 0. A test
  (`packages/server/test/hook-script.test.ts`) asserts silence with the server up, down, unset,
  and replying with text.
- **The one exception: the connection status.** `po-status.sh` runs on `SessionStart`
  (startup and resume) and prints a single `{"systemMessage": "…"}`. For a *synchronous*
  SessionStart hook Claude Code shows `systemMessage` to the user and does not send it to the
  model (checked: a model asked to repeat a codeword from it answered "none"). It must stay
  synchronous: an async hook's `systemMessage` is delivered *to the model* on the next turn.
  It gives every office at most 2 s, in parallel. It never prints anything else.
- **The server always answers ingest with an empty `204`.** (Not that it matters for an async
  command hook, but an HTTP hook pointed at it would also be safe.)
- **Async.** Every hook is registered with `async: true`, so Claude Code starts it and carries
  on without waiting — a slow or dead server costs the agent nothing.
- **No MCP server, no skill, no slash command.** Each of those would put text in front of the model.

The OpenCode plugin is plain code running inside the OpenCode process: fire-and-forget
`fetch` with a 3 s timeout, never throws, adds nothing to the model's context.

### Claude Code: the plugin

`plugins/claude-code/` is a Claude Code plugin, published through this repo's
`.claude-plugin/marketplace.json`:

```
/plugin marketplace add KRSogaard/pixel-office
/plugin install pixel-office@pixel-office
```

- `.claude-plugin/plugin.json` declares two `userConfig` values Claude Code asks for when the
  plugin is enabled: `server_url`, and `token` (marked `sensitive`, so it goes to secure storage).
  Claude Code exports them to hooks as `CLAUDE_PLUGIN_OPTION_SERVER_URL` /
  `CLAUDE_PLUGIN_OPTION_TOKEN`. `PIXEL_OFFICE_URL` / `PIXEL_OFFICE_TOKEN` work as fallbacks.
- `hooks/hooks.json` registers `po-hook.sh` (exec form, `async: true`) for `SessionStart`,
  `SessionEnd`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`,
  `PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `SubagentStart`, `SubagentStop`,
  `PreCompact`, `TeammateIdle`.
- `hooks/po-hook.sh` pipes stdin to `curl -m 3` with the bearer token. That's the whole connector.

Sub-agents: hook payloads fired inside a sub-agent carry `agent_id` / `agent_type`, so the
adapter maps them to their own character (`claude:<agent_id>`) with the main session as parent.
`SubagentStart` / `SubagentStop` bring them in and out; `SubagentStop`'s
`last_assistant_message` is the report the child hands back. The reducer links each new child
to the parent's oldest pending `Agent`/`Task` call, which gives the delegation its text.

Verified against a real `claude -p` session (v2.1.318): prompt, `Bash: List files in current
directory`, `Read package.json`, session end — and the model's reply was unaffected.

### OpenCode: the plugin

`plugins/opencode/pixel-office.ts`, installed with `pixel-office install-opencode` into
`~/.config/opencode/plugins/`. It forwards a filtered set of bus events (`session.created`,
`session.deleted`, `session.idle`, `session.status`, `session.compacted`, `session.error`,
`permission.updated` / `permission.asked` / `permission.replied`) plus `tool.execute.before` /
`after` (name and call id only, never outputs) and `chat.message` (the prompt text). The bus also
streams every token as `message.part.updated`; those are deliberately not forwarded.

OpenCode sub-agents are child sessions with a `parentID`. A child going idle means it's done,
so the adapter turns that into a report-back.

Verified against `opencode serve` v1.19.5: a session created over its API walked into the office,
and deleting it walked it out.

### Anything else

Any agent or script can `POST /ingest/generic` with the normalized event shape (section 4).
That's also how the simulator feeds the office.

## 3. Agents talking to each other

"Talking" needs a concrete definition, otherwise it's just decoration. These are real
interactions in the event stream, each with its own scene:

| Real interaction | Scene in the office |
|---|---|
| **Delegation** — an agent spawns a sub-agent (Claude `Agent`/`Task` tool, OpenCode child session) | The sub-agent pops up right beside its parent in a puff of sparkles; the parent's bubble shows the task (or all tasks, for a fan-out collected over 400 ms), each sub-agent says "On it!", and they go straight to work — no walk that would hide real work. |
| **Report back** — the sub-agent finishes | Child walks to the parent, bubble "done ✓" (or "failed ✗"), then walks out. The parent's bubble briefly shows what came back. |
| **Peer message** — Claude Code agent teams' `SendMessage` tool | Sender walks to the recipient's desk, bubble with the first line of the message, walks back. |
| **You → agent** — `UserPromptSubmit` | The phone on that agent's desk rings; bubble shows the first ~60 chars of your prompt. If the agent was in the lounge, it hurries back to its desk first. |
| **Agent → you** — permission request or question | Agent walks to the front desk, hand up, `!` bubble. The browser tab title and favicon show a count of agents waiting on you. |

Bubble text is cut to one short line. A setting hides all prompt and message text (bubbles
show icons only) for when you're screen-sharing.

---

## 4. The normalized event

Every adapter turns its native payload into one shape, defined as a zod schema in
[`packages/protocol/src/events.ts`](packages/protocol/src/events.ts). Every event carries
`source`, `agentId`, `sessionId`, optional `parentAgentId` and `label` (sub-agent type or
teammate name), `project` (`path` + `name`), and `ts`. The `kind` is one of:

| kind | extra fields | meaning |
|---|---|---|
| `session.start` | | agent appears (main session or sub-agent) |
| `session.end` | `ok?`, `report?` | agent leaves; a sub-agent's `report` is what it hands back |
| `prompt` | `text` | you sent it a prompt |
| `busy` | | working, no tool yet (OpenCode `session.status: busy`) |
| `tool.start` | `callId`, `tool`, `category`, `summary?` | a tool call began |
| `tool.end` | `callId`, `ok` | it finished (or failed) |
| `waiting` | `reason` (`permission` / `question`), `text?` | it needs you |
| `idle` | | turn finished |
| `compact` | | compacting its context |
| `error` | `text?` | the turn failed (rate limit, API error…) |
| `message` | `to`, `text` | it messaged another agent (`to` = agent id, or a label/name in the same session) |

`summary` is built by the adapter (`Read src/app.ts`, `Bash: npm test`, `Grep "useAuth"`).
Large `tool_input` such as file contents never leaves the adapter.

---

## 5. Architecture

The key boundary: **the server owns *what* each agent is doing; the browser owns *how it looks*.**
The server never knows about tiles, paths, or animations. The browser never parses Claude or
OpenCode payloads.

### Protocol (`packages/protocol`)

- `events.ts` — the `AgentEvent` zod schema (section 4); text is clipped to one 280-char line on parse.
- `state.ts` — `OfficeState`: agents with status, activity, open and recent tool calls, the
  prompt, what they last said (`lastSaid`, which drives speech bubbles and scenes).
- `reducer.ts` — pure `(OfficeState, AgentEvent) → OfficeState`. Runs on the server **and in
  every browser**, so they can't disagree. Creates agents on first sight, revives ended ones,
  links sub-agents to delegations, prunes ended agents after 60 s.
- `tools.ts` — tool name → category, and short summaries (`Read app.ts`, `Bash: npm test`)
  that never include file contents.

### Server (`packages/server`)

- `http.ts` — Hono app: `/health`, `POST /ingest/:source` (bearer token, 256 KB limit, always
  `204`), `/login` + `/logout`, `/api/state`, and the built web app (redirects to `/login`
  without a session).
- `adapters/` — one per source (`claude`, `opencode`, `generic`), tested against payloads in the
  documented shapes.
- `hub.ts` — holds the state, applies events, notifies sockets, optionally records JSONL.
- `reaper.ts` — every 30 s: working agents silent for 10 min go idle; anything silent for
  30 min walks out. Covers killed sessions that never sent `SessionEnd`. Emits ordinary events,
  so browsers stay in sync.
- `ws.ts` — `/ws`: snapshot on connect, then each event, plus a snapshot every 30 s for resync.
- `simulator/` — scripted scenarios (`busy-day`, `delegation-tree`, `permission-storm`,
  `two-tools`, `team`) and JSONL replay, posted through `/ingest/generic`.
- `main.ts` — CLI: `serve`, `simulate`, `token`, `install-opencode`.
- In-memory only. A restart starts with an empty office; agents reappear on their next event.

### Web (`packages/web`)

- **Vite + TypeScript + Phaser 4.** Phaser gives the camera (pan, zoom), sprites, tweens and input.
- **The office is generated** (`src/office/generate.ts`), pure: plan in, office out. Each room
  is a template that takes a width — library, server room, test lab, mailroom across the
  top; reception, lounge, globe desks and filing cabinets in a strip below; then one team area
  per session (manager's desk + worker desks, three per row), wrapping three to a row. The
  layout chars and their meaning are listed in `src/office/layout.ts`.
  *Changed from the first draft:* first the Tiled editor, then a hand-edited text map; neither
  can describe rooms that change size, so the layout is now generated from templates.
- **Planner** (`src/office/planner.ts`) — turns live state into a plan: which sessions have a team
  (grouped by project, in order of arrival), how many worker desks each needs (sub-agents + one
  free, in rows of three), and each room's capacity (agents wanting it + one spare, rounded up
  to an even number, never below a minimum). Growth is immediate; shrinking waits a minute.
  The scene rebuilds at once when a team appears or grows, and at most every 4 s for room
  resizes. After a rebuild, anyone left inside a wall steps out and everyone re-routes; the
  camera re-fits unless you've panned or zoomed yourself.
- **Allocator** (`src/office/allocator.ts`) — a main agent sits in its session's manager chair; a
  sub-agent keeps a worker slot for life (the slot survives rebuilds, only its coordinates
  change); shared spots are reserved briefly so agents spread out.
- **Director** (`src/office/director.ts`) — activity → place + pose, and the debounce rule from
  section 1. Dwell time counts from *arrival*, not departure, so a brief tool call can't turn an
  agent around halfway.
- **Pathfinding** — A* on the tile grid (`src/office/pathfind.ts`).
- **Scene** (`src/scene/OfficeScene.ts`) — syncs state into characters, stages the scenes in
  section 3, error smoke puffs.
- **Overlay / HUD / panel** — DOM over the canvas: name tags (nudged apart so they don't
  overlap), speech bubbles, team labels, counts, privacy toggle, connection light,
  tab-title count and favicon dot when agents wait on you, and the agent detail panel.
- `window.pixelOffice` exposes the store and scene (`scene.debug()`) for poking at from the console.

### Repo layout

```
pixel-office/
├─ .claude-plugin/marketplace.json   this repo is the Claude Code marketplace
├─ plugins/
│  ├─ claude-code/                   the Claude Code plugin (manifest, hooks.json, po-hook.sh)
│  └─ opencode/pixel-office.ts       the OpenCode plugin
├─ packages/
│  ├─ protocol/                      events, state, reducer, tool categories (shared)
│  ├─ server/                        ingest, adapters, auth, ws, reaper, simulator, CLI
│  └─ web/                           Phaser office, art, overlay, panel
├─ Dockerfile, docker-compose.yml
├─ README.md
└─ DESIGN.md
```

**Stack:** Node 22+, TypeScript, pnpm workspaces, Hono + `ws`, zod, esbuild (server bundle),
Vite, Phaser 4, Vitest.

---

## 6. Art

- 16×16 tiles, drawn in code (`src/art/tiles.ts`): wood, carpet and server-room floors, walls with
  windows, bookshelves with random books, blinking racks, desks with monitors, sofas, plants,
  filing cabinets, the reception bell.
- Characters are 16×24 sprite sheets generated per agent (`src/art/characters.ts`) from layered
  parts — skin, hair colour and style, shirt, trousers — picked from a hash of the agent id.
  Frames: 4-direction walk, typing at a desk (from behind), working at a station, waving at
  reception, lounging on a sofa.
- *Changed from the first draft:* no third-party sprite packs at all, so there's nothing to license.

---

## 7. Security and privacy

Prompts, file paths, and shell commands are sensitive.

- **Two secrets**, generated on first start if not set by env and stored in
  `DATA_DIR/secrets.json`: the website password (stored as a scrypt hash) and the ingest token.
  Comparisons are constant-time.
- **Website**: password login → HMAC-signed `po_session` cookie (`HttpOnly`, `SameSite=Strict`,
  `Secure` on HTTPS, 30 days). Login is rate-limited (10 tries / 15 min per IP).
- **WebSocket** requires the cookie *and* an `Origin` matching `Host`, which blocks other sites
  from opening a socket with your cookie.
- **Ingest** requires the bearer token.
- `PIXEL_OFFICE_TRUST_PROXY` makes the server honour `X-Forwarded-For` / `-Proto` behind a TLS
  reverse proxy. Off by default, because otherwise anyone could spoof them to dodge the rate limit.
- **Privacy mode** toggle in the HUD hides prompt and message text in bubbles and the panel.
- Nothing is written to disk except `secrets.json`, unless you set `PIXEL_OFFICE_RECORD`.

---

## 8. Different from foreman-vision

| | foreman-vision | pixel-office |
|---|---|---|
| Agents supported | Claude Code only | Claude Code, OpenCode, anything that can POST |
| Where it runs | Local only, started by the plugin | Self-hosted server; agents on any machine connect |
| Hook transport | Hook appends to a spool file; server tails the files | Async hook POSTs straight to the server |
| Layout | One floor per session | One shared office: a team area per session with a manager's desk, rooms that grow with use |
| Agent-to-agent | Sub-agents at desks under their session | Scenes for delegation, fan-out kickoff, report-back, peer messages |
| Office layout | Drawn in code | Generated from room templates to fit who's online |

The trade-off of direct POST: if the server is down, those events are lost and the agent
reappears on its next event. The reaper cleans up anything left hanging.

---

## 9. Not built (ideas from the first draft you haven't decided on)

- **You in the office**: tried (a character behind the reception counter who walked each
  prompt to the agent) and removed again — it didn't add enough.
- **Inferred interactions**: two unrelated agents editing the same file meet at the water cooler
  with a ⚡ bubble as a conflict warning. Useful, but inferred rather than real communication.
