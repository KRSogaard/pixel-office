import { emptyState, reduce } from "@pixel-office/protocol";
import { describe, expect, it } from "vitest";
import { genericToEvents } from "../src/adapters/generic.js";
import { SCENARIOS } from "../src/simulator/scenarios.js";

describe("simulator scenarios", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    it(`${name}: every step is a valid event and everyone leaves at the end`, () => {
      const steps = scenario(0);
      expect(steps.length).toBeGreaterThan(5);
      let state = emptyState();
      let t = 0;
      for (const step of steps) {
        expect(step.delay).toBeGreaterThanOrEqual(0);
        t += step.delay;
        const events = genericToEvents(step.event, t);
        expect(events, JSON.stringify(step.event)).toHaveLength(1);
        state = reduce(state, events[0]!);
      }
      const notEnded = Object.values(state.agents).filter((a) => a.status !== "ended");
      expect(notEnded.map((a) => a.id)).toEqual([]);
    });
  }

  it("delegation-tree links all three children to the lead", () => {
    let state = emptyState();
    let t = 0;
    for (const step of SCENARIOS["delegation-tree"]!(0)) {
      t += step.delay;
      state = reduce(state, genericToEvents(step.event, t)[0]!);
      if (Object.values(state.agents).filter((a) => a.parentId).length === 3) break;
    }
    const kids = Object.values(state.agents).filter((a) => a.parentId === "claude:lead-0");
    expect(kids).toHaveLength(3);
  });
});
