import { agentEventSchema, type AgentEvent } from "@pixel-office/protocol";

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function str(o: Obj | undefined, key: string): string | undefined {
  const v = o?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Validates candidate events; anything that doesn't match the schema is dropped. */
export function validEvents(candidates: unknown[]): AgentEvent[] {
  const out: AgentEvent[] = [];
  for (const c of candidates) {
    const r = agentEventSchema.safeParse(c);
    if (r.success) out.push(r.data);
  }
  return out;
}

/**
 * Sessions in a throwaway folder made by `mktemp -d` (named `tmp.XXXXXXXXXX`),
 * e.g. scripts and tools that start an agent for a few seconds. They'd only
 * pop in and out of the office, so they're left out.
 */
export function isThrowawaySession(event: AgentEvent): boolean {
  return event.project.name.startsWith("tmp.");
}

export interface Adapter {
  /** Turns one native payload into zero or more normalized events. */
  toEvents(payload: unknown, now: number): AgentEvent[];
}

/** Spread helper: `{ detail }` when there is one, `{}` otherwise (keeps optional fields absent). */
export function withDetail(detail: string | undefined): { detail?: string } {
  return detail ? { detail } : {};
}

/** Claude / OpenCode todo status → ours. Cancelled counts as done; deleted is ignored. */
export function todoStatus(s: string | undefined): "pending" | "in_progress" | "completed" | undefined {
  switch (s) {
    case "pending":
    case "in_progress":
    case "completed":
      return s;
    case "cancelled":
      return "completed";
    default:
      return undefined;
  }
}
