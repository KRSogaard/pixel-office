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
- **Visitors** dropping by now and then — Elon Musk, Donald Trump, the Consultant, the Lost Intern,
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
docker compose logs pixel-office           # shows the admin token (setup link) + ingest token
```

1. Open the **setup link** from the log (`…/admin?token=po_a_…`) and, in 👥 People, add yourself
   as an admin. You get your personal token; from now on you log in with your name and it.
2. In Claude Code run `/plugin marketplace add KRSogaard/pixel-office`, then
   `/plugin install pixel-office@pixel-office`, and enter the server URL and your personal token when asked.
3. Start a Claude Code session — a new person walks into the office.

No agent handy? Watch fake ones: `pnpm simulate busy-day --token <ingest token>`.

The sections below cover each step in more detail.

## 1. Run the server

### Docker

```sh
docker compose up -d
docker compose logs pixel-office   # first start prints the admin token (setup link) + ingest token
```

### From source

```sh
pnpm install
PIXEL_OFFICE_HOST=0.0.0.0 pnpm start   # builds if needed, then serves http://<this-machine>:8790
```

Open the setup link the first start prints, add yourself in 👥 People, and you'll see an
empty office.

- `PIXEL_OFFICE_HOST=0.0.0.0` lets other machines reach the server. Leave it out and only
  this machine can connect.
- `pnpm start` rebuilds first whenever the sources changed since the last build (e.g. after
  a `git pull`), and reinstalls dependencies when the lockfile changed. Then it runs
  `packages/server/dist/server.js` with any arguments you pass.
- The admin token and shared ingest token are printed **only on the first start**. The admin
  token is stored hashed; `node packages/server/dist/server.js token --admin --rotate` makes a
  new one. To see the shared ingest token again: `node packages/server/dist/server.js token`.

### Configuration

All optional, via environment variables:

| Variable | Default | |
|---|---|---|
| `PIXEL_OFFICE_PORT` | `8790` | |
| `PIXEL_OFFICE_HOST` | `127.0.0.1` (`0.0.0.0` in Docker) | Interface to bind. |
| `PIXEL_OFFICE_DATA_DIR` | `./data` (`/data` in Docker) | Holds `secrets.json`. |
| `PIXEL_OFFICE_PASSWORD` | none | The old shared website password. Only logs in until someone has the admin role (for upgrading older installs). |
| `PIXEL_OFFICE_INGEST_TOKEN` | generated on first start | Shared token agents send events with (no name). `pnpm start token` prints it. |
| `PIXEL_OFFICE_ADMIN_TOKEN` | generated on first start | Setup key: log in with it or open `/admin?token=…`. Stored hashed; `pnpm start token --admin --rotate` makes a new one. |
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

## 5. Multiple people and a TV

One office can show everyone's agents. Each person gets their own token: their agents are
labelled with their name, and they **log in with their name and that token** (the same one
they put in the Claude plugin). A TV gets a 6-letter code.

**Roles**

| | Watch | Get a new token for themselves | Settings, people, screens |
|---|---|---|---|
| **member** | ✓ | ✓ | |
| **admin** | ✓ | ✓ | ✓ |
| **TV** (code) | ✓ | | |

### The admin token (setup key)

On first start the server prints an **admin token** (`po_a_…`) next to the shared ingest
token, plus a ready-made setup link:

```
Admin token        : po_a_…
  setup link       : http://<server>:8790/admin?token=po_a_…
```

Open the setup link (or paste the admin token in the login page's token field) to land in
the 👥 **People** panel as an admin, and **add yourself as an admin**. From then on use your
own name + token; keep the admin token as the emergency key.

Upgrading an older install that had a shared password: it keeps working until someone has
the admin role, so you can log in with it once and make yourself an admin. The token is stored hashed and can't be shown again; to get a
new one: `pnpm start token --admin --rotate` (a running server picks it up right away). You can also
pin it with `PIXEL_OFFICE_ADMIN_TOKEN`.

> **Running commands on the server.** From a clone, run them in the repo folder with
> `pnpm start <command>` (e.g. `pnpm start user list`); with Docker,
> `docker compose exec pixel-office node server.js <command>`.

### Add a person

In 👥 **People**, add a name (as a member or an admin) — their token is shown **once**. Lost
it? **New token** gives them a fresh one (the old one stops working); people can also renew
their own. Or on the server:

```sh
pnpm start user add Morten        # prints Morten's token once (--admin to make him an admin)
pnpm start user role Morten admin # or: member
pnpm start user token Morten      # a new token; the old one stops working
pnpm start user list
pnpm start user remove Morten     # his token stops working
```

Morten logs in to the office with his name and that token, and sets up the Claude Code
plugin (section 2) with the same token instead of the shared one. Already installed? Change the token under pixel-office's settings in `/config` (or
`/plugin`). OpenCode: `export PIXEL_OFFICE_TOKEN=<his token>`.

Everything his agents do carries his name; the server sets it from the token, so nobody can
pose as someone else. The shared ingest token keeps working, without a name.

### Put the office on a TV

In 👥 **TV screens**, add a screen — you get a 6-letter code like **`kmb-tqr`**. Or on the server:

```sh
pnpm start display add "Office TV"   # prints its code, e.g. kmb-tqr
pnpm start display list
pnpm start display remove "Office TV" # logs that screen out
```

On the TV, open the office (`http://<server>:8790`) and type the code into the **TV code** box
on the login page — or go straight to `http://<server>:8790/tv/kmb-tqr`. That browser stays
logged in for a year as a **viewer**: it can watch, but can't change settings or people.
**Full screen on an iPad:** tap the ⛶ button (in TV mode, touch the screen first to show it).
For a TV that stays full screen across restarts, open the office in Safari and tap
**Share → Add to Home Screen**: the "Office" icon opens it like an app, with no browser bars.
A home-screen app keeps its own login, so type the TV code once more inside it.

