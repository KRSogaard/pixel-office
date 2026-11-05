import { categorizeTool, projectFromPath, summarizeTool, detailTool, type AgentEvent } from "@pixel-office/protocol";
import { isObj, str, todoStatus, validEvents, withDetail, type Adapter, type Obj } from "./common.js";

/**
 * Envelopes sent by plugins/opencode/pixel-office.ts → AgentEvents.
 *
 * Stateful: OpenCode only says a session is a child (sub-agent) in
 * `session.created`; later events such as `session.idle` carry just the id.
 * We remember parent links so a finished child can "report back".
 */
export class OpenCodeAdapter implements Adapter {
  private readonly parentOf = new Map<string, string>();
  private readonly labelOf = new Map<string, string>();

  toEvents(payload: unknown, now: number): AgentEvent[] {
    if (!isObj(payload)) return [];
    const type = str(payload, "type");
    const project = projectFromPath(str(payload, "directory"));
    const out: unknown[] = [];

    const base = (sessionID: string) => {
      const parent = this.parentOf.get(sessionID);
      const label = this.labelOf.get(sessionID);
      return {
        source: "opencode",
        agentId: `opencode:${sessionID}`,
        sessionId: `opencode:${this.rootOf(sessionID)}`,
        ...(parent ? { parentAgentId: `opencode:${parent}` } : {}),
        ...(label ? { label } : {}),
        project,
        ts: now,
      };
    };

    if (type === "event" && isObj(payload.event)) {
      this.fromBusEvent(payload.event, base, out);
    } else if (type === "tool.before" || type === "tool.after") {
      const input = isObj(payload.input) ? payload.input : undefined;
      const sessionID = str(input, "sessionID");
      const callID = str(input, "callID");
      const tool = str(input, "tool");
      if (sessionID && callID && tool) {
        if (type === "tool.before") {
          const args = isObj(payload.args) ? payload.args : undefined;
          out.push({
            ...base(sessionID),
            kind: "tool.start",
            callId: callID,
            tool,
            category: categorizeTool(tool),
            summary: summarizeTool(tool, args),
            ...withDetail(detailTool(tool, args)),
          });
          if (tool === "question") {
            out.push({ ...base(sessionID), kind: "waiting", reason: "question", text: questionText(args) });
          }
        } else {
          out.push({ ...base(sessionID), kind: "tool.end", callId: callID, ok: payload.ok !== false });
        }
      }
    } else if (type === "branch") {
      const sessionID = str(payload, "sessionID");
      const branch = str(payload, "branch")?.replace(/[^A-Za-z0-9._/-]/g, "").slice(0, 100);
      if (sessionID && branch) out.push({ ...base(sessionID), kind: "branch", branch });
    } else if (type === "context") {
      const sessionID = str(payload, "sessionID");
      const tokens = payload.tokens;
      if (sessionID && typeof tokens === "number" && tokens > 0) {
        out.push({ ...base(sessionID), kind: "context", tokens: Math.round(tokens) });
      }
    } else if (type === "todos") {
      const sessionID = str(payload, "sessionID");
      if (sessionID && Array.isArray(payload.todos)) {
        const items = [];
        for (const t of payload.todos.slice(0, 100)) {
          if (!isObj(t)) continue;
          const text = str(t, "content");
          const status = todoStatus(str(t, "status"));
          const id = str(t, "id");
          if (text && status) items.push({ ...(id ? { id } : {}), text, status });
        }
        out.push({ ...base(sessionID), kind: "todos", items });
      }
    } else if (type === "chat.message") {
      const sessionID = str(payload, "sessionID");
      const text = str(payload, "text");
      if (sessionID && text) out.push({ ...base(sessionID), kind: "prompt", text });
    }
    return validEvents(out);
  }

  private fromBusEvent(event: Obj, base: (id: string) => Obj, out: unknown[]): void {
    const type = str(event, "type");
    const props = isObj(event.properties) ? event.properties : {};
    const info = isObj(props.info) ? props.info : undefined;
    const sessionID = str(info, "id") ?? str(props, "sessionID");
    if (!sessionID) return;

    switch (type) {
      case "session.created": {
        const parentID = str(info, "parentID");
        if (parentID) {
          this.parentOf.set(sessionID, parentID);
          const title = str(info, "title");
          if (title) this.labelOf.set(sessionID, title.slice(0, 80));
        }
        out.push({ ...base(sessionID), kind: "session.start" });
        break;
      }
      case "session.deleted":
        out.push({ ...base(sessionID), kind: "session.end", ok: true });
        this.forget(sessionID);
        break;
      case "session.idle":
        this.idle(sessionID, base, out);
        break;
      case "session.status": {
        const status = isObj(props.status) ? str(props.status, "type") : undefined;
        if (status === "idle") this.idle(sessionID, base, out);
        else if (status === "busy" || status === "retry") out.push({ ...base(sessionID), kind: "busy" });
        break;
      }
      case "session.compacted":
        out.push({ ...base(sessionID), kind: "compact" });
        break;
      case "session.error": {
        const err = isObj(props.error) ? str(props.error, "name") : undefined;
        out.push({ ...base(sessionID), kind: "error", text: err ?? "error" });
        break;
      }
      case "permission.updated":
      case "permission.asked": {
        const title = str(props, "title") ?? str(props, "permission") ?? str(props, "type");
        out.push({ ...base(sessionID), kind: "waiting", reason: "permission", ...(title ? { text: title } : {}) });
        break;
      }
      case "permission.replied":
        out.push({ ...base(sessionID), kind: "busy" });
        break;
    }
  }

  /** A root session going idle waits for you; a child going idle has finished its task. */
  private idle(sessionID: string, base: (id: string) => Obj, out: unknown[]): void {
    if (this.parentOf.has(sessionID)) out.push({ ...base(sessionID), kind: "session.end", ok: true });
    else out.push({ ...base(sessionID), kind: "idle" });
  }

  private rootOf(sessionID: string): string {
    let id = sessionID;
    for (let i = 0; i < 20; i++) {
      const p = this.parentOf.get(id);
      if (!p) break;
      id = p;
    }
    return id;
  }

  private forget(sessionID: string): void {
    this.parentOf.delete(sessionID);
    this.labelOf.delete(sessionID);
  }
}

function questionText(args: Obj | undefined): string {
  const qs = args?.questions;
  if (Array.isArray(qs) && isObj(qs[0])) return str(qs[0], "question") ?? "Question";
  return str(args, "question") ?? "Question";
}
