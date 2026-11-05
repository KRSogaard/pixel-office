import { z } from "zod";

/**
 * The one event shape every agent tool is translated into.
 * Adapters (server side) produce these; the reducer consumes them.
 */

export const TOOL_CATEGORIES = ["edit", "read", "shell", "web", "mcp", "delegate", "message", "other"] as const;
export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Text fields are clipped to this length before they enter the state. */
export const MAX_TEXT = 280;

const text = z.string().transform((s) => clip(s, MAX_TEXT));
const id = z.string().min(1).max(200);

const base = {
  source: z.string().min(1).max(40),
  agentId: id,
  /** The session this agent belongs to. For sub-agents it's the parent's session. */
  sessionId: id,
  parentAgentId: id.optional(),
  /** Free-form label such as a sub-agent type ("Explore") or teammate name. */
  label: z.string().max(80).optional(),
  project: z.object({ path: z.string().max(500), name: z.string().max(120) }),
  ts: z.number().int().nonnegative(),
};

export const agentEventSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("session.start") }),
  z.object({
    ...base,
    kind: z.literal("session.end"),
    ok: z.boolean().optional(),
    /** What a sub-agent hands back to its parent when it finishes. */
    report: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("prompt"), text }),
  /** The agent is working but hasn't picked a tool yet (thinking / streaming a reply). */
  z.object({ ...base, kind: z.literal("busy") }),
  z.object({
    ...base,
    kind: z.literal("tool.start"),
    callId: id,
    tool: z.string().min(1).max(120),
    category: z.enum(TOOL_CATEGORIES),
    summary: text.optional(),
    /** Longer context for the call. For a delegation: the brief handed to the sub-agent. */
    detail: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("tool.end"), callId: id, ok: z.boolean() }),
  z.object({
    ...base,
    kind: z.literal("waiting"),
    reason: z.enum(["permission", "question"]),
    text: text.optional(),
  }),
  z.object({ ...base, kind: z.literal("idle") }),
  z.object({ ...base, kind: z.literal("compact") }),
  z.object({ ...base, kind: z.literal("error"), text: text.optional() }),
  z.object({
    ...base,
    kind: z.literal("message"),
    /** Recipient: an agentId, or a label/name the reducer resolves within the same session. */
    to: z.string().min(1).max(200),
    text,
  }),
]);

export type AgentEvent = z.output<typeof agentEventSchema>;
export type AgentEventKind = AgentEvent["kind"];
export type AgentEventInput = z.input<typeof agentEventSchema>;

export function clip(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

export function projectFromPath(path: string | undefined): { path: string; name: string } {
  const p = (path ?? "").replace(/[\\/]+$/, "");
  const name = p.split(/[\\/]/).pop() || "unknown";
  return { path: p || "unknown", name };
}

/** Messages the server sends to browsers over the WebSocket. */
export type ServerMessage =
  | { t: "snapshot"; state: import("./state.js").OfficeState }
  | { t: "event"; e: AgentEvent };
