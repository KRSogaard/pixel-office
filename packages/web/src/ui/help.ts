import type { Activity } from "@pixel-office/protocol";
import { FX_SIZE, buildFxSheet } from "../art/fx.js";

/**
 * "What am I looking at?" — a guide to the rooms, the people, the icons and
 * the buttons. Opens by itself on the first visit; the ? button in the top bar
 * brings it back.
 */

const SEEN_KEY = "po.helpSeen";

interface Row {
  name: string;
  what: string;
}

const ROOMS_TOP: Row[] = [
  { name: "Library", what: "Reading or searching code — Read, Grep, Glob, LSP." },
  { name: "Server room", what: "Running other shell commands — builds, git, scripts (Bash)." },
  { name: "Test lab", what: "Running tests — npm test, vitest, pytest, dotnet test and the like. The sign shows the latest result in the office: ⏳ running, ✓ pass, ✗ fail." },
  { name: "Git room", what: "Git work — commit, push, pull, rebase, gh pr. Every push or new PR launches a rocket from the silo. The gauge beside the silo shows how many commits are loaded (not pushed yet)." },
  { name: "Mailroom", what: "Calling MCP tools — Slack, GitHub, Google Drive, databases and other connected services." },
];

const ROOMS_MIDDLE: Row[] = [
  { name: "Front door (left wall)", what: "Agents walk in when a session starts and out when it ends." },
  { name: "Reception counter", what: "The agent needs you: a permission prompt or a question. It waves, with a red ! — go to your terminal." },
  { name: "Flying robots", what: "Every git commit sends a little robot from the agent's desk to the silo with a crate. The crate loads into the rocket." },
  { name: "Lounge sofas", what: "Idle: the agent finished its turn and is waiting for your next prompt." },
  { name: "Coffee machine", what: "A coffee break: the agent hit a rate limit or the API is overloaded." },
  { name: "Globe desks", what: "On the web — WebFetch and WebSearch." },
  { name: "Filing cabinets", what: "Decoration." },
];

const TEAM: Row[] = [
  { name: "Team area", what: "One per session, on a rug in that session's colour, labelled “project · manager · person · ⎇ branch”." },
  { name: "Manager's desk", what: "The big desk with two monitors: the main agent of the session sits here." },
  { name: "Worker desks", what: "Its sub-agents sit here. A new row appears when they run out of free desks." },
  { name: "Whiteboard", what: "The manager's todo list: done / total, a progress bar and the item in progress. Hover for the full list." },
  { name: "Printer", what: "Prints when someone in the team writes a document." },
  { name: "Wastepaper bin", what: "How full the agent's context window is: green, amber, red. The agent stomps it flat when it compacts." },
];

const PEOPLE: Row[] = [
  { name: "Coloured ring", what: "The session colour. A main agent and its sub-agents share it." },
  { name: "Coloured name chip", what: "Whose agent it is — each person has their own colour. (No chip: the shared token.) Your own agents are outlined and say “(you)”. Visitors get a ★." },
  { name: "sub · Explore", what: "A sub-agent, and the kind it is." },
  { name: "Second line", what: "The project, then why it's working: the prompt it's on, or “↳ Manager: task” for a sub-agent, or “needs you: …”." },
  { name: "Speech bubbles", what: "☎ your prompt arriving · ✓ a sub-agent reporting back · ! / ? waiting for you · plain: agents talking to each other." },
  { name: "Thin line under a tag", what: "The tag was moved up to make room; the line points to its person." },
  { name: "Click someone", what: "Opens their details on the right (prompt, todos, context, recent tools) and draws dotted lines to their manager and sub-agents." },
];

const ICONS: [Activity, string][] = [
  ["thinking", "Thinking (no tool yet)"],
  ["edit", "Writing code"],
  ["read", "Reading"],
  ["shell", "Running a command"],
  ["test", "Running tests"],
  ["git", "Git work"],
  ["web", "On the web"],
  ["mcp", "Using a connected service (MCP)"],
  ["delegate", "Handing work to sub-agents"],
  ["message", "Talking to another agent"],
  ["waiting", "Needs you"],
  ["compact", "Compacting its context"],
  ["other", "Some other tool"],
  ["idle", "Idle"],
];

const EVENTS: Row[] = [
  { name: "Rocket launch", what: "Someone pushed, opened a PR or made a release. The git room's sign counts the launches." },
  { name: "Confetti + arms up", what: "A test run passed." },
  { name: "Lab bench on fire", what: "Two failed test runs in a row. “This is fine.”" },
  { name: "Sweat + 😱", what: "Someone ran a scary command (rm -rf, --force, reset --hard, DROP TABLE, sudo…). Coworkers gasp." },
  { name: "Courier", what: "An agent used a connected service (MCP): an envelope arrives from the mailroom." },
  { name: "Printer", what: "Someone wrote a document (README, .md, …): the team's printer prints." },
  { name: "Medics", what: "A sub-agent failed: it collapses and is carried out on a stretcher." },
  { name: "High five", what: "A sub-agent reported back successfully." },
  { name: "Dance + 🎉", what: "Every item on a todo list is done." },
  { name: "Rubber duck", what: "Thinking at the desk for more than 20 seconds. Squeak." },
  { name: "Flame over the head", what: "Stuck: on the same tool call for over 10 minutes." },
  { name: "🥱", what: "Working for more than two hours." },
  { name: "Pizza", what: "Five or more agents working at once: crunch time." },
  { name: "Grey smoke + a bug", what: "A tool call failed: a bug escapes and scuttles around. Passing tests squash that session's bugs. Nine or more and they swarm the server room." },
  { name: "Gossip", what: "Idle agents in the lounge chat about what just happened in the office." },
  { name: "🏆 Toast", what: "An achievement was unlocked. See them all in the 📊 sidebar." },
  { name: "Seasons", what: "A Christmas tree and snow in winter, pumpkins at Halloween, confetti at New Year, and party hats on the office's birthday." },
  { name: "Sparkles", what: "A sub-agent just appeared next to its manager." },
  { name: "Dark office, lamps on", what: "Night time where you are. The windows show the city outside, and the clock is real." },
  { name: "★ Visitors", what: "Now and then someone drops by: Elon Musk on a scooter, Donald Trump, the Consultant, the Lost Intern, the Investor (who reads today's numbers), Grandpa Cobol with his walking stick — and the Auditor, who turns up after a scary command." },
  { name: "Orange cat", what: "Byte, the office cat. Click for a purr. Sometimes sits on keyboards." },
];