**iPad / tablet as the TV:** browsers only allow "keep the screen on" on https pages, so on a
plain-http office the TV keeps itself awake by quietly looping a tiny silent video. If a yellow
"Tap to keep this screen on" button appears, tap it once. To be safe, also set the iPad's
Settings → Display & Brightness → Auto-Lock → Never (and keep it plugged in).

**Art style on a TV:** the style dropdown is hidden in TV mode, so pick it in the address:
`http://<server>:8790/?style=toon`.

When you update the server (`git pull && pnpm start`), open browsers — the TV included —
notice the new version and reload themselves. Removing the screen logs it out; **New code** replaces a lost code (a TV that's already logged
in stays logged in). Codes skip i, l and o so they're easy to read; wrong guesses count
against the login rate limit.

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
[`packages/web/src/office/generate.ts`](packages/web/src/office/generate.ts).

### Art styles

The office comes in three looks, picked per browser with the dropdown in the top bar (or
`?style=toon` / `?style=lowpoly` in the address):

- **Pixel**: everything drawn in code at 16 pixels per tile
  ([`packages/web/src/art/pixel.ts`](packages/web/src/art/pixel.ts) and the files it uses).
- **Toon**: a 1940s-cartoon look. Furniture, people, visitors, the cat and props are images in
  [`packages/web/public/art/toon/`](packages/web/public/art/toon), generated with Nano Banana;
  floors, walls and rugs are painted in [`packages/web/src/art/toon.ts`](packages/web/src/art/toon.ts).
- **3D**: a low-poly office in Three.js, seen from a tilted camera that doesn't shrink things
  with distance (so it reads like an isometric game). Drag to pan, scroll to zoom. People are
  rigged 3D characters that walk, run and cheer, and sit properly at desks and on sofas; the
  furniture is built in code from the same layout
  ([`packages/web/src/render/three/`](packages/web/src/render/three)).

Each style has its own visitors.

What happens in the office and how it's drawn are kept apart:

- [`packages/web/src/world/`](packages/web/src/world) is the office's brain, with no drawing
  in it: who sits where, who walks where, the scenes, visitors, bugs, rockets and the cat.
- A **renderer** draws the world and owns the camera and clicks (the `Renderer` interface in
  [`packages/web/src/render/renderer.ts`](packages/web/src/render/renderer.ts)). Pixel and
  Toon both use the flat Phaser renderer in
  [`packages/web/src/render/phaser/`](packages/web/src/render/phaser), each with its own art
  pack (the `ArtPack` interface in [`packages/web/src/art/pack.ts`](packages/web/src/art/pack.ts)).
- [`packages/web/src/office-view.ts`](packages/web/src/office-view.ts) runs the two together
  and keeps the HTML name tags, bubbles and labels on top.

Pixel and Toon both use the flat Phaser renderer; 3D has its own, in
[`packages/web/src/render/three/`](packages/web/src/render/three).

Adding a style means listing it in `STYLES` in
[`packages/web/src/art/style.ts`](packages/web/src/art/style.ts) and giving
[`packages/web/src/render/index.ts`](packages/web/src/render/index.ts) a case for it: either a
new art pack for the Phaser renderer, or a renderer of its own.

The toon images are made by [`packages/web/scripts/toon-art.py`](packages/web/scripts/toon-art.py)
(needs Python with Pillow, and an OpenRouter key). It cuts out the white background,
crops, splits people into poses and scales everything to size. Raw generations are cached
in `packages/web/.toon-raw/` (not committed), so changing the clean-up never costs a new
generation:

```sh
cd packages/web
OPENROUTER_API_KEY=… python3 scripts/toon-art.py          # generate what's missing, then process
python3 scripts/toon-art.py --process                      # re-process the cached images only
OPENROUTER_API_KEY=… python3 scripts/toon-art.py --redo desk char-03--side   # regenerate these
```

The 3D characters are in [`packages/web/public/art/lowpoly/`](packages/web/public/art/lowpoly):
`agent-00` … `agent-08` (an agent gets one picked from its id) and one per visitor and extra
(`boss`, `courier`, …). Each was drawn in the same low-poly style with FLUX.2 (in ComfyUI),
then turned into a rigged, animated model by [Tripo](https://www.tripo3d.ai) (image to model,
auto-rig, and its idle, walk, run and cheer animations), and slimmed down for the web by
[`packages/web/scripts/slim-glb.py`](packages/web/scripts/slim-glb.py) (about 1.8 MB to 0.7 MB
each). A new character works as long as it has Tripo's biped skeleton and those four
animations; how it sits is measured on its own body the first time it sits down.

## Layout

```
packages/protocol   event shape, office state, the reducer (shared by server + web)
packages/server     ingest + adapters, auth, WebSocket, reaper, simulator, CLI
packages/web        Phaser office, characters, overlay, side panel
plugins/claude-code Claude Code plugin (async hooks → server)
plugins/opencode    OpenCode plugin
```
