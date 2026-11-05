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

type Ctx = { directory: string };

export const PixelOffice = async ({ directory }: Ctx) => {
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

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (FORWARDED_EVENTS.has(event.type)) send({ type: "event", event });
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
  const keep = ["filePath", "path", "pattern", "command", "description", "url", "query", "questions", "subagent_type"];
  const out: Record<string, unknown> = {};
  for (const k of keep) {
    const v = args[k];
    if (typeof v === "string") out[k] = v.slice(0, 300);
    else if (k === "questions" && Array.isArray(v)) out[k] = v.slice(0, 1);
  }
  return out;
}