const BAR: Row[] = [
  { name: "⌨ ! z", what: "Agents working · waiting for you · idle." },
  { name: "🔔", what: "Bell when an agent needs you or finishes." },
  { name: "🖥", what: "Desktop notifications while this tab is in the background." },
  { name: "🔊", what: "Sound effects: rocket launches, the lab alarm, Byte's meow, squashed bugs, keyboards." },
  { name: "📊", what: "Production sidebar: today's launches, commits, tests and pass rate, bugs, activity per hour, all-time numbers and the trophy cabinet." },
  { name: "☰", what: "List view: everyone in a table (good on a phone)." },
  { name: "⏪", what: "Replay the last two hours." },
  { name: "⚙", what: "Office layout settings (shared with everyone). Admins only." },
  { name: "👥", what: "People and TV screens: give each person their own token (their agents carry their name; “New token” replaces it), and add screens for the office — each gets a 6-letter code like abc-def to type in on the TV. Admins only." },
  { name: "privacy", what: "Hide prompts and messages, e.g. when screen sharing." },
  { name: "⛶", what: "Fullscreen (iPads too). On an iPad or iPhone you can also tap Share → Add to Home Screen: the office then opens full screen like an app." },
  { name: "− ▣ +", what: "Zoom out, fit the office, zoom in. You can also drag and scroll." },
  { name: "Your name", what: "Who you're logged in as (★ = admin). Click it to get a new token for yourself or log out." },
  { name: "Green square", what: "Connected to the server. Red: reconnecting." },
];

export class HelpPanel {
  /** `autoOpen`: open on the first visit (not when arriving to set up people, or on a TV). */
  constructor(
    private root: HTMLElement,
    autoOpen = true,
  ) {
    this.render();
    if (autoOpen && !localStorage.getItem(SEEN_KEY)) this.open();
  }

  toggle(): void {
    if (this.root.classList.contains("open")) this.close();
    else this.open();
  }

  open(): void {
    this.root.classList.add("open");
  }

  close(): void {
    this.root.classList.remove("open");
    localStorage.setItem(SEEN_KEY, "1");
  }

  private render(): void {
    const table = (rows: Row[]) =>
      `<dl class="help-rows">${rows.map((r) => `<dt>${r.name}</dt><dd>${r.what}</dd>`).join("")}</dl>`;
    this.root.innerHTML = `
      <div class="set-head"><b>What am I looking at?</b><button class="set-close" title="Close">×</button></div>
      <p class="muted">Every agent is a person. Where they stand shows what they're doing right now.</p>
      <section><span class="section-title">Rooms along the top</span>${table(ROOMS_TOP)}</section>
      <section><span class="section-title">The middle strip</span>${table(ROOMS_MIDDLE)}</section>
      <section><span class="section-title">Team areas</span>${table(TEAM)}</section>
      <section><span class="section-title">People</span>${table(PEOPLE)}</section>
      <section><span class="section-title">Icons beside a person's head</span><div class="help-icons"></div></section>
      <section><span class="section-title">Little moments</span>${table(EVENTS)}</section>
      <section><span class="section-title">Top bar</span>${table(BAR)}</section>
      <div class="set-actions"><span class="muted">Open this again with the ? button.</span><button class="set-save">Got it</button></div>
    `;
    this.root.querySelector<HTMLButtonElement>(".set-close")!.onclick = () => this.close();
    this.root.querySelector<HTMLButtonElement>(".set-save")!.onclick = () => this.close();

    // Icons cut from the same sprite sheet the office uses.
    const { canvas, strips } = buildFxSheet();
    const icons = this.root.querySelector(".help-icons")!;
    for (const [activity, label] of ICONS) {
      const strip = strips[activity];
      if (!strip) continue;
      const c = document.createElement("canvas");
      c.width = c.height = FX_SIZE;
      // A frame where the icon is fully drawn (blinking icons are blank on odd frames).
      const frame = strip.start + (strip.frames > 2 ? 2 : 0);
      c.getContext("2d")!.drawImage(canvas, frame * FX_SIZE, 0, FX_SIZE, FX_SIZE, 0, 0, FX_SIZE, FX_SIZE);
      const item = document.createElement("div");
      item.className = "help-icon";
      const text = document.createElement("span");
      text.textContent = label;
      item.append(c, text);
      icons.append(item);
    }
  }
}
