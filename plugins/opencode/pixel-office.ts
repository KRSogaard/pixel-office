/**
 * pixel-office plugin for OpenCode.
 *
 * Forwards session, permission, tool and prompt activity to a pixel-office
 * server. Runs inside the OpenCode process — adds nothing to the model's context.
 *
 * Install: copy to ~/.config/opencode/plugins/ (or run `pixel-office install-opencode`)
 * Configure:
 *   export PIXEL_OFFICE_URL=https://office.example.com
 *   export PIXEL_OFFICE_TOKEN=<ingest token>
 */

const FORWARDED_EVENTS = new Set([
  "session.created",
  "session.deleted",
  "session.idle",
  "session.status",
  "session.compacted",
  "session.error",
  "permission.updated",
  "permission.asked",
  "permission.replied",
]);

type Shell = (strings: TemplateStringsArray, ...values: unknown[]) => {
  cwd(dir: string): { quiet(): { nothrow(): { text(): Promise<string> } } };
};
type Ctx = { directory: string; $?: Shell };

export const PixelOffice = async ({ directory, $ }: Ctx) => {
  const url = process.env.PIXEL_OFFICE_URL?.replace(/\/$/, "");
  const token = process.env.PIXEL_OFFICE_TOKEN ?? "";
  if (!url) return {};

  const send = (body: Record<string, unknown>): void => {
    try {
      fetch(`${url}/ingest/opencode`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ directory, ...body }),
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    } catch {
      // never let the office break the agent
    }
  };

  /** The git branch of the project, for the team label. Never throws. */
  const sendBranch = async (props: unknown): Promise<void> => {
    try {
      const info = (props as { info?: { id?: string; parentID?: string } } | undefined)?.info;
      if (!$ || !info?.id || info.parentID) return;
      const branch = (await $`git branch --show-current`.cwd(directory).quiet().nothrow().text()).trim();
      if (branch) send({ type: "branch", sessionID: info.id, branch: branch.slice(0, 100) });
    } catch {
      // no git, no branch
    }
  };

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (FORWARDED_EVENTS.has(event.type)) {
        send({ type: "event", event });
        if (event.type === "session.created") void sendBranch(event.properties);
        return;
      }
      const props = (event.properties ?? {}) as Record<string, unknown>;
      if (event.type === "message.updated") {
        // Context window use: what the last assistant message sent to the model.
        const info = props.info as
          | { role?: string; sessionID?: string; tokens?: { input?: number; cache?: { read?: number; write?: number } } }
          | undefined;
        const t = info?.tokens;
        if (info?.role !== "assistant" || !info.sessionID || !t) return;
        const tokens = (t.input ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);
        if (tokens > 0) send({ type: "context", sessionID: info.sessionID, tokens });
      } else if (event.type === "todo.updated") {
        const todos = Array.isArray(props.todos) ? (props.todos as Array<Record<string, unknown>>) : [];
        send({
          type: "todos",
          sessionID: props.sessionID,
          todos: todos.slice(0, 100).map((t) => ({
            id: t.id,
            content: typeof t.content === "string" ? t.content.slice(0, 200) : "",
            status: t.status,
          })),
        });
      }
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ) => {
      send({ type: "tool.before", input, args: trimArgs(output.args) });
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { metadata?: { error?: unknown } } | undefined,
    ) => {
      const { tool, sessionID, callID } = input;
      send({ type: "tool.after", input: { tool, sessionID, callID }, ok: !output?.metadata?.error });
    },

    "chat.message": async (
      input: { sessionID: string },
      output: { parts: Array<{ type: string; text?: string; synthetic?: boolean }> },
    ) => {
      const text = output.parts
        .filter((p) => p.type === "text" && !p.synthetic && p.text)
        .map((p) => p.text)
        .join(" ")
        .slice(0, 1000);
      if (text) send({ type: "chat.message", sessionID: input.sessionID, text });
    },
  };
};

/** Only the fields the server summarizes — never file contents. */
function trimArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args) return {};
  const keep = ["filePath", "path", "pattern", "command", "description", "url", "query", "questions", "subagent_type", "prompt"];
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    const v = args[k];
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (k === "questions" && Array.isArray(v)) out[k] = v.slice(0, 1);
  }
  return out;
}
