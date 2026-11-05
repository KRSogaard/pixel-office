# pixel-office

A self-hosted pixel-art office where your coding agents show up as little people.
Claude Code and OpenCode sessions walk in the front door, sit at their project's desks
to write code, browse the library when they read, stand at the server racks when they
run commands, raise a hand at reception when they need you, and walk over to each other
when one hands work to another.

It costs your agents **zero tokens**: the connectors are plain hooks/plugins running
outside the model, they print nothing, and they never block the agent.

What's in the office:

- **A team area per session**, on a rug in the session's colour: the main agent at a
  manager's desk, its sub-agents at desks in front, and a **whiteboard** with its todo list.
- **Rooms that grow** when they get busy, and shrink back when quiet.
- **Who's doing what, and why**: name tags with the prompt or task, animated activity icons,
  dotted lines between a selected agent and its team.
- **A wastepaper bin** by each desk that fills as the agent's context window fills — and
  gets stomped flat when it compacts.
- **A test lab and a git room**: tests run at lab benches (the sign shows pass/fail), and
  every push or PR launches a rocket from the git room's silo, Factorio-style.
- **Gags with meaning**: confetti when tests pass, a burning bench after two failures, sweat
  and gasps at `rm -rf`, a courier for MCP calls, the printer for docs, medics for a failed
  sub-agent, a rubber duck for long thinks, pizza when five agents are busy.
- **Flying robots** carrying every commit's crate to the rocket silo, **bugs** that escape
  from failures and get squashed by passing tests.
- **A production sidebar (📊)** with today's numbers, **achievements** with a fanfare, lounge
  **gossip** about what just happened, and **seasonal** decorations.
- **Visitors** dropping by now and then — the Visionary CEO, the Consultant, the Lost Intern,
  the Investor, Grandpa Cobol, and the Auditor (after a scary command).
- **Day and night** following your clock, desk lamps after dark, Byte the office cat, and
  **🔊 sound effects**.
- **🔔 bell and 🖥 desktop notifications** when an agent needs you or finishes.
- **⏪ Replay** of the last two hours, **☰ list view**, **⚙ office settings** shared by everyone,
  and a **?** guide to everything.

See [DESIGN.md](DESIGN.md) for how it works.

## Quick start

```sh
git clone https://github.com/KRSogaard/pixel-office.git
cd pixel-office
docker compose up -d                       # or: pnpm install && pnpm start
docker compose logs pixel-office           # shows the generated password + ingest token
```

1. Open http://127.0.0.1:8790 and log in with the password.
2. In Claude Code run `/plugin marketplace add KRSogaard/pixel-office`, then
   `/plugin install pixel-office@pixel-office`, and enter the server URL and ingest token when asked.
3. Start a Claude Code session — a new person walks into the office.

No agent handy? Watch fake ones: `pnpm simulate busy-day --token <ingest token>`.

The sections below cover each step in more detail.

## 1. Run the server

### Docker

```sh
docker compose up -d
docker compose logs pixel-office   # first start prints the generated password + ingest token
```

### From source

```sh
pnpm install
PIXEL_OFFICE_HOST=0.0.0.0 pnpm start   # builds if needed, then serves http://<this-machine>:8790
```

Open the URL, log in with the password, and you'll see an empty office.

- `PIXEL_OFFICE_HOST=0.0.0.0` lets other machines reach the server. Leave it out and only
  this machine can connect.
- `pnpm start` rebuilds first whenever the sources changed since the last build (e.g. after
  a `git pull`), and reinstalls dependencies when the lockfile changed. Then it runs
  `packages/server/dist/server.js` with any arguments you pass.
- The password and ingest token are printed **only on the first start**. The password is
  stored hashed and can't be shown again; to choose your own, start with
  `PIXEL_OFFICE_PASSWORD='…' pnpm start`. To see the token again:
  `node packages/server/dist/server.js token`.

### Configuration

All optional, via environment variables:

