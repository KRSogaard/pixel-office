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

export interface Adapter {
  /** Turns one native payload into zero or more normalized events. */
  toEvents(payload: unknown, now: number): AgentEvent[];
}
