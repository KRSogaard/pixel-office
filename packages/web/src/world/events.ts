/**
 * One-off moments the world announces for renderers to show: smoke, confetti,
 * sparks and the like. Positions are world pixels. Nothing in the world waits
 * on them, so a renderer can show them however it likes (or not at all).
 */
export type WorldEvent =
  /** The office was rebuilt (new layout): repaint it and re-place fixed things. */
  | { type: "office" }
  /** The date-based decorations changed (season, birthday). */
  | { type: "season" }
  /** Grey smoke: a tool call failed. */
  | { type: "puff"; x: number; y: number }
  /** Confetti burst: tests passed, a todo list finished, New Year. */
  | { type: "confetti"; x: number; y: number }
  /** Sparkles: a sub-agent pops into existence. */
  | { type: "poof"; x: number; y: number; color: number }
  /** Sweat drops: someone ran a scary command. */
  | { type: "sweat"; x: number; y: number }
  /** A lab bench on fire for `ms`. */
  | { type: "fire"; x: number; y: number; ms: number }
  /** Pages sliding out of a printer (its paper slot). */
  | { type: "print"; x: number; y: number }
  /** A bug squashed flat. */
  | { type: "splat"; x: number; y: number }
  /** The cat purrs (it was clicked). */
  | { type: "purr"; x: number; y: number }
  /** Silo countdown: "3", "2", "1". */
  | { type: "countdown"; text: string }
  /** The ground shakes (rocket lift-off). */
  | { type: "shake"; ms: number; intensity: number }
  /** You approved an agent: the statue's eyes glow (`statue`: between them) and a beam of light falls on the agent at x, y. */
  | { type: "blessed"; x: number; y: number; statue?: { x: number; y: number } }
  /** You denied an agent: a storm cloud rains on it for a few seconds (follow the person `id`). */
  | { type: "storm"; id: string; x: number; y: number };

export type WorldListener = (e: WorldEvent) => void;