| Variable | Default | |
|---|---|---|
| `PIXEL_OFFICE_PORT` | `8790` | |
| `PIXEL_OFFICE_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Interface to bind. |
| `PIXEL_OFFICE_DATA_DIR` | `./data` (`/data` in Docker) | Holds `secrets.json`. |
| `PIXEL_OFFICE_PASSWORD` | generated on first start | Password for the website. |
| `PIXEL_OFFICE_INGEST_TOKEN` | generated on first start | Token agents send events with. `pixel-office token` prints it. |
| `PIXEL_OFFICE_TRUST_PROXY` | off | Turn on behind a TLS reverse proxy so the real client IP and `https` are honoured. |
| `PIXEL_OFFICE_COOKIE_SECURE` | auto | Force the login cookie's `Secure` flag on/off. |
| `PIXEL_OFFICE_IDLE_AFTER_MS` | 10 min | Silent working agents are sent to the lounge after this. |
| `PIXEL_OFFICE_LEAVE_AFTER_MS` | 30 min | Silent agents walk out after this. |
| `PIXEL_OFFICE_HISTORY_MS` | 2 h | How far back replay can go (kept in memory, max 50k events). |
| `PIXEL_OFFICE_RECORD` | off | Path of a JSONL file to record every event to (replay it with `simulate`). |

If the office is reachable from the internet, put it behind HTTPS — prompts, file names
and shell commands travel to it.

## 2. Connect Claude Code

Do this on every computer where you use Claude Code. It can be the server machine or any
other machine that can reach it.

1. **Get the ingest token** on the server machine:
   ```sh
   node packages/server/dist/server.js token          # Docker: docker compose exec pixel-office node server.js token
   ```
2. **Check the Claude machine can reach the server.** This should print `{"ok":true}`:
   ```sh
   curl http://<server-address>:8790/health
   ```
   If it hangs, a firewall on the server machine is blocking port 8790, or the server was
   started without `PIXEL_OFFICE_HOST=0.0.0.0`.
3. **Install the plugin** inside Claude Code:
   ```
   /plugin marketplace add KRSogaard/pixel-office
   /plugin install pixel-office@pixel-office
   ```
4. **Enter the settings** when Claude Code asks:
   - Server URL: `http://<server-address>:8790`
   - Ingest token: the token from step 1 (kept in secure storage, not in `settings.json`)

   If it didn't ask, find them as plugin settings under `/config` or `/plugin`.
5. **Start a new Claude Code session.** Hooks load when a session starts. Send any prompt
   and a new person walks into the office.

To try it from a clone without installing: `claude --plugin-dir plugins/claude-code`
with `PIXEL_OFFICE_URL` and `PIXEL_OFFICE_TOKEN` set in the environment.

## 3. Connect OpenCode

```sh
node packages/server/dist/server.js install-opencode
```

This copies `plugins/opencode/pixel-office.ts` into `~/.config/opencode/plugins/`.
Then set `PIXEL_OFFICE_URL` and `PIXEL_OFFICE_TOKEN` in the environment OpenCode runs in.

## 4. Anything else

POST normalized events (see `packages/protocol/src/events.ts`) to
`/ingest/generic` with `Authorization: Bearer <token>`.

## Development

```sh
pnpm install
pnpm --filter @pixel-office/server dev       # server on :8790 (data in ./data)
pnpm --filter @pixel-office/web dev          # web on :5173, proxies to the server
pnpm simulate busy-day --token <token>       # fake agents: busy-day, delegation-tree,
                                             # permission-storm, two-tools, team
pnpm test && pnpm typecheck
```

The office is generated to fit who's online: every session gets a team area with a
manager's desk, and rooms grow when they get crowded. Room templates live in
[`packages/web/src/office/generate.ts`](packages/web/src/office/generate.ts). All art is drawn in code
([`packages/web/src/art/`](packages/web/src/art)), so there are no asset licenses to track.

## Layout

```
packages/protocol   event shape, office state, the reducer (shared by server + web)
packages/server     ingest + adapters, auth, WebSocket, reaper, simulator, CLI
packages/web        Phaser office, characters, overlay, side panel
plugins/claude-code Claude Code plugin (async hooks → server)
plugins/opencode    OpenCode plugin
```
