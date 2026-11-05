import type { AgentEvent } from "@pixel-office/protocol";
import { isObj, validEvents, type Adapter } from "./common.js";

/** Body is one normalized AgentEvent or an array of them. `ts` defaults to now. */
export function genericToEvents(payload: unknown, now: number): AgentEvent[] {
  const list = Array.isArray(payload) ? payload : [payload];
  return validEvents(list.filter(isObj).map((e) => ({ ts: now, ...e })));
}

export const genericAdapter: Adapter = { toEvents: genericToEvents };
